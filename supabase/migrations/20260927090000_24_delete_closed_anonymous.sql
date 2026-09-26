-- ============================================================
-- Clear out closed anonymous messages
--
-- A closed message has been dealt with. Staff can delete those in bulk, and
-- only those: unread, being looked at, and acted on are live correspondence.
--
-- anonymous_messages has a staff read policy and a staff update policy, and
-- deliberately no delete policy -- nothing in the system deletes one. Rather
-- than open the table up, this follows delete_resident(), delete_admin() and
-- delete_released_requests(): one SECURITY DEFINER function that states the
-- rule and is the only way in.
--
-- Nothing else points at this table, and the table points at nobody: there is
-- no sender column to orphan. What goes is the message and nothing more.
-- ============================================================
create or replace function delete_closed_anonymous_messages(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n_deleted integer;
begin
  -- The same gate the inbox itself uses to read and answer these.
  if not is_staff() then
    raise exception 'Only barangay staff can delete anonymous messages.';
  end if;

  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  -- "closed only" lives here, not in the page. An id belonging to an unread
  -- or acted-on message simply does not match, so it is left alone and the
  -- caller is told how many were actually deleted.
  delete from anonymous_messages
   where id = any (p_ids)
     and status = 'closed';

  get diagnostics n_deleted = row_count;
  return n_deleted;
end;
$$;

comment on function delete_closed_anonymous_messages(uuid[]) is
  'Permanently deletes closed anonymous messages by id, staff only. Messages in any other status are ignored. Returns how many rows were deleted.';

revoke all on function delete_closed_anonymous_messages(uuid[]) from public, anon;
grant execute on function delete_closed_anonymous_messages(uuid[]) to authenticated;
