-- ============================================================
-- Second hardening pass, driven by the Supabase security advisor.
--
-- NOTE ON ORDERING: this overlaps with 20260810102251_09_security_hardening.
-- Both pin search_path and revoke the trigger functions; applying them twice
-- is harmless because every statement is idempotent. The one thing that
-- differs is the enrollment-status read path — that migration built a
-- security_invoker VIEW, this one replaces it with a SECURITY DEFINER
-- FUNCTION, which is what the application calls. The column grants from the
-- earlier migration survive and are still what protects `descriptor`.
-- ============================================================

-- ---------- 1. pin search_path ----------
alter function random_ref_code()   set search_path = public;
alter function touch_updated_at()  set search_path = public;

-- ---------- 2. take trigger functions off the REST API ----------
-- PostgreSQL checks EXECUTE on a trigger function when the trigger is
-- created, not each time it fires, so revoking here does not stop the
-- triggers working.
revoke all on function handle_new_user()       from public, anon, authenticated;
revoke all on function guard_profile_columns() from public, anon, authenticated;
revoke all on function log_request_status()    from public, anon, authenticated;
revoke all on function stamp_request()         from public, anon, authenticated;
revoke all on function stamp_blotter()         from public, anon, authenticated;
revoke all on function stamp_anonymous()       from public, anon, authenticated;
revoke all on function touch_updated_at()      from public, anon, authenticated;
revoke all on function random_ref_code()       from public, anon, authenticated;

-- Reference numbers are allocated only from inside the stamp_* triggers,
-- which run as the definer. No client ever needs to call this.
revoke all on function next_ref(text, text, int) from public, anon, authenticated;

-- is_staff / is_captain are evaluated inside RLS policy expressions, which
-- run as the querying role, so `authenticated` must keep EXECUTE. `anon`
-- never hits a policy that references them.
revoke all on function is_staff()    from public, anon;
revoke all on function is_captain()  from public, anon;
grant execute on function is_staff()   to authenticated;
grant execute on function is_captain() to authenticated;

-- ---------- 3. replace the definer view with a definer function ----------
drop view if exists face_enrollment;

-- Exposes whether someone is enrolled, when, and whether the secretary has
-- confirmed it — without ever exposing the 128-float descriptor itself.
-- Passing no argument reads your own status; staff may pass a profile id.
create or replace function face_enrollment_status(p_profile_id uuid default null)
returns table (
  profile_id   uuid,
  angles       int,
  enrolled_at  timestamptz,
  confirmed_at timestamptz,
  confirmed    boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ft.profile_id,
    count(*)::int,
    min(ft.created_at),
    max(ft.confirmed_at),
    bool_or(ft.confirmed_at is not null)
  from face_templates ft
  where ft.profile_id = coalesce(p_profile_id, auth.uid())
    and (coalesce(p_profile_id, auth.uid()) = auth.uid() or is_staff())
  group by ft.profile_id;
$$;

revoke all on function face_enrollment_status(uuid) from public, anon;
grant execute on function face_enrollment_status(uuid) to authenticated;

-- ---------- documentation ----------
comment on table id_counters is
  'Yearly reference-number counters. RLS is enabled with NO policies on purpose: this is a deny-all table reachable only from SECURITY DEFINER functions.';

comment on table anonymous_messages is
  'Anonymous reports. Deliberately has no profile_id, IP, user agent or device column — the anonymity is enforced by the schema, not by the UI.';

comment on table face_templates is
  'Facial biometric descriptors (128-float, face-api.js). Sensitive personal information under RA 10173. No client role holds SELECT on the `descriptor` column; residents may read their own enrollment metadata only. Descriptors are read solely by match_face() via the service role.';

comment on function match_face(extensions.vector(128), real) is
  'Server-side 1:N face matching using pgvector L2 distance. Service role only — called from the face-login Edge Function so descriptors never reach the browser.';
