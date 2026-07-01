-- ============================================================
-- StageCapital — Stored Procedures Migration 0003
-- Bidding engine: place_bid, start_countdown, close_bidding
-- All procedures run SECURITY DEFINER with explicit auth checks
-- ============================================================

-- ============================================================
-- place_bid: atomic bid placement with phase logic
-- Returns: json {success, bid_id, displaced_ids, phase, implied_valuation, error}
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
  v_event              record;
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
  -- Lock the investment case row to serialize concurrent bids
  SELECT ic.*, e.id AS event_id_val, e.default_budget, e.investor_budget, e.status AS event_status
  INTO v_case
  FROM public.investment_cases ic
  JOIN public.events e ON e.id = ic.event_id
  WHERE ic.id = p_investment_case_id
  FOR UPDATE OF ic;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Investment case not found');
  END IF;

  -- Verify bidding is open
  IF v_case.bidding_status NOT IN ('additive', 'competitive') THEN
    RETURN json_build_object('success', false, 'error',
      'Bidding is not open for this investment case. Status: ' || v_case.bidding_status);
  END IF;

  -- Verify user has investor or attendee role in this event
  SELECT role INTO v_user_role
  FROM public.event_roles
  WHERE event_id = v_case.event_id AND user_id = p_investor_user_id;

  IF v_user_role NOT IN ('investor', 'attendee') THEN
    RETURN json_build_object('success', false, 'error', 'You do not have permission to bid');
  END IF;

  -- Validate equity increment (must be one of the allowed steps)
  IF p_equity_pct NOT IN (2, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50) THEN
    RETURN json_build_object('success', false, 'error', 'Invalid equity increment');
  END IF;

  -- Calculate user's total budget
  SELECT COALESCE(er.total_budget,
    CASE WHEN er.role = 'investor' THEN e.investor_budget ELSE e.default_budget END
  ) INTO v_total_budget
  FROM public.event_roles er
  JOIN public.events e ON e.id = er.event_id
  WHERE er.event_id = v_case.event_id AND er.user_id = p_investor_user_id;

  -- Calculate committed budget (active bids across all cases in this event, EXCLUDING existing bid on this case)
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

  -- Check for existing bid on this case (will be replaced)
  SELECT * INTO v_existing_bid
  FROM public.bids
  WHERE investment_case_id = p_investment_case_id
    AND investor_user_id = p_investor_user_id
    AND status = 'active';

  IF FOUND THEN
    v_existing_equity := v_existing_bid.equity_pct;
  END IF;

  -- Get current total equity sold (excluding existing bid by this user)
  SELECT COALESCE(SUM(equity_pct), 0) INTO v_total_equity_sold
  FROM public.bids
  WHERE investment_case_id = p_investment_case_id
    AND status = 'active'
    AND investor_user_id != p_investor_user_id;

  v_remaining_equity := v_case.equity_offered_pct - v_total_equity_sold;
  v_phase := v_case.bidding_status;

  -- ==================== ADDITIVE PHASE ====================
  IF v_case.bidding_status = 'additive' THEN
    IF p_equity_pct > v_remaining_equity THEN
      RETURN json_build_object('success', false, 'error',
        'Not enough equity available. Only ' || v_remaining_equity::text || '% remaining');
    END IF;

    -- Withdraw existing bid if present
    IF v_existing_bid.id IS NOT NULL THEN
      UPDATE public.bids SET status = 'withdrawn', updated_at = now()
      WHERE id = v_existing_bid.id;
      INSERT INTO public.bid_history (bid_id, investment_case_id, investor_user_id, event_type, equity_pct, amount, price_per_pct, phase)
      VALUES (v_existing_bid.id, p_investment_case_id, p_investor_user_id, 'withdrawn', v_existing_bid.equity_pct, v_existing_bid.amount, v_existing_bid.price_per_pct, 'additive');
    END IF;

    -- Insert new bid
    INSERT INTO public.bids (investment_case_id, investor_user_id, equity_pct, amount, status)
    VALUES (p_investment_case_id, p_investor_user_id, p_equity_pct, p_amount, 'active')
    RETURNING id INTO v_new_bid_id;

    -- Recalculate total after insertion
    SELECT COALESCE(SUM(equity_pct), 0) INTO v_total_equity_sold
    FROM public.bids WHERE investment_case_id = p_investment_case_id AND status = 'active';

    -- Transition to competitive if cap reached
    IF v_total_equity_sold >= v_case.equity_offered_pct THEN
      UPDATE public.investment_cases SET bidding_status = 'competitive', updated_at = now()
      WHERE id = p_investment_case_id;
      v_phase := 'competitive';
    END IF;

  -- ==================== COMPETITIVE PHASE ====================
  ELSIF v_case.bidding_status = 'competitive' THEN
    DECLARE
      v_bid           record;
      v_freed_equity  numeric := 0;
      v_min_ppp       numeric;
      v_new_ppp       numeric;
    BEGIN
      v_new_ppp := p_amount / p_equity_pct;

      -- Get minimum price_per_pct among active bids (excluding caller's own)
      SELECT MIN(price_per_pct) INTO v_min_ppp
      FROM public.bids
      WHERE investment_case_id = p_investment_case_id
        AND status = 'active'
        AND investor_user_id != p_investor_user_id;

      IF v_min_ppp IS NOT NULL AND v_new_ppp <= v_min_ppp THEN
        RETURN json_build_object('success', false, 'error',
          'Your bid is not competitive enough. Minimum price per % is ' || ROUND(v_min_ppp, 2)::text);
      END IF;

      -- If equity is available (caller had an existing bid freeing space), proceed directly
      -- Otherwise displace cheapest bids until we have enough room
      IF p_equity_pct > v_remaining_equity THEN
        -- Displace cheapest bids to make room
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

      -- Withdraw existing bid by this user if present
      IF v_existing_bid.id IS NOT NULL THEN
        UPDATE public.bids SET status = 'withdrawn', updated_at = now()
        WHERE id = v_existing_bid.id;
        INSERT INTO public.bid_history (bid_id, investment_case_id, investor_user_id, event_type, equity_pct, amount, price_per_pct, phase)
        VALUES (v_existing_bid.id, p_investment_case_id, p_investor_user_id, 'withdrawn', v_existing_bid.equity_pct, v_existing_bid.amount, v_existing_bid.price_per_pct, 'competitive');
      END IF;

      -- Insert new bid
      INSERT INTO public.bids (investment_case_id, investor_user_id, equity_pct, amount, status)
      VALUES (p_investment_case_id, p_investor_user_id, p_equity_pct, p_amount, 'active')
      RETURNING id INTO v_new_bid_id;
    END;
  END IF;

  -- Log the new bid in history
  SELECT COALESCE(SUM(equity_pct), 0) INTO v_total_equity_sold
  FROM public.bids WHERE investment_case_id = p_investment_case_id AND status = 'active';

  IF v_total_equity_sold > 0 THEN
    v_implied_val := (SELECT SUM(amount) FROM public.bids WHERE investment_case_id = p_investment_case_id AND status = 'active')
                     / (v_total_equity_sold / 100.0);
  END IF;

  INSERT INTO public.bid_history (bid_id, investment_case_id, investor_user_id, event_type, equity_pct, amount, price_per_pct, phase, snapshot_equity_sold_pct, snapshot_implied_val)
  SELECT id, investment_case_id, investor_user_id, 'placed', equity_pct, amount, price_per_pct, v_phase, v_total_equity_sold, v_implied_val
  FROM public.bids WHERE id = v_new_bid_id;

  -- Touch updated_at on investment_case to trigger Realtime broadcast
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


-- ============================================================
-- start_countdown: host initiates 60-second close countdown
-- ============================================================
CREATE OR REPLACE FUNCTION public.start_countdown(
  p_investment_case_id uuid,
  p_caller_user_id     uuid
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_case      record;
  v_role      text;
BEGIN
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
-- open_bidding: host opens bidding for an investment case
-- ============================================================
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

  -- Lock startup data when any pitch begins (first open in the event)
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


-- ============================================================
-- close_bidding: finalize bids for an investment case
-- ============================================================
CREATE OR REPLACE FUNCTION public.close_bidding(
  p_investment_case_id uuid
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_case          record;
  v_equity_sold   numeric;
  v_capital       numeric;
  v_implied_val   numeric;
BEGIN
  SELECT * INTO v_case
  FROM public.investment_cases
  WHERE id = p_investment_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Investment case not found');
  END IF;

  IF v_case.bidding_status NOT IN ('additive', 'competitive', 'countdown') THEN
    RETURN json_build_object('success', false, 'error', 'Not in a closeable state');
  END IF;

  -- Finalize all active bids
  UPDATE public.bids SET status = 'finalized', updated_at = now()
  WHERE investment_case_id = p_investment_case_id AND status = 'active';

  -- Record finalization in history
  INSERT INTO public.bid_history (bid_id, investment_case_id, investor_user_id, event_type, equity_pct, amount, price_per_pct, phase)
  SELECT id, investment_case_id, investor_user_id, 'finalized', equity_pct, amount, price_per_pct,
    CASE WHEN v_case.bidding_status = 'competitive' THEN 'competitive' ELSE 'additive' END
  FROM public.bids
  WHERE investment_case_id = p_investment_case_id AND status = 'finalized';

  -- Mark case as closed
  UPDATE public.investment_cases
  SET bidding_status = 'closed', updated_at = now()
  WHERE id = p_investment_case_id;

  RETURN json_build_object('success', true);
END;
$$;
