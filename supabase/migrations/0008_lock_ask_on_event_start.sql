-- ============================================================
-- StageCapital — Lock Startup Ask on Event Start, Migration 0008
--
-- Supersedes the 0007 gate on set_startup_ask(). That version
-- locked a startup's ask once THEIR OWN case left 'pending',
-- but the actual product rule is stricter: a startup may only
-- set their ask up until the event itself begins (i.e. the
-- moment the host opens bidding on the FIRST case of the
-- event), not until their own turn comes up. open_bidding()
-- already stamps data_locked_at on every case in the event the
-- instant that happens (see 0005_security_fixes.sql) — the same
-- signal startup_profiles_write already keys off of — so this
-- just aligns set_startup_ask with that existing, event-wide
-- lock instead of the narrower per-case bidding_status check.
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

  IF v_case.data_locked_at IS NOT NULL THEN
    RETURN json_build_object('success', false, 'error', 'The event has started — ask is locked. Contact an event admin.');
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
