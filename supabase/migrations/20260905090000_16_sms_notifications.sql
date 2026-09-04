-- ============================================================
-- SMS notifications
--
-- Residents are told nothing until they sign in. This sends a text when a
-- request reaches a status they must act on, and when staff deliberately
-- choose to text a notice out.
--
-- Two facts shape everything below.
--
-- 1. The app has no server. It is a browser-only Vite SPA, so the SMS API key
--    cannot live in the bundle. It lives in the sms-dispatch Edge Function,
--    the same way the service role key lives in face-login. Nothing here ever
--    sees it.
--
-- 2. The provider allows one message every ten seconds. A notice sent to two
--    hundred residents therefore takes half an hour. That cannot happen inside
--    one HTTP request, so SMS is an outbox drained by a paced worker rather
--    than a loop in a click handler.
--
-- The consequence worth stating plainly: queueing a text is a local INSERT
-- inside the transaction that already succeeded. Approving a clearance never
-- touches the network, so the provider being down cannot stop barangay work.
-- ============================================================

-- ------------------------------------------------------------
-- Extensions
--
-- Wrapped, because a local `supabase db reset` may not have the privilege to
-- create them. A missing extension must degrade to "no texts are sent", never
-- to "the migration will not apply".
-- ------------------------------------------------------------
-- Note on the advisor warning this produces: pg_net registers itself against
-- `public` and cannot be moved (ALTER EXTENSION ... SET SCHEMA is refused,
-- because it owns its own `net` schema). It puts nothing in `public` — every
-- one of its functions and tables is in `net`, which PostgREST does not
-- expose — so `extension_in_public` is cosmetic here, not a hole.
do $$
begin
  begin
    create extension if not exists pg_net;
  exception when others then
    raise warning 'pg_net could not be enabled here (%). Enable it in the dashboard.', sqlerrm;
  end;

  begin
    create extension if not exists pg_cron;
  exception when others then
    raise warning 'pg_cron could not be enabled here (%). Enable it in the dashboard.', sqlerrm;
  end;
end $$;

-- ------------------------------------------------------------
-- Resident opt-out
--
-- Deliberately NOT added to guard_profile_columns. That trigger is a deny-list
-- of columns only staff may change; leaving this column out of it is what lets
-- a resident switch their own texts off, which is the entire point.
-- ------------------------------------------------------------
alter table profiles
  add column if not exists sms_opt_in boolean not null default true;

comment on column profiles.sms_opt_in is
  'Resident consent for SMS. Deliberately absent from guard_profile_columns so the resident can change it.';

-- ------------------------------------------------------------
-- The outbox
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'sms_status') then
    create type sms_status as enum ('queued', 'sending', 'sent', 'failed', 'skipped');
  end if;
end $$;

create table if not exists sms_messages (
  id                uuid primary key default gen_random_uuid(),

  profile_id        uuid references profiles(id) on delete set null,

  -- Denormalised on purpose: the log must still say where a message went
  -- after the resident edits their number or the record is removed.
  recipient         text,
  -- Where it actually went. Differs from `recipient` only when
  -- sms_test_recipient is set, so a redirected test is visible rather than
  -- hidden.
  sent_to           text,

  body              text not null,
  kind              text not null check (kind in ('request_status', 'announcement')),

  request_id        uuid references document_requests(id) on delete set null,
  announcement_id   uuid references announcements(id) on delete cascade,

  -- Not decoration. Without it a five-hundred-person broadcast puts a
  -- "ready for pickup" text hours behind it. Status texts queue at 1.
  priority          smallint not null default 5,

  status            sms_status not null default 'queued',
  skip_reason       text,

  attempts          int not null default 0,
  last_error        text,
  provider_response jsonb,

  next_attempt_at   timestamptz not null default now(),
  claimed_at        timestamptz,
  sent_at           timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists sms_messages_claim_idx
  on sms_messages (status, priority, next_attempt_at);
create index if not exists sms_messages_request_idx
  on sms_messages (request_id, created_at desc);
create index if not exists sms_messages_created_idx
  on sms_messages (created_at desc);

-- One text per resident per notice, forever. A double-click or a re-save of a
-- published notice must never blast the barangay twice.
create unique index if not exists sms_messages_announcement_once
  on sms_messages (announcement_id, profile_id)
  where announcement_id is not null;

-- ------------------------------------------------------------
-- Helpers
-- ------------------------------------------------------------

-- Runtime knobs live in `settings` as {"value": ...}, the same shape
-- face-login reads for its lockout thresholds.
create or replace function sms_setting(p_key text, p_default text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select value ->> 'value' from settings where key = p_key), p_default);
$$;

-- The app stores 09XXXXXXXXX; the provider wants E.164. Anything that cannot
-- be read as a Philippine mobile returns null, which becomes a `skipped` row
-- rather than a failed send.
create or replace function normalize_ph_mobile(p_mobile text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when d ~ '^00639[0-9]{9}$' then '+' || substr(d, 3)
    when d ~ '^639[0-9]{9}$'   then '+' || d
    when d ~ '^09[0-9]{9}$'    then '+63' || substr(d, 2)
    when d ~ '^9[0-9]{9}$'     then '+63' || d
    else null
  end
  from (select regexp_replace(coalesce(p_mobile, ''), '[^0-9]', '', 'g') as d) s;
$$;

-- GSM-7 does not contain the peso sign, em/en dashes or curly quotes. A single
-- one of them silently flips the whole message to UCS-2 and the segment drops
-- from 160 characters to 70. status.js already contains an em dash, so this is
-- one copy-paste away at all times. Fold what we can, strip the rest.
create or replace function sms_plain(p_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(
           translate(
             replace(coalesce(p_text, ''), chr(8369), 'PHP '),
             chr(8216) || chr(8217) || chr(8220) || chr(8221)
               || chr(8211) || chr(8212) || chr(160),
             repeat(chr(39), 2) || repeat(chr(34), 2) || '-- '
           ),
           '[^ -~]', '', 'g');
$$;

-- The resident-facing copy, in one place. Plain English matching status.js --
-- the app has no Taglish anywhere, so introducing it in SMS only would read as
-- a different product. The service name is left out deliberately: the
-- reference number already identifies the request, and service names range
-- from 18 to 27 characters, which would make the length unpredictable.
create or replace function sms_message_for_request(r document_requests)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select sms_plain(
    sms_setting('sms_sender_label', 'Brgy Ilawod') || ': Request ' || r.ref_no || ' ' ||
    case r.status
      when 'approved' then
        'is approved. Your document is being prepared. We will text you when it is ready for pickup.'
      when 'ready' then
        'is ready for pickup at the barangay hall. Bring a valid ID'
        || case
             when r.fee > 0 and not r.fee_paid
               then ' and the PHP ' || to_char(r.fee, 'FM999999') || ' fee.'
             else '. Office hours 8am to 5pm, Monday to Friday.'
           end
      when 'released' then
        'has been released and collected. Thank you. This request is now complete.'
      -- The remarks themselves are not included: unbounded textarea input,
      -- full of exactly the punctuation that breaks GSM-7.
      when 'rejected' then
        'needs correction. Sign in to Barangay E-Assist to read the remarks and re-submit it, or visit the barangay hall.'
      when 'scheduled' then
        'has an appointment set. Sign in to Barangay E-Assist to see the date and time.'
      else null
    end
  );
$$;

-- ------------------------------------------------------------
-- The only writer
--
-- Ineligible residents get a `skipped` row rather than silence, so the log
-- answers "why did nobody get a text?" without anyone reading this file.
-- ------------------------------------------------------------
create or replace function queue_sms(
  p_profile_id      uuid,
  p_body            text,
  p_kind            text,
  p_request_id      uuid default null,
  p_announcement_id uuid default null,
  p_priority        smallint default 5
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile   profiles%rowtype;
  v_recipient text;
  v_status    sms_status := 'queued';
  v_reason    text;
  v_id        uuid;
begin
  if p_body is null or btrim(p_body) = '' then
    return null;
  end if;

  -- The barangay-wide switch queues nothing at all, so turning SMS on later
  -- does not release a backlog of stale texts.
  if sms_setting('sms_enabled', 'false') <> 'true' then
    return null;
  end if;

  select * into v_profile from profiles where id = p_profile_id;
  if not found then
    return null;
  end if;

  v_recipient := normalize_ph_mobile(v_profile.mobile);

  if v_profile.status <> 'approved' then
    v_status := 'skipped';
    v_reason := 'Resident record is not approved.';
  elsif not v_profile.sms_opt_in then
    v_status := 'skipped';
    v_reason := 'Resident has turned text messages off.';
  elsif v_recipient is null then
    v_status := 'skipped';
    v_reason := 'No usable mobile number on file.';
  end if;

  insert into sms_messages (
    profile_id, recipient, body, kind, request_id, announcement_id,
    priority, status, skip_reason
  )
  values (
    p_profile_id,
    v_recipient,
    -- Last line of defence on both encoding and length.
    left(sms_plain(p_body), 160),
    p_kind,
    p_request_id,
    p_announcement_id,
    coalesce(p_priority, 5),
    v_status,
    v_reason
  )
  on conflict do nothing
  returning id into v_id;

  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- Request status changes
--
-- AFTER, so it runs once the row is written and all three existing BEFORE
-- triggers (guard_columns, log_update, touch) have had their say.
-- ------------------------------------------------------------
create or replace function notify_request_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- `AFTER UPDATE OF status` fires whenever the column is *mentioned*, not
  -- only when it changes, so this guard is doing real work.
  if new.status is not distinct from old.status then
    return null;
  end if;

  -- pending and processing are internal bookkeeping. Texting them doubles the
  -- traffic and tells the resident nothing they can act on.
  if new.status not in ('approved', 'ready', 'released', 'rejected', 'scheduled') then
    return null;
  end if;

  begin
    perform queue_sms(
      new.profile_id,
      sms_message_for_request(new),
      'request_status',
      new.id,
      null,
      1::smallint
    );
  exception when others then
    -- The whole point. Without this, a bad settings row or a constraint
    -- violation would abort the UPDATE and the secretary would be told the
    -- approval could not be saved. A text message must never be able to stop
    -- a clearance being issued.
    raise warning 'notify_request_status: could not queue SMS for % (%)', new.ref_no, sqlerrm;
  end;

  return null;
end;
$$;

drop trigger if exists document_requests_notify_sms on document_requests;
create trigger document_requests_notify_sms
  after update of status on document_requests
  for each row execute function notify_request_status();

-- ------------------------------------------------------------
-- Announcements
--
-- Never automatic. Staff tick a box, having been shown how many residents that
-- is and how long it will take.
-- ------------------------------------------------------------
create or replace function sms_recipient_count()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare result jsonb;
begin
  if not is_staff() then
    raise exception 'Only barangay staff can see how many residents would be texted.';
  end if;

  select jsonb_build_object(
    'eligible',  count(*),
    'reachable', count(*) filter (
                   where sms_opt_in and normalize_ph_mobile(mobile) is not null),
    'no_mobile', count(*) filter (where normalize_ph_mobile(mobile) is null),
    'opted_out', count(*) filter (where not sms_opt_in)
  )
  into result
  from profiles
  where status = 'approved';

  return result;
end;
$$;

create or replace function queue_announcement_sms(p_announcement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

-- ------------------------------------------------------------
-- Handing work to the dispatcher
--
-- This function, not the Edge Function, is where pacing is enforced. The
-- dispatcher is deliberately dumb: it sends whatever it is given.
-- ------------------------------------------------------------
create or replace function claim_sms(p_stale_seconds int default 180)
returns setof sms_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gap int := coalesce(sms_setting('sms_min_gap_seconds', '10')::int, 10);
  v_cap int := coalesce(sms_setting('sms_daily_cap', '300')::int, 300);
begin
  -- try_, not the blocking form: an overlapping tick should go away
  -- empty-handed rather than queue up behind the one in flight. Transaction
  -- scoped, so it cannot leak if this call dies.
  if not pg_try_advisory_xact_lock(hashtext('sms_dispatch')::bigint) then
    return;
  end if;

  -- Rescue anything a dispatcher claimed and never reported on.
  update sms_messages
     set status = 'queued', next_attempt_at = now()
   where status = 'sending'
     and claimed_at < now() - make_interval(secs => p_stale_seconds);

  -- Gate 1: never two in flight. This is what absorbs a 30-60 second Render
  -- cold start, during which several ticks will fire.
  if exists (select 1 from sms_messages where status = 'sending') then
    return;
  end if;

  -- Gate 2: never two inside the provider's window, for the fast case.
  if (select max(claimed_at) from sms_messages) > now() - make_interval(secs => v_gap) then
    return;
  end if;

  -- A runaway loop must not burn the day's free quota.
  if (select count(*) from sms_messages where sent_at > now() - interval '24 hours') >= v_cap then
    raise warning 'sms daily cap of % reached; holding the queue.', v_cap;
    return;
  end if;

  return query
  with due as (
    select id
      from sms_messages
     where status = 'queued'
       and next_attempt_at <= now()
     order by priority, next_attempt_at, created_at
     limit 1
     for update skip locked
  ),
  claimed as (
    update sms_messages m
       set status     = 'sending',
           claimed_at = now(),
           -- Counted at claim time, so a dispatcher that dies still burns an
           -- attempt and a poisonous row cannot loop forever.
           attempts   = m.attempts + 1
      from due
     where m.id = due.id
    returning m.*
  )
  select * from claimed;
end;
$$;

-- ------------------------------------------------------------
-- The tick
--
-- Wakes the Edge Function only when there is due work, so an idle barangay
-- costs one index probe every ten seconds.
-- ------------------------------------------------------------
create or replace function dispatch_sms_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_url    text;
begin
  if not exists (
    select 1 from sms_messages
     where status = 'queued' and next_attempt_at <= now()
  ) then
    return;
  end if;

  -- Something is already in flight; claim_sms would refuse anyway.
  if exists (select 1 from sms_messages where status = 'sending') then
    return;
  end if;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'sms_dispatch_secret';

  v_url := sms_setting('sms_dispatch_url', '');

  if v_secret is null or v_url = '' then
    raise warning 'SMS dispatch is not configured yet (vault secret or sms_dispatch_url missing).';
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-sms-dispatch-secret', v_secret
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
exception when others then
  raise warning 'dispatch_sms_tick failed: %', sqlerrm;
end;
$$;

-- ------------------------------------------------------------
-- Retention
--
-- This table holds phone numbers and message bodies, and the resident Profile
-- page promises erasure. Six months is long enough to answer "was I told?"
-- ------------------------------------------------------------
create or replace function purge_old_sms(p_days int default 180)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_count int;
begin
  delete from sms_messages
   where created_at < now() - make_interval(days => p_days)
     and status in ('sent', 'failed', 'skipped');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ------------------------------------------------------------
-- Row Level Security
--
-- Staff may read the log. Nobody writes through the API at all: the trigger
-- and the RPCs are SECURITY DEFINER, and the dispatcher uses the service role.
-- Same shape as request_status_history.
-- ------------------------------------------------------------
alter table sms_messages enable row level security;

-- Supabase grants `all` on new public tables by default; say otherwise.
revoke all on table sms_messages from anon, authenticated;
grant select on table sms_messages to authenticated;

drop policy if exists sms_staff_read on sms_messages;
create policy sms_staff_read on sms_messages
  for select to authenticated
  using (is_staff());

-- ------------------------------------------------------------
-- Grants
-- ------------------------------------------------------------
revoke all on function sms_setting(text, text)                            from public, anon, authenticated;
revoke all on function sms_message_for_request(document_requests)          from public, anon, authenticated;
revoke all on function queue_sms(uuid, text, text, uuid, uuid, smallint)   from public, anon, authenticated;
revoke all on function notify_request_status()                            from public, anon, authenticated;
revoke all on function claim_sms(int)                                     from public, anon, authenticated;
revoke all on function dispatch_sms_tick()                                from public, anon, authenticated;
revoke all on function purge_old_sms(int)                                 from public, anon, authenticated;
revoke all on function queue_announcement_sms(uuid)                       from public, anon;
revoke all on function sms_recipient_count()                              from public, anon;
revoke all on function normalize_ph_mobile(text)                          from public, anon;
revoke all on function sms_plain(text)                                    from public, anon;

grant execute on function queue_announcement_sms(uuid) to authenticated;
grant execute on function sms_recipient_count()        to authenticated;
grant execute on function claim_sms(int)               to service_role;

-- ------------------------------------------------------------
-- Runtime settings
--
-- sms_enabled ships FALSE. Defaulting it to true would mean the deploy itself
-- could text the barangay. The captain switches it on after a live test, via
-- the existing settings_captain_write policy.
-- ------------------------------------------------------------
insert into settings (key, value) values
  ('sms_enabled',          '{"value": false}'::jsonb),
  ('sms_sender_label',     '{"value": "Brgy Ilawod"}'::jsonb),
  ('sms_min_gap_seconds',  '{"value": 10}'::jsonb),
  ('sms_daily_cap',        '{"value": 300}'::jsonb),
  ('sms_test_recipient',   '{"value": null}'::jsonb),
  ('sms_dispatch_url',     '{"value": ""}'::jsonb)
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- Schedule
--
-- pg_cron 1.6 understands sub-minute interval schedules. If this instance
-- does not, fall back to once a minute and tell the dispatcher to send five
-- per invocation instead of one -- the same 1-per-10s throughput either way.
-- ------------------------------------------------------------
do $$
declare v_sub_minute boolean := true;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise warning 'pg_cron is not enabled. Enable it, then re-run the cron.schedule block from this migration.';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'sms-dispatch-tick') then
    perform cron.unschedule('sms-dispatch-tick');
  end if;

  begin
    perform cron.schedule('sms-dispatch-tick', '10 seconds', 'select public.dispatch_sms_tick();');
  exception when others then
    v_sub_minute := false;
    perform cron.schedule('sms-dispatch-tick', '* * * * *', 'select public.dispatch_sms_tick();');
    raise warning 'Sub-minute cron unavailable; falling back to once a minute, five messages per run.';
  end;

  insert into settings (key, value)
  values ('sms_batch_per_invocation',
          jsonb_build_object('value', case when v_sub_minute then 1 else 5 end))
  on conflict (key) do update
    set value = excluded.value, updated_at = now();

  if exists (select 1 from cron.job where jobname = 'sms-purge') then
    perform cron.unschedule('sms-purge');
  end if;
  perform cron.schedule('sms-purge', '30 3 * * *', 'select public.purge_old_sms(180);');
end $$;
