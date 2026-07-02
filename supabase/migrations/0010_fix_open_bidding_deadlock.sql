-- ============================================================
-- StageCapital — open_bidding deadlock fix, Migration 0010
--
-- Found via a genuine concurrency test: a host opening two different
-- investment cases in the same event at the exact same instant hit a
-- real Postgres deadlock (40P01), not a slow queue.
--
-- Root cause: open_bidding locks the specific case being opened via
-- `FOR UPDATE OF ic`, then later does a broad
-- `UPDATE investment_cases SET data_locked_at = now() WHERE event_id = ...`
-- to lock startup data on the event's first pitch — which touches
-- every case in the event, including ones locked by a concurrent
-- call. Two simultaneous open_bidding calls for Case A and Case B:
--   Txn A: locks Case A, then wants Case B (for the bulk update)
--   Txn B: locks Case B, then wants Case A (for the bulk update)
-- Classic AB-BA deadlock.
--
-- Fix: lock the parent event row FIRST, before locking any
-- investment_cases row. Every open_bidding call for a given event
-- now contends for that single row in the same order, so concurrent
-- calls queue instead of deadlocking.
-- ============================================================

CREATE OR REPLACE FUNCTION public.open_bidding(
  p_investment_case_id uuid,
  p_caller_user_id     uuid
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_case        record;
  v_role        text;
  v_first_open  boolean;
  v_event_id    uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() != p_caller_user_id THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT event_id INTO v_event_id FROM public.investment_cases WHERE id = p_investment_case_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Investment case not found');
  END IF;

  -- Single serialization point for this event — see comment above.
  PERFORM 1 FROM public.events WHERE id = v_event_id FOR UPDATE;

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
