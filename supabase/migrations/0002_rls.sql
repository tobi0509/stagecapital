-- ============================================================
-- StageCapital — RLS Policies Migration 0002
-- ============================================================

ALTER TABLE public.profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_roles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.super_admins        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investment_cases    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.startup_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bids                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bid_history         ENABLE ROW LEVEL SECURITY;

-- Helper: is the caller a super admin?
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.super_admins WHERE user_id = auth.uid()
  );
$$;

-- Helper: get caller's role in an event
CREATE OR REPLACE FUNCTION public.my_event_role(p_event_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM public.event_roles
  WHERE event_id = p_event_id AND user_id = auth.uid()
  LIMIT 1;
$$;

-- Helper: is caller a member of event (any role)?
CREATE OR REPLACE FUNCTION public.is_event_member(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.event_roles
    WHERE event_id = p_event_id AND user_id = auth.uid()
  );
$$;

-- ============================================================
-- profiles
-- ============================================================
CREATE POLICY "profiles_read_own" ON public.profiles
  FOR SELECT USING (id = auth.uid() OR public.is_super_admin());

CREATE POLICY "profiles_read_event_members" ON public.profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.event_roles er1
      JOIN public.event_roles er2 ON er1.event_id = er2.event_id
      WHERE er1.user_id = auth.uid() AND er2.user_id = profiles.id
    )
  );

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (id = auth.uid());

CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (id = auth.uid());

-- ============================================================
-- super_admins
-- ============================================================
CREATE POLICY "super_admins_read" ON public.super_admins
  FOR SELECT USING (public.is_super_admin() OR user_id = auth.uid());

-- ============================================================
-- events
-- ============================================================
CREATE POLICY "events_read_member" ON public.events
  FOR SELECT USING (
    public.is_super_admin()
    OR public.is_event_member(id)
    OR status IN ('registration_open','active')  -- public events visible to anyone
  );

CREATE POLICY "events_insert_super_admin" ON public.events
  FOR INSERT WITH CHECK (public.is_super_admin());

CREATE POLICY "events_update_admin" ON public.events
  FOR UPDATE USING (
    public.is_super_admin()
    OR public.my_event_role(id) = 'event_admin'
  );

CREATE POLICY "events_delete_super_admin" ON public.events
  FOR DELETE USING (public.is_super_admin());

-- ============================================================
-- event_roles
-- ============================================================
CREATE POLICY "event_roles_read" ON public.event_roles
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.is_super_admin()
    OR public.my_event_role(event_id) IN ('event_admin','host')
  );

CREATE POLICY "event_roles_insert" ON public.event_roles
  FOR INSERT WITH CHECK (
    public.is_super_admin()
    OR public.my_event_role(event_id) IN ('event_admin')
  );

CREATE POLICY "event_roles_update" ON public.event_roles
  FOR UPDATE USING (
    public.is_super_admin()
    OR public.my_event_role(event_id) = 'event_admin'
  );

CREATE POLICY "event_roles_delete" ON public.event_roles
  FOR DELETE USING (
    public.is_super_admin()
    OR public.my_event_role(event_id) = 'event_admin'
  );

-- ============================================================
-- investment_cases
-- ============================================================
CREATE POLICY "investment_cases_read" ON public.investment_cases
  FOR SELECT USING (
    public.is_super_admin()
    OR public.is_event_member(event_id)
  );

CREATE POLICY "investment_cases_insert" ON public.investment_cases
  FOR INSERT WITH CHECK (
    public.is_super_admin()
    OR public.my_event_role(event_id) = 'event_admin'
  );

CREATE POLICY "investment_cases_update" ON public.investment_cases
  FOR UPDATE USING (
    public.is_super_admin()
    OR public.my_event_role(event_id) IN ('event_admin','host')
  );

CREATE POLICY "investment_cases_delete" ON public.investment_cases
  FOR DELETE USING (
    public.is_super_admin()
    OR public.my_event_role(event_id) = 'event_admin'
  );

-- ============================================================
-- startup_profiles
-- ============================================================
CREATE POLICY "startup_profiles_read" ON public.startup_profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.investment_cases ic
      WHERE ic.id = startup_profiles.investment_case_id
        AND (public.is_super_admin() OR public.is_event_member(ic.event_id))
    )
  );

CREATE POLICY "startup_profiles_write" ON public.startup_profiles
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.investment_cases ic
      WHERE ic.id = startup_profiles.investment_case_id
        AND (
          public.is_super_admin()
          OR (ic.startup_user_id = auth.uid() AND ic.data_locked_at IS NULL)
          OR public.my_event_role(ic.event_id) = 'event_admin'
        )
    )
  );

-- ============================================================
-- team_members
-- ============================================================
CREATE POLICY "team_members_read" ON public.team_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.startup_profiles sp
      JOIN public.investment_cases ic ON ic.id = sp.investment_case_id
      WHERE sp.id = team_members.startup_profile_id
        AND (public.is_super_admin() OR public.is_event_member(ic.event_id))
    )
  );

CREATE POLICY "team_members_write" ON public.team_members
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.startup_profiles sp
      JOIN public.investment_cases ic ON ic.id = sp.investment_case_id
      WHERE sp.id = team_members.startup_profile_id
        AND (
          public.is_super_admin()
          OR (ic.startup_user_id = auth.uid() AND ic.data_locked_at IS NULL)
        )
    )
  );

-- ============================================================
-- bids — users can only INSERT via API (service role), direct writes blocked
-- ============================================================
CREATE POLICY "bids_read_own" ON public.bids
  FOR SELECT USING (
    investor_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.investment_cases ic
      WHERE ic.id = bids.investment_case_id
        AND (
          public.is_super_admin()
          OR ic.startup_user_id = auth.uid()
          OR public.my_event_role(ic.event_id) IN ('event_admin','host')
        )
    )
  );

-- Investors can read all bids in an event (for bid list display)
CREATE POLICY "bids_read_event_members" ON public.bids
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.investment_cases ic
      WHERE ic.id = bids.investment_case_id
        AND public.is_event_member(ic.event_id)
    )
  );

-- ============================================================
-- bid_history
-- ============================================================
CREATE POLICY "bid_history_read_own" ON public.bid_history
  FOR SELECT USING (
    investor_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.investment_cases ic
      WHERE ic.id = bid_history.investment_case_id
        AND (public.is_super_admin() OR public.my_event_role(ic.event_id) IN ('event_admin','host'))
    )
  );
