-- ============================================================
-- Remove an Admin portal account
--
-- The mirror of delete_resident(), with a narrower door: only the Punong
-- Barangay may remove an Admin portal account, and never their own. That
-- keeps at least one captain in place, since the only person who can remove
-- a captain is another captain.
--
-- Barangay records are kept. Everything an official did as staff --
-- announcements written, residents approved, requests handled, blotter
-- reports assigned, anonymous messages answered -- points at them with
-- ON DELETE SET NULL, so the record stays and only the link to the account
-- clears. What cascades is their own resident-side filings, so an account
-- holding any of those is refused rather than quietly taking them along.
--
-- The delete removes the login row in auth.users; profiles.id references it
-- ON DELETE CASCADE, so no sign-in is left behind without a record.
-- ============================================================

-- ------------------------------------------------------------
-- Who acted stays readable after the account is gone
--
-- The request timeline shows the official's name by following changed_by
-- into profiles. That link is cleared when the account goes, which would
-- quietly blank the name on entries already made. Keeping the name beside
-- the link means the history still reads in full afterwards.
-- ------------------------------------------------------------
alter table request_status_history
  add column if not exists changed_by_name text;

comment on column request_status_history.changed_by_name is
  'The acting official''s name as it stood when the entry was made. Read only when changed_by no longer resolves, i.e. after the account was removed.';

-- Stamp it as entries are written, so nothing depends on remembering to.
create or replace function stamp_history_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.changed_by_name is null and new.changed_by is not null then
    select full_name into new.changed_by_name from profiles where id = new.changed_by;
  end if;
  return new;
end;
$$;

revoke all on function stamp_history_name() from public, anon, authenticated;

drop trigger if exists request_status_history_stamp_name on request_status_history;
create trigger request_status_history_stamp_name
  before insert on request_status_history
  for each row execute function stamp_history_name();

-- Entries already on the record, including any whose account has gone.
update request_status_history h
   set changed_by_name = p.full_name
  from profiles p
 where p.id = h.changed_by
   and h.changed_by_name is null;

-- ------------------------------------------------------------
-- The removal itself
-- ------------------------------------------------------------
create or replace function delete_admin(p_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v          profiles%rowtype;
  n_requests int;
  n_blotter  int;
  n_appts    int;
  v_detail   text;
begin
  -- The database is the gate, not the hidden button. is_captain() reads the
  -- caller's own profile row, so the request body cannot claim a role.
  if not is_captain() then
    raise exception 'Only the Punong Barangay can remove an Admin portal account.';
  end if;

  if auth.uid() = p_profile_id then
    raise exception 'You cannot remove your own account.';
  end if;

  select * into v from profiles where id = p_profile_id;
  if not found then
    raise exception 'That account no longer exists.';
  end if;

  -- Residents are removed from the masterlist by delete_resident(), which
  -- applies its own rules. This door is for portal accounts only.
  if v.role not in ('captain', 'secretary', 'treasurer') then
    raise exception 'Only Admin portal accounts are removed here. This is a resident account.';
  end if;

  -- Anything they filed as a resident themselves cascades, so it is refused
  -- instead. Officials can file through the resident view like anyone else.
  select count(*) into n_requests from document_requests where profile_id     = p_profile_id;
  select count(*) into n_blotter  from blotter_reports   where complainant_id = p_profile_id;
  select count(*) into n_appts    from appointments      where profile_id     = p_profile_id;

  if n_requests > 0 or n_blotter > 0 or n_appts > 0 then
    v_detail := concat_ws(', ',
      case when n_requests > 0 then n_requests || ' document request' || case when n_requests > 1 then 's' else '' end end,
      case when n_blotter  > 0 then n_blotter  || ' blotter report'   || case when n_blotter  > 1 then 's' else '' end end,
      case when n_appts    > 0 then n_appts    || ' appointment'      || case when n_appts    > 1 then 's' else '' end end);
    raise exception 'This official has % of their own on the barangay record, and those are kept. Remove the record first, or leave the account in place.', v_detail;
  end if;

  -- Refresh the name on their own entries in case it changed since, then the
  -- timeline still says who acted once the link clears.
  update request_status_history
     set changed_by_name = v.full_name
   where changed_by = p_profile_id;

  -- Cascades to profiles, and from there to their own face template. What
  -- they did as staff is kept with the link cleared.
  delete from auth.users where id = p_profile_id;

  -- Read before the delete and handed back, so the caller can remove the
  -- picture file too; storage is not touched by the row delete.
  return jsonb_build_object(
    'full_name',   v.full_name,
    'role',        v.role,
    'avatar_path', v.avatar_path
  );
end;
$$;

revoke all on function delete_admin(uuid) from public, anon;
grant execute on function delete_admin(uuid) to authenticated;
