-- ============================================================
-- Clear out released requests
--
-- A released request has been collected: the document is in the resident's
-- hands and the row is housekeeping. Staff can delete those in bulk, and only
-- those -- a queue that is still moving is the barangay's working record.
--
-- There is no delete policy on document_requests, by design: nothing else in
-- the system deletes one. Rather than open the table up, this follows
-- delete_resident() and delete_admin(): one SECURITY DEFINER function that
-- states the rule and is the only way in.
--
-- What goes, and what stays, is decided by the foreign keys already on the
-- table:
--
--   request_status_history  CASCADE   the request's own timeline, which has
--                                     no meaning without it
--   appointments            SET NULL  the appointment is the resident's own
--                                     record and is kept, unlinked
--   sms_messages            SET NULL  the message log is kept, unlinked
--
-- Nothing touches the resident's account, their other requests, or anything
-- else of theirs.
-- ============================================================
create or replace function delete_released_requests(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n_deleted integer;
begin
  -- The same gate the rest of the queue uses.
  if not is_staff() then
    raise exception 'Only barangay staff can delete requests.';
  end if;

  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  -- "released only" lives here, not in the page. An id belonging to a pending
  -- or ready request simply does not match, so it is left alone and the
  -- caller is told how many were actually deleted.
  delete from document_requests
   where id = any (p_ids)
     and status = 'released';

  get diagnostics n_deleted = row_count;
  return n_deleted;
end;
$$;

comment on function delete_released_requests(uuid[]) is
  'Permanently deletes released requests by id, staff only. Requests in any other status are ignored. Returns how many rows were deleted.';

revoke all on function delete_released_requests(uuid[]) from public, anon;
grant execute on function delete_released_requests(uuid[]) to authenticated;
