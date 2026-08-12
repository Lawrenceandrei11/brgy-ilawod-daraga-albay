-- ============================================================
-- Row Level Security
--
-- Every rule below is enforced by Postgres, not by hiding buttons in React.
-- A resident holding a valid token and calling the REST API directly still
-- cannot read another resident's requests.
-- ============================================================

alter table profiles              enable row level security;
alter table services              enable row level security;
alter table document_requests     enable row level security;
alter table request_status_history enable row level security;
alter table face_templates        enable row level security;
alter table auth_attempts         enable row level security;
alter table blotter_reports       enable row level security;
alter table anonymous_messages    enable row level security;
alter table appointments          enable row level security;
alter table announcements         enable row level security;
alter table officials             enable row level security;
alter table settings              enable row level security;
alter table id_counters           enable row level security;

-- id_counters gets no policies at all: only SECURITY DEFINER functions touch it.

-- ---------- profiles ----------
create policy profiles_read_own on profiles
  for select to authenticated
  using (id = auth.uid() or is_staff());

create policy profiles_update_own on profiles
  for update to authenticated
  using (id = auth.uid() or is_staff())
  with check (id = auth.uid() or is_staff());

-- RLS cannot restrict individual columns, so privilege escalation is blocked
-- with a trigger: a resident may edit their own address, but not their own
-- role, status or resident_id.
create or replace function guard_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_staff() then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.status is distinct from old.status
     or new.resident_id is distinct from old.resident_id
     or new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at then
    raise exception 'Only barangay staff may change role, status or resident ID';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_columns
  before update on profiles
  for each row execute function guard_profile_columns();

-- ---------- services (public catalogue) ----------
create policy services_read_all on services
  for select to anon, authenticated
  using (active);

create policy services_staff_write on services
  for all to authenticated
  using (is_staff()) with check (is_staff());

-- ---------- document requests ----------
create policy requests_read_own on document_requests
  for select to authenticated
  using (profile_id = auth.uid() or is_staff());

-- A resident may only file in their own name, and only once approved.
create policy requests_insert_own on document_requests
  for insert to authenticated
  with check (
    profile_id = auth.uid()
    and exists (
      select 1 from profiles
      where id = auth.uid() and status = 'approved'
    )
  );

-- Residents may edit a returned request to correct it; staff may edit any.
create policy requests_update on document_requests
  for update to authenticated
  using ((profile_id = auth.uid() and status = 'rejected') or is_staff())
  with check ((profile_id = auth.uid() and status in ('rejected', 'pending')) or is_staff());

-- ---------- status history (read-only to clients) ----------
-- Written only by the trigger, which is SECURITY DEFINER and bypasses RLS.
create policy history_read on request_status_history
  for select to authenticated
  using (
    is_staff() or exists (
      select 1 from document_requests r
      where r.id = request_id and r.profile_id = auth.uid()
    )
  );

-- ---------- face templates ----------
-- NOTE: this migration created no SELECT policy at all. Migration
-- 09_security_hardening revisits that, adding column-level grants plus a
-- metadata SELECT policy, so that `descriptor` stays unreadable while a
-- resident can still see which angles they enrolled and when.
create policy face_insert_own on face_templates
  for insert to authenticated
  with check (profile_id = auth.uid());

-- The privacy notice promises a resident can delete their enrollment.
-- This policy is what makes that promise true.
create policy face_delete_own on face_templates
  for delete to authenticated
  using (profile_id = auth.uid() or is_staff());

-- Staff confirm an enrollment in person; they still cannot read the vector.
create policy face_confirm_staff on face_templates
  for update to authenticated
  using (is_staff()) with check (is_staff());

-- Enrollment status without exposing the biometric itself.
-- (Replaced in 09_security_hardening by a security_invoker view, and then by
-- the face_enrollment_status() function in 09_harden_functions_and_grants.)
create or replace view face_enrollment
with (security_invoker = off) as
  select
    ft.profile_id,
    count(*)::int                             as angles,
    min(ft.created_at)                        as enrolled_at,
    max(ft.confirmed_at)                      as confirmed_at,
    bool_or(ft.confirmed_at is not null)      as confirmed
  from face_templates ft
  where ft.profile_id = auth.uid() or is_staff()
  group by ft.profile_id;

grant select on face_enrollment to authenticated;

-- ---------- auth attempts ----------
create policy attempts_read on auth_attempts
  for select to authenticated
  using (profile_id = auth.uid() or is_staff());

-- ---------- blotter ----------
create policy blotter_read on blotter_reports
  for select to authenticated
  using (complainant_id = auth.uid() or is_staff());

create policy blotter_insert_own on blotter_reports
  for insert to authenticated
  with check (complainant_id = auth.uid());

create policy blotter_staff_update on blotter_reports
  for update to authenticated
  using (is_staff()) with check (is_staff());

-- ---------- anonymous messages ----------
-- Anyone, signed in or not, may submit. Nobody but staff may read.
-- There is no policy that would let a submitter retrieve their own message,
-- because there is no column that could identify them as the submitter —
-- which is the entire point of the channel.
create policy anon_insert_anyone on anonymous_messages
  for insert to anon, authenticated
  with check (true);

create policy anon_staff_read on anonymous_messages
  for select to authenticated
  using (is_staff());

create policy anon_staff_update on anonymous_messages
  for update to authenticated
  using (is_staff()) with check (is_staff());

-- ---------- appointments ----------
create policy appt_read on appointments
  for select to authenticated
  using (profile_id = auth.uid() or is_staff());

create policy appt_insert_own on appointments
  for insert to authenticated
  with check (profile_id = auth.uid());

create policy appt_update on appointments
  for update to authenticated
  using (profile_id = auth.uid() or is_staff())
  with check (profile_id = auth.uid() or is_staff());

-- ---------- announcements (public) ----------
create policy ann_read_published on announcements
  for select to anon, authenticated
  using (published_at is not null and published_at <= now());

create policy ann_staff_all on announcements
  for all to authenticated
  using (is_staff()) with check (is_staff());

-- ---------- officials (public) ----------
create policy officials_read on officials
  for select to anon, authenticated
  using (active);

create policy officials_staff_write on officials
  for all to authenticated
  using (is_staff()) with check (is_staff());

-- ---------- settings ----------
create policy settings_staff_read on settings
  for select to authenticated
  using (is_staff());

create policy settings_captain_write on settings
  for all to authenticated
  using (is_captain()) with check (is_captain());
