-- ============================================================
-- Fix surname matching for Filipino compound surnames.
--
-- The first version took the last whitespace-separated word as the surname.
-- That is wrong here: "Juan Miguel Dela Cruz" yields "Cruz", so a resident
-- correctly typing "Dela Cruz" was told their request did not exist.
-- Compound surnames — Dela Cruz, De Los Santos, Del Rosario, San Juan,
-- Dela Peña — are common enough that this would have failed for a large
-- share of the barangay.
--
-- Matching on a suffix instead accepts both "Dela Cruz" and "Cruz", which
-- is also kinder at a counter where the clerk types what they are told.
-- A minimum length stops a single letter matching half the barangay.
-- ============================================================

create or replace function surname_matches(p_full_name text, p_surname text)
returns boolean
language sql
immutable
as $$
  select length(btrim(coalesce(p_surname, ''))) >= 2
     and upper(btrim(p_full_name)) like ('%' || upper(btrim(p_surname)));
$$;

create or replace function track_request(p_ref text, p_surname text)
returns table (
  ref_no       text,
  service_name text,
  status       request_status,
  filed_at     timestamptz,
  updated_at   timestamptz,
  released_at  timestamptz,
  applicant    text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.ref_no,
    s.name,
    r.status,
    r.filed_at,
    r.updated_at,
    r.released_at,
    -- "Juan M." — enough to confirm the right record without publishing
    -- a full name against a reference number.
    split_part(p.full_name, ' ', 1)
      || ' '
      || upper(left(split_part(p.full_name, ' ', 2), 1)) || '.'
  from document_requests r
  join services s on s.code = r.service_code
  join profiles  p on p.id  = r.profile_id
  where upper(btrim(r.ref_no)) = upper(btrim(p_ref))
    and surname_matches(p.full_name, p_surname);
$$;

create or replace function track_blotter(p_ref text, p_surname text)
returns table (
  ref_no        text,
  incident_type text,
  status        blotter_status,
  filed_at      timestamptz,
  updated_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select b.ref_no, b.incident_type, b.status, b.created_at, b.updated_at
  from blotter_reports b
  join profiles p on p.id = b.complainant_id
  where upper(btrim(b.ref_no)) = upper(btrim(p_ref))
    and surname_matches(p.full_name, p_surname);
$$;

revoke all on function track_request(text, text) from public;
revoke all on function track_blotter(text, text) from public;
revoke all on function surname_matches(text, text) from public;
grant execute on function track_request(text, text) to anon, authenticated;
grant execute on function track_blotter(text, text) to anon, authenticated;
grant execute on function surname_matches(text, text) to anon, authenticated;
