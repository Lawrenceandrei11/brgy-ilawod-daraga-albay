-- ============================================================
-- 31_sms_announcement_gate
--
-- A second switch, so notice broadcasts can stay off while document request
-- notifications are on.
--
-- APPLIED. This migration has been applied to production and is recorded in
-- supabase_migrations.schema_migrations as version 20261010203541, name
-- 31_sms_announcement_gate. This filename matches that version. Do not apply
-- it again: the settings insert is idempotent, but the rest is not written to
-- be re-runnable.
--
-- Tested against a real Postgres with PGlite in
-- src/lib/__tests__/smsAnnouncementGate.pg.test.js, which reads THIS file.
--
-- Why this exists
-- ---------------
-- Until now `sms_enabled` armed everything. Turning it on so that a resident
-- gets a text when their clearance is ready also armed queue_announcement_sms,
-- where one click on any published notice texts every approved profile at
-- once. The two have very different blast radii -- one resident who asked for
-- a document, against the whole barangay -- and they were sharing a switch.
--
-- Note it was never captain-only: the gate inside queue_announcement_sms is
-- is_staff(), so the secretary and treasurer can broadcast too, and EXECUTE is
-- granted to `authenticated`.
--
-- What changes
-- ------------
-- Only queue_announcement_sms. queue_sms is untouched, so the document request
-- path behaves exactly as before: with sms_enabled true it still queues.
--
-- Defaulting to false
-- -------------------
-- sms_setting() is `coalesce(value ->> 'value', p_default)`, so a missing row
-- and a row holding {"value": null} both fall back to the default. Passing
-- 'false' therefore means broadcasts stay blocked when the setting is absent,
-- null, false, or any value that is not exactly 'true'. The seed below uses
-- `on conflict do nothing`, so re-running this migration can never switch
-- broadcasts on behind anyone's back.
-- ============================================================

-- ---------- the new switch ----------

insert into settings (key, value) values
  ('sms_announcements_enabled', '{"value": false}'::jsonb)
on conflict (key) do nothing;

-- ---------- the gate ----------
--
-- Unchanged from migration 16 apart from the one added check. Both switches
-- must be on, and the two refusals are worded differently so staff can tell
-- which one stopped them.

create or replace function queue_announcement_sms(p_announcement_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ann       announcements%rowtype;
  v_body      text;
  v_eligible  int := 0;
  v_no_mobile int := 0;
  v_opted_out int := 0;
  v_queued    int := 0;
  v_already   int := 0;
  r           record;
begin
  if not is_staff() then
    raise exception 'Only barangay staff can send a notice by text message.';
  end if;

  select * into v_ann from announcements where id = p_announcement_id;
  if not found then
    raise exception 'That notice no longer exists.';
  end if;

  if v_ann.published_at is null then
    raise exception 'Publish the notice before texting it to residents.';
  end if;

  if sms_setting('sms_enabled', 'false') <> 'true' then
    raise exception 'Text messaging is switched off for the barangay.';
  end if;

  -- The second switch. Document request notifications are not affected by it;
  -- this blocks only the broadcast path.
  if sms_setting('sms_announcements_enabled', 'false') <> 'true' then
    raise exception 'Texting notices to residents is switched off. Document request updates are unaffected.';
  end if;

  -- The title has no maximum length in the admin form, so it is truncated
  -- here rather than trusted.
  v_body := sms_setting('sms_sender_label', 'Brgy Ilawod') || ': '
         || left(sms_plain(v_ann.title), 105)
         || '. Full notice on the E-Assist app.';

  select count(*) into v_already
    from sms_messages where announcement_id = p_announcement_id;

  for r in
    select p.id, p.mobile, p.sms_opt_in
      from profiles p
     where p.status = 'approved'
     order by p.created_at
  loop
    v_eligible := v_eligible + 1;

    if not r.sms_opt_in then
      v_opted_out := v_opted_out + 1;
      continue;
    end if;

    if normalize_ph_mobile(r.mobile) is null then
      v_no_mobile := v_no_mobile + 1;
      continue;
    end if;

    if queue_sms(r.id, v_body, 'announcement', null, p_announcement_id, 5::smallint) is not null then
      v_queued := v_queued + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'queued',       v_queued,
    'eligible',     v_eligible,
    'no_mobile',    v_no_mobile,
    'opted_out',    v_opted_out,
    'already_sent', v_already
  );
end;
$$;

-- Unchanged from migration 16: the screen calls this as the signed-in staff
-- member, and is_staff() above is what actually decides.
grant execute on function queue_announcement_sms(uuid) to authenticated;
