-- ============================================================
-- Public request tracking
--
-- "Track a request" sits in the public navigation, so it has to work
-- without signing in. But reference numbers are sequential — ILW-2026-00841
-- is followed by ...842 — so a lookup keyed on the reference alone would let
-- anyone count upward and learn who requested what. That is a real
-- disclosure: every Certificate of Indigency reveals financial hardship.
--
-- Requiring the surname as well means guessing needs two facts rather than
-- one, and the function returns only progress information: never the
-- address, the purpose, the ID number, or the applicant's full name.
--
-- NOTE: the surname rule here is replaced in 14_fix_compound_surname_matching
-- because taking the last word breaks Filipino compound surnames.
-- ============================================================

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
    split_part(p.full_name, ' ', 1) || ' ' ||
      upper(left(split_part(p.full_name, ' ', 2), 1)) || '. ' ||
      upper(left(split_part(p.full_name, ' ', greatest(array_length(string_to_array(p.full_name, ' '), 1), 1)), 1)) || '.'
  from document_requests r
  join services s on s.code = r.service_code
  join profiles  p on p.id  = r.profile_id
  where upper(btrim(r.ref_no)) = upper(btrim(p_ref))
    and upper(btrim(p_surname)) = upper(
      split_part(p.full_name, ' ', greatest(array_length(string_to_array(p.full_name, ' '), 1), 1))
    );
$$;

revoke all on function track_request(text, text) from public;
grant execute on function track_request(text, text) to anon, authenticated;

comment on function track_request(text, text) is
  'Public request tracking. Requires reference number AND surname so sequential reference numbers cannot be walked to discover who requested what. Returns progress only — no address, purpose or ID number.';

-- Same shape for blotter reports, which residents also need to follow.
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
    and upper(btrim(p_surname)) = upper(
      split_part(p.full_name, ' ', greatest(array_length(string_to_array(p.full_name, ' '), 1), 1))
    );
$$;

revoke all on function track_blotter(text, text) from public;
grant execute on function track_blotter(text, text) to anon, authenticated;
