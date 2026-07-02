-- ============================================================
-- StageCapital — Security Hardening Migration 0005
--
-- Fixes found during a live adversarial test of the bidding
-- engine and RLS policies:
--
--   1. place_bid / open_bidding / start_countdown trusted a
--      client-supplied user id instead of the caller's real
--      session identity, allowing any authenticated user to
--      bid or trigger host actions AS someone else.
--   2. close_bidding had no permission check at all and was
--      directly callable by any authenticated user via the
--      PostgREST RPC endpoint, bypassing the app's own check.
--   3. Countdown had no server-side auto-close — pg_cron was
--      never installed, so a case could get stuck in
--      'countdown' forever if the host didn't click "Close Now".
--   4. RLS let every event member (including attendees) read
--      every investor's exact bid amount, and let every event
--      member read a startup's private contact_email.
-- ============================================================

-- ============================================================
-- 1. Enforce real caller identity via auth.uid()
--
-- Pattern: if the request carries a user JWT (auth.uid() IS
-- NOT NULL), the supplied id parameter MUST match the caller's
-- own id. Pure service-role calls with no user JWT (auth.uid()
-- IS NULL) are left untouched — those are trusted server-side
-- callers (cron, admin scripts).
-- ============================================================

CREATE OR REPLACE FUNCTION public.place_bid(
  p_investment_case_id uuid,
  p_investor_user_id   uuid,
  p_equity_pct         numeric,
  p_amount             numeric
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_case               record;
  v_user_role          text;
  v_available_budget   numeric;
  v_total_budget       numeric;
  v_committed          numeric;
  v_total_equity_sold  numeric;
  v_remaining_equity   numeric;
  v_new_bid_id         uuid;
  v_displaced_ids      uuid[] := '{}';
  v_phase              text;
  v_implied_val        numeric;
  v_existing_bid       record;
  v_existing_equity    numeric := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() != p_investor_user_id THEN
    RETURN json_build_object('success', false, 'error', 'You can only bid on your own behalf');
  END IF;

  SELECT ic.*, e.id AS event_id_val, e.default_budget, e.investor_budget, e.status AS event_status
  INTO v_case
  FROM public.investment_cases ic
  JOIN public.events e ON e.id = ic.event_id
  WHERE ic.id = p_investment_case_id
  FOR UPDATE OF ic;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Investment case not found');
  END IF;

  IF v_case.bidding_status NOT IN ('additive', 'competitive') THEN
    RETURN json_build_object('success', false, 'error',
      'Bidding is not open for this investment case. Status: ' || v_case.bidding_status);
  END IF;

  SELECT role INTO v_user_role
  FROM public.event_roles
  WHERE event_id = v_case.event_id AND user_id = p_investor_user_id;

  IF v_user_role NOT IN ('investor', 'attendee') THEN
    RETURN json_build_object('success', false, 'error', 'You do not have permission to bid');
  END IF;

  IF p_equity_pct NOT IN (2, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50) THEN
    RETURN json_build_object('success', false, 'error', 'Invalid equity increment');
  END IF;

  SELECT COALESCE(er.total_budget,
    CASE WHEN er.role = 'investor' THEN e.investor_budget ELSE e.default_budget END
  ) INTO v_total_budget
  FROM public.event_roles er
  JOIN public.events e ON e.id = er.event_id
  WHERE er.event_id = v_case.event_id AND er.user_id = p_investor_user_id;

  SELECT COALESCE(SUM(b.amount), 0) INTO v_committed
  FROM public.bids b
  JOIN public.investment_cases ic ON ic.id = b.investment_case_id
  WHERE ic.event_id = v_case.event_id
    AND b.investor_user_id = p_investor_user_id
    AND b.status = 'active'
    AND b.investment_case_id != p_investment_case_id;

  v_available_budget := v_total_budget - v_committed;

  IF p_amount > v_available_budget THEN
    RETURN json_build_object('success', false, 'error',
      'Insufficient budget. Available: ' || v_available_budget::text);
  END IF;

  SELECT * INTO v_existing_bid
  FROM public.bids
  WHERE investment_case_id = p_investment_case_id
    AND investor_user_id = p_investor_user_id
    AND status = 'active';

  IF FOUND THEN
    v_existing_equity := v_existing_bid.equity_pct;
  END IF;

  SELECT COALESCE(SUM(equity_pct), 0) INTO v_total_equity_sold
  FROM public.bids
  WHERE investment_case_id = p_investment_case_id
    AND status = 'active'
    AND investor_user_id != p_investor_user_id;

  v_remaining_equity := v_case.equity_offered_pct - v_total_equity_sold;
  v_phase := v_case.bidding_status;

  IF v_case.bidding_status = 'additive' THEN
    IF p_equity_pct > v_remaining_equity THEN
      RETURN json_build_object('success', false, 'error',
        'Not enough equity available. Only ' || v_remaining_equity::text || '% remaining');
    END IF;

    IF v_existing_bid.id IS NOT NULL THEN
      UPDATE public.bids SET status = 'withdrawn', updated_at = now()
      WHERE id = v_existing_bid.id;
      INSERT INTO public.bid_history (bid_id, investment_case_id, investor_user_id, event_type, equity_pct, amount, price_per_pct, phase)
      VALUES (v_existing_bid.id, p_investment_case_id, p_investor_user_id, 'withdrawn', v_existing_bid.equity_pct, v_existing_bid.amount, v_existing_bid.price_per_pct, 'additive');
    END IF;

    INSERT INTO public.bids (investment_case_id, investor_user_id, equity_pct, amount, status)
    VALUES (p_investment_case_id, p_investor_user_id, p_equity_pct, p_amount, 'active')
    RETURNING id INTO v_new_bid_id;

    SELECT COALESCE(SUM(equity_pct), 0) INTO v_total_equity_sold
    FROM public.bids WHERE investment_case_id = p_investment_case_id AND status = 'active';

    IF v_total_equity_sold >= v_case.equity_offered_pct THEN
      UPDATE public.investment_cases SET bidding_status = 'competitive', updated_at = now()
      WHERE id = p_investment_case_id;
      v_phase := 'competitive';
    END IF;

  ELSIF v_case.bidding_status = 'competitive' THEN
    DECLARE
      v_bid           record;
      v_freed_equity  numeric := 0;
      v_min_ppp       numeric;
      v_new_ppp       numeric;
    BEGIN
      v_new_ppp := p_amount / p_equity_pct;

      SELECT MIN(price_per_pct) INTO v_min_ppp
      FROM public.bids
      WHERE investment_case_id = p_investment_case_id
        AND status = 'active'
        AND investor_user_id != p_investor_user_id;

      IF v_min_ppp IS NOT NULL AND v_new_ppp <= v_min_ppp THEN
        RETURN json_build_object('success', false, 'error',
          'Your bid is not competitive enough. Minimum price per % is ' || ROUND(v_min_ppp, 2)::text);
      END IF;

      IF p_equity_pct > v_remaining_equity THEN
        FOR v_bid IN
          SELECT id, equity_pct, amount, price_per_pct, investor_user_id
          FROM public.bids
          WHERE investment_case_id = p_investment_case_id
            AND status = 'active'
            AND investor_user_id != p_investor_user_id
          ORDER BY price_per_pct ASC
        LOOP
          EXIT WHEN v_freed_equity >= (p_equity_pct - v_remaining_equity);

          UPDATE public.bids SET status = 'displaced', updated_at = now()
          WHERE id = v_bid.id;

          INSERT INTO public.bid_history (bid_id, investment_case_id, investor_user_id, event_type, equity_pct, amount, price_per_pct, phase, displaced_by_bid_id)
          VALUES (v_bid.id, p_investment_case_id, v_bid.investor_user_id, 'displaced', v_bid.equity_pct, v_bid.amount, v_bid.price_per_pct, 'competitive', v_new_bid_id);

          v_displaced_ids := array_append(v_displaced_ids, v_bid.id);
          v_freed_equity := v_freed_equity + v_bid.equity_pct;
        END LOOP;
      END IF;

      IF v_existing_bid.id IS NOT NULL THEN
        UPDATE public.bids SET status = 'withdrawn', updated_at = now()
        WHERE id = v_existing_bid.id;
        INSERT INTO public.bid_history (bid_id, investment_case_id, investor_user_id, event_type, equity_pct, amount, price_per_pct, phase)
        VALUES (v_existing_bid.id, p_investment_case_id, p_investor_user_id, 'withdrawn', v_existing_bid.equity_pct, v_existing_bid.amount, v_existing_bid.price_per_pct, 'competitive');
      END IF;

      INSERT INTO public.bids (investment_case_id, investor_user_id, equity_pct, amount, status)
      VALUES (p_investment_case_id, p_investor_user_id, p_equity_pct, p_amount, 'active')
      RETURNING id INTO v_new_bid_id;
    END;
  END IF;

  SELECT COALESCE(SUM(equity_pct), 0) INTO v_total_equity_sold
  FROM public.bids WHERE investment_case_id = p_investment_case_id AND status = 'active';

  IF v_total_equity_sold > 0 THEN
    v_implied_val := (SELECT SUM(amount) FROM public.bids WHERE investment_case_id = p_investment_case_id AND status = 'active')
                     / (v_total_equity_sold / 100.0);
  END IF;

  INSERT INTO public.bid_history (bid_id, investment_case_id, investor_user_id, event_type, equity_pct, amount, price_per_pct, phase, snapshot_equity_sold_pct, snapshot_implied_val)
  SELECT id, investment_case_id, investor_user_id, 'placed', equity_pct, amount, price_per_pct, v_phase, v_total_equity_sold, v_implied_val
  FROM public.bids WHERE id = v_new_bid_id;

  UPDATE public.investment_cases SET updated_at = now() WHERE id = p_investment_case_id;

  RETURN json_build_object(
    'success',           true,
    'bid_id',            v_new_bid_id,
    'displaced_ids',     v_displaced_ids,
    'phase',             v_phase,
    'implied_valuation', v_implied_val
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.open_bidding(
  p_investment_case_id uuid,
  p_caller_user_id     uuid
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_case record;
  v_role text;
  v_first_open boolean;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() != p_caller_user_id THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT ic.*, e.id AS ev_id INTO v_case
  FROM public.investment_cases ic
  JOIN public.events e ON e.id = ic.event_id
  WHERE ic.id = p_investment_case_id
  FOR UPDATE OF ic;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Investment case not found');
  END IF;

  SELECT role INTO v_role
  FROM public.event_roles
  WHERE event_id = v_case.event_id AND user_id = p_caller_user_id;

  IF v_role NOT IN ('host', 'event_admin') AND NOT EXISTS (
    SELECT 1 FROM public.super_admins WHERE user_id = p_caller_user_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized');
  END IF;

  IF v_case.bidding_status != 'pending' THEN
    RETURN json_build_object('success', false, 'error', 'Bidding already opened');
  END IF;

  UPDATE public.investment_cases
  SET bidding_status = 'additive', updated_at = now()
  WHERE id = p_investment_case_id;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.investment_cases
    WHERE event_id = v_case.event_id AND data_locked_at IS NOT NULL
  ) INTO v_first_open;

  IF v_first_open THEN
    UPDATE public.investment_cases
    SET data_locked_at = now()
    WHERE event_id = v_case.event_id;
  END IF;

  RETURN json_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.start_countdown(
  p_investment_case_id uuid,
  p_caller_user_id     uuid
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_case      record;
  v_role      text;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() != p_caller_user_id THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized to start countdown');
  END IF;

  SELECT ic.*, e.id AS ev_id INTO v_case
  FROM public.investment_cases ic
  JOIN public.events e ON e.id = ic.event_id
  WHERE ic.id = p_investment_case_id
  FOR UPDATE OF ic;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Investment case not found');
  END IF;

  SELECT role INTO v_role
  FROM public.event_roles
  WHERE event_id = v_case.event_id AND user_id = p_caller_user_id;

  IF v_role NOT IN ('host', 'event_admin') AND NOT EXISTS (
    SELECT 1 FROM public.super_admins WHERE user_id = p_caller_user_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized to start countdown');
  END IF;

  IF v_case.bidding_status NOT IN ('additive', 'competitive') THEN
    RETURN json_build_object('success', false, 'error',
      'Bidding must be open to start countdown. Status: ' || v_case.bidding_status);
  END IF;

  UPDATE public.investment_cases
  SET bidding_status       = 'countdown',
      countdown_started_at = now(),
      countdown_ends_at    = now() + interval '60 seconds',
      updated_at           = now()
  WHERE id = p_investment_case_id;

  RETURN json_build_object(
    'success',          true,
    'countdown_ends_at', (now() + interval '60 seconds')::text
  );
END;
$$;

-- ============================================================
-- 2. close_bidding now checks the caller's role itself instead
--    of trusting the Next.js API route to have checked it.
--    No signature change — identity comes from auth.uid();
--    a NULL auth.uid() (pure service-role/cron call) is trusted.
-- ============================================================
CREATE OR REPLACE FUNCTION public.close_bidding(
  p_investment_case_id uuid
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_case          record;
  v_role          text;
BEGIN
  SELECT * INTO v_case
  FROM public.investment_cases
  WHERE id = p_investment_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Investment case not found');
  END IF;

  IF auth.uid() IS NOT NULL THEN
    SELECT role INTO v_role
    FROM public.event_roles
    WHERE event_id = v_case.event_id AND user_id = auth.uid();

    IF v_role NOT IN ('host', 'event_admin') AND NOT EXISTS (
      SELECT 1 FROM public.super_admins WHERE user_id = auth.uid()
    ) THEN
      RETURN json_build_object('success', false, 'error', 'Not authorized to close bidding');
    END IF;
  END IF;

  IF v_case.bidding_status NOT IN ('additive', 'competitive', 'countdown') THEN
    RETURN json_build_object('success', false, 'error', 'Not in a closeable state');
  END IF;

  UPDATE public.bids SET status = 'finalized', updated_at = now()
  WHERE investment_case_id = p_investment_case_id AND status = 'active';

  INSERT INTO public.bid_history (bid_id, investment_case_id, investor_user_id, event_type, equity_pct, amount, price_per_pct, phase)
  SELECT id, investment_case_id, investor_user_id, 'finalized', equity_pct, amount, price_per_pct,
    CASE WHEN v_case.bidding_status = 'competitive' THEN 'competitive' ELSE 'additive' END
  FROM public.bids
  WHERE investment_case_id = p_investment_case_id AND status = 'finalized';

  UPDATE public.investment_cases
  SET bidding_status = 'closed', updated_at = now()
  WHERE id = p_investment_case_id;

  RETURN json_build_object('success', true);
END;
$$;

-- ============================================================
-- 3. Server-side auto-close for expired countdowns.
--    Without this, a case left in 'countdown' status (host
--    didn't click "Close Now") never closes on its own.
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.auto_close_expired_countdowns()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_case record;
BEGIN
  FOR v_case IN
    SELECT id FROM public.investment_cases
    WHERE bidding_status = 'countdown' AND countdown_ends_at < now()
  LOOP
    PERFORM public.close_bidding(v_case.id);
  END LOOP;
END;
$$;

SELECT cron.schedule(
  'auto-close-countdowns',
  '10 seconds',
  $$SELECT public.auto_close_expired_countdowns();$$
);

-- ============================================================
-- 4a. Bids: attendees may only see the current best (top)
--     active bid per case, not every investor's exact amount.
--     Investors/event_admin/host/startup/super_admin keep full
--     visibility (competitive bidding needs it). Everyone can
--     still always see their own bid via bids_read_own.
-- ============================================================
DROP POLICY IF EXISTS "bids_read_event_members" ON public.bids;

CREATE POLICY "bids_read_event_members_privileged" ON public.bids
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.investment_cases ic
      WHERE ic.id = bids.investment_case_id
        AND public.is_event_member(ic.event_id)
        AND public.my_event_role(ic.event_id) IN ('investor', 'event_admin', 'host', 'startup')
    )
  );

-- SECURITY DEFINER helper avoids RLS self-recursion: a subquery on
-- public.bids inside a public.bids policy re-triggers this same
-- policy for every row it scans, so it must run with elevated,
-- RLS-bypassing privileges like the other helper functions above.
CREATE OR REPLACE FUNCTION public.top_active_price_per_pct(p_case_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT MAX(price_per_pct) FROM public.bids
  WHERE investment_case_id = p_case_id AND status = 'active';
$$;

CREATE POLICY "bids_read_attendee_top_only" ON public.bids
  FOR SELECT USING (
    bids.status = 'active'
    AND EXISTS (
      SELECT 1 FROM public.investment_cases ic
      WHERE ic.id = bids.investment_case_id
        AND public.my_event_role(ic.event_id) = 'attendee'
    )
    AND bids.price_per_pct = public.top_active_price_per_pct(bids.investment_case_id)
  );

-- ============================================================
-- 4b. startup_profiles: contact_email is masked to NULL unless
--     the caller is the startup owner, event_admin/host/super
--     admin, or an investor. Attendees see everything else
--     (company info, pitch) but not the contact email.
--     Row-level visibility in startup_profiles_read is unchanged.
-- ============================================================
CREATE OR REPLACE VIEW public.startup_profiles_public AS
SELECT
  sp.id,
  sp.investment_case_id,
  sp.company_name,
  sp.logo_url,
  sp.pitch_deck_url,
  sp.website_url,
  sp.problem_statement,
  sp.solution,
  sp.one_liner,
  sp.industry,
  sp.traction,
  sp.founded_year,
  sp.team_size,
  sp.country,
  sp.created_at,
  sp.updated_at,
  CASE
    WHEN public.is_super_admin() THEN sp.contact_email
    WHEN ic.startup_user_id = auth.uid() THEN sp.contact_email
    WHEN public.my_event_role(ic.event_id) IN ('event_admin', 'host', 'investor') THEN sp.contact_email
    ELSE NULL
  END AS contact_email
FROM public.startup_profiles sp
JOIN public.investment_cases ic ON ic.id = sp.investment_case_id;

GRANT SELECT ON public.startup_profiles_public TO authenticated;
