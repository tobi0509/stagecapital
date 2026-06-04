-- ============================================================
-- StageCapital — Realtime & Storage Migration 0004
-- ============================================================

-- Enable Realtime on key tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.bids;
ALTER PUBLICATION supabase_realtime ADD TABLE public.investment_cases;
ALTER PUBLICATION supabase_realtime ADD TABLE public.events;

-- Storage buckets (run via Supabase dashboard or client, not SQL)
-- Bucket: 'startup-assets' (public) — logos, pitch decks
-- Bucket: 'avatars' (public) — user profile photos

-- Seed: initial super admin (replace with real email after first login)
-- INSERT INTO public.super_admins (user_id)
-- SELECT id FROM auth.users WHERE email = 'admin@stagecapital.app' LIMIT 1;
