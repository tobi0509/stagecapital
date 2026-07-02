-- ============================================================
-- StageCapital — Valuation Aggregate Fix, Migration 0006
--
-- Found live during an end-to-end event simulation: the
-- invest-page ticker, the pitch/big-screen view, and the
-- leaderboard all compute implied valuation / capital raised /
-- equity sold by summing whatever rows of public.bids the
-- viewer's RLS happens to expose. That was already slightly
-- wrong for closed cases (only 'active' bids were summed, but
-- close_bidding flips everything to 'finalized'), and migration
-- 0005's attendee-visibility restriction made it much worse —
-- an attendee's valuation ticker and the leaderboard now only
-- reflect ONE visible bid, not the true event-wide total.
--
-- Fix: case-level aggregates must never depend on per-row bid
-- visibility. These SECURITY DEFINER functions compute the true
-- totals across all bids regardless of who is asking; only the
-- per-row bid *list* (who bid what) stays subject to the
-- migration 0005 RLS policies.
-- ============================================================

CREATE OR REPLACE FUNCTION public.case_valuation_stats(p_case_id uuid)
RETURNS TABLE (
  total_equity_sold_pct numeric,
  total_capital_raised  numeric,
  implied_valuation     numeric,
  investor_count        integer
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    COALESCE(SUM(b.equity_pct), 0) AS total_equity_sold_pct,
    COALESCE(SUM(b.amount), 0)     AS total_capital_raised,
    CASE WHEN COALESCE(SUM(b.equity_pct), 0) = 0 THEN NULL
         ELSE SUM(b.amount) / (SUM(b.equity_pct) / 100.0)
    END AS implied_valuation,
    COUNT(DISTINCT b.investor_user_id)::int AS investor_count
  FROM public.bids b
  WHERE b.investment_case_id = p_case_id
    AND b.status IN ('active', 'finalized');
$$;

GRANT EXECUTE ON FUNCTION public.case_valuation_stats(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.event_valuation_stats(p_event_id uuid)
RETURNS TABLE (
  investment_case_id    uuid,
  total_equity_sold_pct numeric,
  total_capital_raised  numeric,
  implied_valuation     numeric,
  investor_count        integer
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    ic.id AS investment_case_id,
    COALESCE(SUM(b.equity_pct), 0) AS total_equity_sold_pct,
    COALESCE(SUM(b.amount), 0)     AS total_capital_raised,
    CASE WHEN COALESCE(SUM(b.equity_pct), 0) = 0 THEN NULL
         ELSE SUM(b.amount) / (SUM(b.equity_pct) / 100.0)
    END AS implied_valuation,
    COUNT(DISTINCT b.investor_user_id)::int AS investor_count
  FROM public.investment_cases ic
  LEFT JOIN public.bids b ON b.investment_case_id = ic.id AND b.status IN ('active', 'finalized')
  WHERE ic.event_id = p_event_id
  GROUP BY ic.id;
$$;

GRANT EXECUTE ON FUNCTION public.event_valuation_stats(uuid) TO authenticated;

-- v_investment_case_live had the same 'active'-only bug (blind
-- to finalized/closed cases) and is superseded by the function
-- above; drop it to avoid a second, inconsistent source of truth.
DROP VIEW IF EXISTS public.v_investment_case_live;
