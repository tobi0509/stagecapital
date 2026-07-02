-- ============================================================
-- StageCapital — cross-case budget race fix, Migration 0011
--
-- Found via a genuine concurrency test: an investor with a $150,000
-- budget fired two simultaneous bids of $100,000 each on two
-- DIFFERENT startups in the same event. Both succeeded — $200,000
-- committed against a $150,000 budget, a 33% overspend.
--
-- Root cause: place_bid takes `FOR UPDATE OF ic` on the specific
-- investment_case row being bid on, which correctly serializes
-- competing bids ON THAT CASE. But the budget check sums this
-- investor's active bids ACROSS EVERY CASE IN THE EVENT — a
-- cross-row invariant that no single case-row lock protects. Two
-- concurrent calls for the same investor on two different cases
-- each lock a different, uncontended row, so both read "0 committed
-- elsewhere" before either has inserted its bid, and both pass the
-- budget check.
--
-- Fix: take a Postgres advisory transaction lock keyed on
-- (event_id, investor_user_id) before computing the budget. This is
-- the one lock every concurrent place_bid call for the same investor
-- in the same event contends for, regardless of which case each call
-- targets — serializing exactly the cross-case invariant that was
-- unprotected, while leaving different investors' bids (different
-- lock key) fully concurrent.
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
  v_event_id           uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() != p_investor_user_id THEN
    RETURN json_build_object('success', false, 'error', 'You can only bid on your own behalf');
  END IF;

  SELECT event_id INTO v_event_id FROM public.investment_cases WHERE id = p_investment_case_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Investment case not found');
  END IF;

  -- Serializes every concurrent place_bid call by this investor in
  -- this event — see migration comment above. Must happen before the
  -- budget computation below, and before locking the case row, so a
  -- second simultaneous call by the same investor (on any case) waits
  -- here until the first call's transaction fully commits or aborts.
  PERFORM pg_advisory_xact_lock(hashtext(v_event_id::text), hashtext(p_investor_user_id::text));

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
