-- Migration 29: clearing released requests is the treasurer's desk.
--
-- Migration 23 gated delete_released_requests() on is_staff(), which was the
-- right rule at the time: the three staff roles were interchangeable for
-- document requests and nothing distinguished them. Migration 28 ended that.
-- The barangay works in three hands -- the secretary checks, the Punong
-- Barangay approves, the treasurer takes payment and sees the document out --
-- and a released request is the far end of the treasurer's own stage.
--
-- So the desk that releases a document is the desk that clears the record,
-- and the queue page now draws the Select All and Delete selected controls
-- on the Released tab only, which only the treasurer has. This is the half
-- that matters: a hidden button is not a permission, and without this the
-- secretary or the captain could still call the function directly.
--
-- The captain's permissions stay cumulative everywhere else. Migration 28
-- lets them make any move in the workflow, this one included -- they can
-- still release a document. What they cannot do is permanently delete the
-- record afterwards.
--
-- Breaking the cumulative rule here is deliberate and narrow. The reason the
-- captain can cover the other two desks is that one official being away must
-- not stop the queue: a request stuck at "approved" is a resident waiting.
-- Nothing waits on a deletion. Released rows are housekeeping, so they can
-- sit until the treasurer is back, and the one irreversible action on the
-- page is better off belonging to exactly one person.
--
-- Everything else about the function is unchanged: same signature, same
-- "released only" rule, same cascade behaviour, same return value. Only the
-- gate moves.

create or replace function delete_released_requests(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n_deleted integer;
begin
  -- The treasurer's own step, not staff in general. current_staff_role()
  -- comes from migration 28 and is null for residents and anyone who is not
  -- approved staff, so this refuses them too.
  if current_staff_role() is distinct from 'treasurer'::user_role then
    raise exception 'Clearing released requests is the barangay treasurer''s step.';
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
  'Permanently deletes released requests by id, barangay treasurer only. Requests in any other status are ignored. Returns how many rows were deleted.';

revoke all on function delete_released_requests(uuid[]) from public, anon;
grant execute on function delete_released_requests(uuid[]) to authenticated;
