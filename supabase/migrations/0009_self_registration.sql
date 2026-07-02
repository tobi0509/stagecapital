-- ============================================================
-- StageCapital — Self-Registration, Migration 0009
--
-- The Participants page has always shown a "Self-Registration Link"
-- with the text "users who register via it get Attendee role by
-- default" — but no code anywhere ever inserted an event_roles row
-- for a visiting user. The feature was purely decorative text; every
-- attendee actually had to be invited one-by-one by an Event Admin.
--
-- event_roles_insert (migration 0002) requires event_admin, so a
-- plain self-insert policy isn't safe (a user could assign themself
-- 'host' or 'event_admin'). This RPC is the narrow, safe join path:
-- it hardcodes role='attendee' and only works while the event is
-- open for registration.
-- ============================================================

CREATE OR REPLACE FUNCTION public.join_event_as_attendee(p_event_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_event record;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Event not found');
  END IF;

  IF v_event.status NOT IN ('registration_open', 'active') THEN
    RETURN json_build_object('success', false, 'error', 'This event is not open for registration');
  END IF;

  INSERT INTO public.event_roles (event_id, user_id, role)
  VALUES (p_event_id, auth.uid(), 'attendee')
  ON CONFLICT (event_id, user_id) DO NOTHING;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_event_as_attendee(uuid) TO authenticated;
