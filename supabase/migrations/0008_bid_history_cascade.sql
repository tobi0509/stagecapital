-- ============================================================
-- StageCapital — bid_history cascade fix, Migration 0008
--
-- Found while writing an automated test's cleanup step: deleting
-- an event never actually deleted it if a single bid had ever been
-- placed. events -> investment_cases -> bids all cascade correctly,
-- but bid_history.investment_case_id had no ON DELETE behavior
-- (defaults to RESTRICT), so Postgres blocked the delete with a
-- foreign key violation instead. Same blocker would hit a super
-- admin trying to delete a real mistaken/test event in production.
-- ============================================================

ALTER TABLE public.bid_history
  DROP CONSTRAINT bid_history_investment_case_id_fkey,
  ADD CONSTRAINT bid_history_investment_case_id_fkey
    FOREIGN KEY (investment_case_id) REFERENCES public.investment_cases(id) ON DELETE CASCADE;
