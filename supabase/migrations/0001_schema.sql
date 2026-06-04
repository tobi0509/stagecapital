-- ============================================================
-- StageCapital — Schema Migration 0001
-- Core tables: profiles, events, event_roles, investment_cases,
--              startup_profiles, team_members, bids, bid_history
-- ============================================================

-- Profiles (extends auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         text NOT NULL,
  display_name  text NOT NULL DEFAULT '',
  avatar_url    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Events
CREATE TABLE IF NOT EXISTS public.events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text UNIQUE NOT NULL,
  name             text NOT NULL,
  description      text,
  event_date       date NOT NULL,
  status           text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','registration_open','active','closed','results_published')),
  default_budget   numeric(12,2) NOT NULL DEFAULT 50000.00,
  investor_budget  numeric(12,2) NOT NULL DEFAULT 150000.00,
  logo_url         text,
  created_by       uuid NOT NULL REFERENCES public.profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_slug ON public.events(slug);
CREATE INDEX IF NOT EXISTS idx_events_status ON public.events(status);

-- Event Roles (user → role → event mapping)
CREATE TABLE IF NOT EXISTS public.event_roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('super_admin','event_admin','host','startup','investor','attendee')),
  total_budget numeric(12,2),
  joined_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_roles_event_id ON public.event_roles(event_id);
CREATE INDEX IF NOT EXISTS idx_event_roles_user_id  ON public.event_roles(user_id);

-- Super-admin role table (platform-wide, not per-event)
CREATE TABLE IF NOT EXISTS public.super_admins (
  user_id    uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now()
);

-- Investment Cases (one per startup pitch per event)
CREATE TABLE IF NOT EXISTS public.investment_cases (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id             uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  startup_user_id      uuid NOT NULL REFERENCES public.profiles(id),
  title                text NOT NULL DEFAULT '',
  equity_offered_pct   numeric(5,2) NOT NULL DEFAULT 20.00
                       CHECK (equity_offered_pct > 0 AND equity_offered_pct <= 100),
  ask_amount           numeric(12,2) NOT NULL DEFAULT 500000.00
                       CHECK (ask_amount > 0),
  pitch_order          integer NOT NULL DEFAULT 0,
  bidding_status       text NOT NULL DEFAULT 'pending'
                       CHECK (bidding_status IN ('pending','additive','competitive','countdown','closed')),
  countdown_started_at timestamptz,
  countdown_ends_at    timestamptz,
  data_locked_at       timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, startup_user_id)
);

CREATE INDEX IF NOT EXISTS idx_investment_cases_event_id ON public.investment_cases(event_id);
CREATE INDEX IF NOT EXISTS idx_investment_cases_status   ON public.investment_cases(bidding_status);

-- Startup Profiles (filled in by startup before event)
CREATE TABLE IF NOT EXISTS public.startup_profiles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investment_case_id uuid UNIQUE NOT NULL REFERENCES public.investment_cases(id) ON DELETE CASCADE,
  company_name       text NOT NULL DEFAULT '',
  logo_url           text,
  pitch_deck_url     text,
  website_url        text,
  contact_email      text,
  problem_statement  text,
  solution           text,
  one_liner          text,
  industry           text,
  traction           text,
  founded_year       integer,
  team_size          integer,
  country            text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Team Members (max 3 per startup)
CREATE TABLE IF NOT EXISTS public.team_members (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  startup_profile_id uuid NOT NULL REFERENCES public.startup_profiles(id) ON DELETE CASCADE,
  name               text NOT NULL,
  title              text NOT NULL,
  avatar_url         text,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_members_profile ON public.team_members(startup_profile_id);

-- Bids (current active state only)
CREATE TABLE IF NOT EXISTS public.bids (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investment_case_id uuid NOT NULL REFERENCES public.investment_cases(id) ON DELETE CASCADE,
  investor_user_id   uuid NOT NULL REFERENCES public.profiles(id),
  equity_pct         numeric(5,2) NOT NULL CHECK (equity_pct > 0 AND equity_pct <= 100),
  amount             numeric(12,2) NOT NULL CHECK (amount > 0),
  price_per_pct      numeric(14,4) GENERATED ALWAYS AS (amount / equity_pct) STORED,
  status             text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','displaced','withdrawn','finalized')),
  placed_at          timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (investment_case_id, investor_user_id)
);

CREATE INDEX IF NOT EXISTS idx_bids_investment_case ON public.bids(investment_case_id);
CREATE INDEX IF NOT EXISTS idx_bids_investor        ON public.bids(investor_user_id);
CREATE INDEX IF NOT EXISTS idx_bids_competitive
  ON public.bids(investment_case_id, price_per_pct ASC)
  WHERE status = 'active';

-- Bid History (append-only audit log)
CREATE TABLE IF NOT EXISTS public.bid_history (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id                   uuid NOT NULL REFERENCES public.bids(id),
  investment_case_id       uuid NOT NULL REFERENCES public.investment_cases(id),
  investor_user_id         uuid NOT NULL REFERENCES public.profiles(id),
  event_type               text NOT NULL
                           CHECK (event_type IN ('placed','updated','displaced','withdrawn','finalized')),
  equity_pct               numeric(5,2) NOT NULL,
  amount                   numeric(12,2) NOT NULL,
  price_per_pct            numeric(14,4) NOT NULL,
  phase                    text NOT NULL CHECK (phase IN ('additive','competitive')),
  displaced_by_bid_id      uuid REFERENCES public.bids(id),
  snapshot_equity_sold_pct numeric(5,2),
  snapshot_implied_val     numeric(15,2),
  recorded_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bid_history_case     ON public.bid_history(investment_case_id);
CREATE INDEX IF NOT EXISTS idx_bid_history_investor ON public.bid_history(investor_user_id);
CREATE INDEX IF NOT EXISTS idx_bid_history_time     ON public.bid_history(recorded_at DESC);

-- Live valuation view
CREATE OR REPLACE VIEW public.v_investment_case_live AS
SELECT
  ic.id                                                              AS investment_case_id,
  ic.event_id,
  ic.equity_offered_pct,
  ic.ask_amount,
  ic.bidding_status,
  ic.countdown_ends_at,
  ic.pitch_order,
  COALESCE(SUM(b.equity_pct) FILTER (WHERE b.status = 'active'), 0) AS total_equity_sold_pct,
  COALESCE(SUM(b.amount)     FILTER (WHERE b.status = 'active'), 0) AS total_capital_raised,
  CASE
    WHEN COALESCE(SUM(b.equity_pct) FILTER (WHERE b.status = 'active'), 0) = 0 THEN NULL
    ELSE (SUM(b.amount) FILTER (WHERE b.status = 'active'))
         / (SUM(b.equity_pct) FILTER (WHERE b.status = 'active') / 100.0)
  END                                                                AS implied_valuation,
  COUNT(*) FILTER (WHERE b.status = 'active')                       AS active_bid_count
FROM public.investment_cases ic
LEFT JOIN public.bids b ON b.investment_case_id = ic.id
GROUP BY ic.id;

-- updated_at trigger helper
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_events_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER trg_investment_cases_updated_at
  BEFORE UPDATE ON public.investment_cases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER trg_startup_profiles_updated_at
  BEFORE UPDATE ON public.startup_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER trg_bids_updated_at
  BEFORE UPDATE ON public.bids
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
