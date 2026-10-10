-- ============================================================
-- ID re-verification: record that a resident replaced their valid ID,
-- and let staff mark it checked.
--
-- Applied to production on 2026-10-10 as migration 20261010092328.
-- This file is the record of what was run; its version deliberately matches
-- the one already in supabase_migrations.schema_migrations, so the CLI treats
-- it as applied and never re-runs it.
--
-- The design rationale, the three rejected revisions and the rollback script
-- live in supabase/proposals/valid-id-recheck.sql.proposed.
--
-- Note: this creates NO new trigger. profiles_guard_columns (BEFORE UPDATE,
-- FOR EACH ROW) already exists; replacing the function it calls is what adds
-- the stamping, which is why there is no trigger ordering to get wrong.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columns and the queue index
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists valid_id_replaced_at timestamptz,
  add column if not exists valid_id_reviewed_at timestamptz;

comment on column public.profiles.valid_id_replaced_at is
  'Set by guard_profile_columns() when a resident changes valid_id_path, _number or _type. Null means the ID is the one from registration.';
comment on column public.profiles.valid_id_reviewed_at is
  'Set only by mark_valid_id_reviewed(). Earlier than valid_id_replaced_at means the document needs checking.';

create index if not exists profiles_valid_id_needs_check
  on public.profiles (valid_id_replaced_at)
  where valid_id_replaced_at is not null;


-- ------------------------------------------------------------
-- 2. guard_profile_columns() -- REPLACED
--
-- Compare against the live definition before applying. Every existing rule is
-- preserved verbatim; the additions are marked NEW. The only structural
-- change is that the staff early-return now stamps a staff-made document
-- change before returning.
--
-- LIVE DEFINITION AT THE TIME OF WRITING (for side-by-side review):
--
--   begin
--     if is_staff() then
--       return new;
--     end if;
--
--     if new.role is distinct from old.role
--        or new.status is distinct from old.status
--        or new.resident_id is distinct from old.resident_id
--        or new.approved_by is distinct from old.approved_by
--        or new.approved_at is distinct from old.approved_at then
--       raise exception 'Only barangay staff may change role, status or resident ID';
--     end if;
--
--     return new;
--   end;
-- ------------------------------------------------------------
create or replace function public.guard_profile_columns()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_doc_changed boolean;
begin
  -- NEW: any part of the identity document, not just the file. Changing the
  -- claimed ID number without uploading anything is still a change staff
  -- should see.
  v_doc_changed :=
       new.valid_id_path   is distinct from old.valid_id_path
    or new.valid_id_number is distinct from old.valid_id_number
    or new.valid_id_type   is distinct from old.valid_id_type;

  if is_staff() then
    -- NEW: staff who change the document are looking at it as they do so, so
    -- it is replaced and reviewed in the same breath and never lands in their
    -- own queue. If they are explicitly setting reviewed_at (the RPC below),
    -- leave their value alone.
    if v_doc_changed and new.valid_id_reviewed_at is not distinct from old.valid_id_reviewed_at then
      new.valid_id_replaced_at := clock_timestamp();
      new.valid_id_reviewed_at := clock_timestamp();
    end if;
    return new;
  end if;

  -- EXISTING RULE, unchanged.
  if new.role is distinct from old.role
     or new.status is distinct from old.status
     or new.resident_id is distinct from old.resident_id
     or new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at then
    raise exception 'Only barangay staff may change role, status or resident ID';
  end if;

  -- NEW: neither timestamp is the resident's to write. These checks run
  -- BEFORE the stamp below, so a resident supplying a value is rejected
  -- rather than quietly overwritten.
  if new.valid_id_reviewed_at is distinct from old.valid_id_reviewed_at then
    raise exception 'Only barangay staff may mark a valid ID as reviewed';
  end if;
  if new.valid_id_replaced_at is distinct from old.valid_id_replaced_at then
    raise exception 'valid_id_replaced_at is set automatically';
  end if;

  -- NEW: the stamp itself. Nothing the client sends can reach this value.
  if v_doc_changed then
    new.valid_id_replaced_at := clock_timestamp();
  end if;

  return new;
end;
$function$;

-- No second trigger. profiles_guard_columns (BEFORE UPDATE, FOR EACH ROW)
-- already exists and is unchanged; it now does the stamping too.


-- ------------------------------------------------------------
-- 3. The staff review action
--
-- Returns the path it just marked reviewed, so the caller cleans up against
-- the version the database actually blessed rather than one it read earlier
-- and which may since have changed.
-- ------------------------------------------------------------
create or replace function public.mark_valid_id_reviewed(p_profile_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_path text;
begin
  if not is_staff() then
    raise exception 'Only barangay staff can review a valid ID.';
  end if;

  update profiles
     set valid_id_reviewed_at = clock_timestamp()
   where id = p_profile_id
   returning valid_id_path into v_path;

  if not found then
    raise exception 'No such resident.';
  end if;

  return v_path;
end;
$function$;

revoke all on function public.mark_valid_id_reviewed(uuid) from public, anon;
grant execute on function public.mark_valid_id_reviewed(uuid) to authenticated;


-- ------------------------------------------------------------
-- 4. The queue
--
--   select id, full_name, resident_id, valid_id_replaced_at
--     from profiles
--    where valid_id_replaced_at is not null
--      and (valid_id_reviewed_at is null or valid_id_reviewed_at < valid_id_replaced_at)
--    order by valid_id_replaced_at;
--
-- Needs no new policy: profiles_read_own is "id = auth.uid() OR is_staff()",
-- and the secretary already reads every row (verified: 424 of 424).
-- ------------------------------------------------------------


-- ============================================================
-- Rollback, if it is ever needed
--
--   drop function if exists public.mark_valid_id_reviewed(uuid);
--   -- restore guard_profile_columns() from the LIVE DEFINITION quoted above
--   drop index if exists public.profiles_valid_id_needs_check;
--   alter table public.profiles
--     drop column if exists valid_id_replaced_at,
--     drop column if exists valid_id_reviewed_at;
--
-- Existing rows: all 421 residents and 3 staff get NULL for both columns,
-- meaning "never replaced", so the queue is empty on the day it ships.
-- ============================================================
