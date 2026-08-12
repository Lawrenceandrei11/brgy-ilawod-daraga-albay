-- ============================================================
-- Facial biometrics
--
-- What is stored is a 128-dimension descriptor produced by face-api.js —
-- not an image. Under RA 10173 (Data Privacy Act of 2012) this is still
-- sensitive personal information, so it gets its own table, its own access
-- rules, and an audit trail of every time it is used.
--
-- NOTE: migration 09_security_hardening later replaces the blanket
-- "no SELECT for anyone" approach with COLUMN-level grants. The end state
-- is that `descriptor` is the one column in this database no client role
-- can read, while a resident may still see their own enrollment metadata
-- (which angles, and when). Read the two together.
-- ============================================================

create table face_templates (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references profiles(id) on delete cascade,
  angle        face_angle not null,
  descriptor   extensions.vector(128) not null,

  -- Enrollment works for sign-in immediately, but must be confirmed in person
  -- by the secretary before it can be used to release documents at the hall.
  confirmed_by uuid references profiles(id) on delete set null,
  confirmed_at timestamptz,

  created_at   timestamptz not null default now(),
  unique (profile_id, angle)
);

create index face_templates_profile_idx on face_templates (profile_id);

-- IVFFlat needs training data to be worth building. At barangay scale
-- (a few thousand residents) a sequential scan over 128-float vectors is
-- fast enough, and it avoids the recall loss an untrained index would cause.
-- Revisit if the resident count passes ~10,000.

-- ---------- audit trail for biometric sign-in ----------
create table auth_attempts (
  id         bigserial primary key,
  profile_id uuid references profiles(id) on delete set null,
  outcome    auth_outcome not null,
  distance   real,
  ip         inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index auth_attempts_profile_idx on auth_attempts (profile_id, created_at desc);
create index auth_attempts_time_idx    on auth_attempts (created_at desc);

-- ------------------------------------------------------------
-- match_face
--
-- Matching runs here, in the database, and never in the browser. The
-- alternative — shipping every resident's descriptor to the client so it can
-- compare locally — would hand the barangay's entire biometric database to
-- anyone who opened the sign-in page.
--
-- `<->` is pgvector's L2 (Euclidean) distance. face-api.js descriptors are
-- unit-normalised, so the conventional decision threshold is 0.6; this system
-- defaults to 0.5, trading a few more retries for materially fewer false
-- accepts. A false accept here means signing a resident in as someone else.
-- ------------------------------------------------------------
create or replace function match_face(
  p_descriptor extensions.vector(128),
  p_threshold  real default null
)
returns table (
  profile_id  uuid,
  resident_id text,
  full_name   text,
  email       text,
  distance    real
)
language sql
security definer
set search_path = public, extensions
as $$
  select t.id, t.resident_id, t.full_name, t.email, t.distance
  from (
    select p.id, p.resident_id, p.full_name, p.email,
           (ft.descriptor <-> p_descriptor)::real as distance
    from face_templates ft
    join profiles p on p.id = ft.profile_id
    where p.status = 'approved'
    order by ft.descriptor <-> p_descriptor
    limit 1
  ) t
  where t.distance <= coalesce(
    p_threshold,
    (select (value ->> 'value')::real from settings where key = 'face_match_threshold'),
    0.5
  );
$$;

-- Only the service role may call this. It is reached through the face-login
-- Edge Function, never directly from the browser.
revoke all on function match_face(extensions.vector(128), real) from public, anon, authenticated;
grant execute on function match_face(extensions.vector(128), real) to service_role;

-- ------------------------------------------------------------
-- Lockout: five failed attempts inside 15 minutes.
-- Counted per-IP because a failed attempt has, by definition, no identity.
-- ------------------------------------------------------------
create or replace function face_attempts_recent(p_ip inet)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from auth_attempts
  where ip is not distinct from p_ip
    and outcome in ('below_threshold', 'no_enrollment')
    and created_at > now() - interval '15 minutes';
$$;

revoke all on function face_attempts_recent(inet) from public, anon, authenticated;
grant execute on function face_attempts_recent(inet) to service_role;
