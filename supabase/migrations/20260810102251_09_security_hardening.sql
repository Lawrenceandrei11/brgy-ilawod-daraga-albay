-- ============================================================
-- Security hardening — resolves the database linter findings.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Pin search_path on the two functions that were missing it.
--    Without this, a caller could shadow a referenced object by
--    manipulating their own search_path.
-- ------------------------------------------------------------
create or replace function touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function random_ref_code()
returns text language plpgsql set search_path = public as $$
declare
  alphabet text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  part1 text := '';
  part2 text := '';
  i int;
begin
  for i in 1..4 loop
    part1 := part1 || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  for i in 1..2 loop
    part2 := part2 || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return 'ANON-' || part1 || '-' || part2;
end;
$$;

-- ------------------------------------------------------------
-- 2. Trigger functions must not be reachable as REST endpoints.
--
--    next_ref() was the sharp one: any signed-in user could have called
--    /rest/v1/rpc/next_ref and burned the barangay's reference-number
--    sequence. PostgreSQL checks EXECUTE when a trigger is *created*, not
--    when it fires, so revoking here does not affect the triggers.
-- ------------------------------------------------------------
revoke all on function next_ref(text, text, int)      from public, anon, authenticated;
revoke all on function random_ref_code()              from public, anon, authenticated;
revoke all on function touch_updated_at()             from public, anon, authenticated;
revoke all on function handle_new_user()              from public, anon, authenticated;
revoke all on function guard_profile_columns()        from public, anon, authenticated;
revoke all on function log_request_status()           from public, anon, authenticated;
revoke all on function stamp_request()                from public, anon, authenticated;
revoke all on function stamp_blotter()                from public, anon, authenticated;
revoke all on function stamp_anonymous()              from public, anon, authenticated;

-- is_staff()/is_captain() are evaluated inside RLS policies, so signed-in
-- users must retain EXECUTE. Exposing them is harmless: each only reports
-- whether the *caller* is staff. Anonymous users have no need for them.
revoke all on function is_staff()    from public, anon;
revoke all on function is_captain()  from public, anon;
grant execute on function is_staff()   to authenticated;
grant execute on function is_captain() to authenticated;

-- ------------------------------------------------------------
-- 3. Face descriptors: column-level privileges.
--
--    RLS is row-level and cannot hide a single column, so the biometric
--    vector is protected with a column grant instead. `descriptor` is the
--    one column in this database on which no client role holds SELECT.
--    A resident can confirm they are enrolled; nobody can read the vector
--    through the API, whatever query they write.
--
--    This replaces the SECURITY DEFINER view, which the linter correctly
--    flagged: a definer view would have run with the creator's rights and
--    bypassed these very privileges.
-- ------------------------------------------------------------
drop view if exists face_enrollment;

revoke all on table face_templates from anon, authenticated;

grant select (id, profile_id, angle, created_at, confirmed_at, confirmed_by)
  on face_templates to authenticated;
grant insert on face_templates to authenticated;
grant delete on face_templates to authenticated;
grant update (confirmed_by, confirmed_at) on face_templates to authenticated;

-- Now that a SELECT privilege exists, it needs a matching row policy.
create policy face_read_metadata_own on face_templates
  for select to authenticated
  using (profile_id = auth.uid() or is_staff());

-- security_invoker = on: the view runs with the caller's rights, so the
-- column grants and row policies above still apply through it.
create view face_enrollment
with (security_invoker = on) as
  select
    ft.profile_id,
    count(*)::int                        as angles,
    min(ft.created_at)                   as enrolled_at,
    max(ft.confirmed_at)                 as confirmed_at,
    bool_or(ft.confirmed_at is not null) as confirmed
  from face_templates ft
  group by ft.profile_id;

grant select on face_enrollment to authenticated;

-- ------------------------------------------------------------
-- 4. id_counters is intentionally policy-free: RLS is on and no policy
--    exists, so every client role is denied. Only the SECURITY DEFINER
--    function next_ref() may touch it.
-- ------------------------------------------------------------
comment on table id_counters is
  'Deny-all by design: RLS enabled with no policies. Written only by next_ref().';

comment on column face_templates.descriptor is
  '128-dimension face-api.js descriptor. No client role holds SELECT on this column; it is readable only by match_face() running as service_role.';

comment on table anonymous_messages is
  'Carries no link to any user: no profile_id, IP, or user agent. Anonymity is enforced by the schema, not by the UI.';
