-- ============================================================
-- Permanently delete a resident account
--
-- For duplicates and test registrations. Barangay records are kept: a
-- resident who has filed anything -- a document request, a blotter report,
-- an appointment -- cannot be deleted, because deleting them would take the
-- official record with them (those foreign keys cascade). Staff are told to
-- mark the registration as not approved instead.
--
-- The delete removes the login row in auth.users, and profiles.id references
-- it ON DELETE CASCADE, so no sign-in is left behind without a record.
-- ============================================================
create or replace function delete_resident(p_profile_id uuid)
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
  v_result   jsonb;
begin
  -- The database is the gate, not the hidden button: the same check
  -- approve_resident() and reject_resident() make.
  if not is_staff() then
    raise exception 'Only barangay staff can delete a resident record.';
  end if;

  select * into v from profiles where id = p_profile_id;
  if not found then
    raise exception 'No such resident.';
  end if;

  if auth.uid() = p_profile_id then
    raise exception 'You cannot delete your own account.';
  end if;

  -- Staff accounts are not removed from the masterlist. Losing the last
  -- captain would leave nobody able to approve a registration.
  if v.role <> 'resident' then
    raise exception 'Only resident accounts can be deleted here. This account is barangay staff.';
  end if;

  select count(*) into n_requests from document_requests where profile_id = p_profile_id;
  select count(*) into n_blotter  from blotter_reports   where complainant_id = p_profile_id;
  select count(*) into n_appts    from appointments      where profile_id = p_profile_id;

  if n_requests > 0 or n_blotter > 0 or n_appts > 0 then
    v_detail := concat_ws(', ',
      case when n_requests > 0 then n_requests || ' document request'  || case when n_requests > 1 then 's' else '' end end,
      case when n_blotter  > 0 then n_blotter  || ' blotter report'    || case when n_blotter  > 1 then 's' else '' end end,
      case when n_appts    > 0 then n_appts    || ' appointment'       || case when n_appts    > 1 then 's' else '' end end);
    raise exception 'This resident has % on the barangay record, and those are kept. Mark the registration as not approved instead of deleting it.', v_detail;
  end if;

  -- Read before the delete, and handed back so the caller can remove the
  -- files too; rows in storage are not touched by this delete.
  v_result := jsonb_build_object(
    'full_name',     v.full_name,
    'valid_id_path', v.valid_id_path,
    'avatar_path',   v.avatar_path
  );

  -- Cascades to profiles, and from there to face_templates. auth_attempts,
  -- sms_messages and anything they handled as staff are kept with the link
  -- cleared.
  delete from auth.users where id = p_profile_id;

  return v_result;
end;
$$;

revoke all on function delete_resident(uuid) from public, anon;
grant execute on function delete_resident(uuid) to authenticated;

-- Staff may remove a picture file only as part of deleting an account. They
-- still cannot see one (no select) or change one (no insert or update), so
-- "only the owner changes their own picture" still holds.
drop policy if exists avatars_staff_delete on storage.objects;
create policy avatars_staff_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and is_staff());
