-- ============================================================
-- StageCapital — Storage Buckets & Policies, Migration 0007
--
-- The 'startup-assets' and 'avatars' buckets were only ever a
-- comment in migration 0004 ("run via dashboard or client, not
-- SQL") and were never actually created — logo and pitch deck
-- upload had no bucket to write to. Buckets are created via the
-- Management API as part of this change; this migration adds the
-- RLS policies storage needs regardless of who created them.
--
-- Path convention for startup-assets: {investment_case_id}/logo.*
-- and {investment_case_id}/pitch-deck.pdf — ownership is checked
-- against investment_cases.startup_user_id via that path segment.
-- ============================================================

CREATE POLICY "startup_assets_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'startup-assets');

CREATE POLICY "startup_assets_owner_write" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'startup-assets'
    AND EXISTS (
      SELECT 1 FROM public.investment_cases ic
      WHERE ic.id::text = (storage.foldername(name))[1]
        AND (
          ic.startup_user_id = auth.uid()
          OR public.my_event_role(ic.event_id) = 'event_admin'
          OR public.is_super_admin()
        )
        AND ic.data_locked_at IS NULL
    )
  );

CREATE POLICY "startup_assets_owner_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'startup-assets'
    AND EXISTS (
      SELECT 1 FROM public.investment_cases ic
      WHERE ic.id::text = (storage.foldername(name))[1]
        AND (
          ic.startup_user_id = auth.uid()
          OR public.my_event_role(ic.event_id) = 'event_admin'
          OR public.is_super_admin()
        )
        AND ic.data_locked_at IS NULL
    )
  );

CREATE POLICY "startup_assets_owner_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'startup-assets'
    AND EXISTS (
      SELECT 1 FROM public.investment_cases ic
      WHERE ic.id::text = (storage.foldername(name))[1]
        AND (
          ic.startup_user_id = auth.uid()
          OR public.my_event_role(ic.event_id) = 'event_admin'
          OR public.is_super_admin()
        )
        AND ic.data_locked_at IS NULL
    )
  );

-- Avatars: path convention {user_id}/avatar.* — each user manages their own.
CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

CREATE POLICY "avatars_owner_write" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars_owner_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars_owner_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text
  );
