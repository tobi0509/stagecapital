-- ============================================================
-- StageCapital — Startup Ask Migration 0007
--
-- Lets the startup who owns an investment_case set their own
-- valuation and equity offered, instead of the event_admin
-- fixing it once at case creation. Only allowed while the case
-- is still 'pending' (before bidding opens) — gating on
-- bidding_status rather than data_locked_at, since
-- open_bidding() sets data_locked_at event-wide the moment any
-- case's bidding opens, which would lock out startups pitching
-- later in the same event before their own turn arrives.
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_startup_ask(
  p_investment_case_id uuid,
  p_valuation          numeric,
  p_equity_pct         numeric
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_case record;
BEGIN
  SELECT * INTO v_case FROM public.investment_cases WHERE id = p_investment_case_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Investment case not found');
  END IF;

  IF v_case.startup_user_id != auth.uid() THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized');
  END IF;

  IF v_case.bidding_status != 'pending' THEN
    RETURN json_build_object('success', false, 'error', 'Bidding has already started — ask is locked');
  END IF;

  IF p_equity_pct IS NULL OR p_equity_pct <= 0 OR p_equity_pct > 100 THEN
    RETURN json_build_object('success', false, 'error', 'Equity must be between 1 and 100');
  END IF;

  IF p_valuation IS NULL OR p_valuation <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'Valuation must be positive');
  END IF;

  UPDATE public.investment_cases
  SET equity_offered_pct = p_equity_pct,
      ask_amount         = round(p_valuation * p_equity_pct / 100, 2),
      updated_at         = now()
  WHERE id = p_investment_case_id;

  RETURN json_build_object('success', true, 'ask_amount', round(p_valuation * p_equity_pct / 100, 2));
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_startup_ask(uuid, numeric, numeric) TO authenticated;
