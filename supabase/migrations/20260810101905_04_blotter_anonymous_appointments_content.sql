-- ============================================================
-- Blotter, anonymous messages, appointments, announcements, officials
-- ============================================================

create table blotter_reports (
  id                uuid primary key default gen_random_uuid(),
  ref_no            text unique not null,
  complainant_id    uuid not null references profiles(id) on delete cascade,
  respondent_name   text,
  respondent_address text,
  incident_type     text not null,
  incident_at       timestamptz not null,
  location          text not null,
  narrative         text not null,
  status            blotter_status not null default 'filed',
  assigned_to       uuid references profiles(id) on delete set null,
  resolution        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index blotter_complainant_idx on blotter_reports (complainant_id, created_at desc);
create index blotter_status_idx      on blotter_reports (status, created_at desc);

create trigger blotter_touch
  before update on blotter_reports
  for each row execute function touch_updated_at();

create or replace function stamp_blotter()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ref_no is null then
    new.ref_no := next_ref('blotter', 'BLT', 5);
  end if;
  return new;
end;
$$;

create trigger blotter_stamp
  before insert on blotter_reports
  for each row execute function stamp_blotter();

-- ------------------------------------------------------------
-- Anonymous messages
--
-- This table deliberately has NO link to any user: no profile_id, no
-- auth.uid(), no IP address, no user agent, no device identifier. The
-- anonymity is a property of the schema, not a promise made by the UI.
-- The only handle that exists is a random reference code shown once.
-- ------------------------------------------------------------
create table anonymous_messages (
  id             uuid primary key default gen_random_uuid(),
  ref_code       text unique not null,
  category       text not null,
  message        text not null,
  contact_optin  boolean not null default false,
  contact_detail text,
  status         text not null default 'new',
  handled_by     uuid references profiles(id) on delete set null,
  handled_at     timestamptz,
  response       text,
  created_at     timestamptz not null default now()
);

create index anonymous_messages_status_idx on anonymous_messages (status, created_at desc);

create or replace function stamp_anonymous()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_tries int := 0;
begin
  if new.ref_code is null then
    loop
      v_code := random_ref_code();
      exit when not exists (select 1 from anonymous_messages where ref_code = v_code);
      v_tries := v_tries + 1;
      if v_tries > 12 then
        raise exception 'could not allocate a unique reference code';
      end if;
    end loop;
    new.ref_code := v_code;
  end if;
  return new;
end;
$$;

create trigger anonymous_stamp
  before insert on anonymous_messages
  for each row execute function stamp_anonymous();

-- ---------- appointments ----------
create table appointments (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references profiles(id) on delete cascade,
  request_id   uuid references document_requests(id) on delete set null,
  scheduled_at timestamptz not null,
  window_no    smallint,
  purpose      text,
  status       appointment_status not null default 'booked',
  created_at   timestamptz not null default now()
);

create index appointments_profile_idx on appointments (profile_id, scheduled_at);
create index appointments_date_idx    on appointments (scheduled_at);

-- ---------- announcements ----------
create table announcements (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  slug         text unique,
  excerpt      text,
  body         text not null,
  category     text,
  cover_path   text,
  published_at timestamptz,
  author_id    uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index announcements_published_idx on announcements (published_at desc nulls last);

create trigger announcements_touch
  before update on announcements
  for each row execute function touch_updated_at();

-- ---------- officials ----------
create table officials (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  position   text not null,
  photo_path text,
  term_start date,
  term_end   date,
  sort_order smallint not null default 0,
  active     boolean not null default true
);

-- ---------- settings ----------
-- Runtime knobs that must be changeable without a redeploy. The face-match
-- threshold lives here so it can be tuned on the day if the venue lighting
-- turns out to be poor.
create table settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
