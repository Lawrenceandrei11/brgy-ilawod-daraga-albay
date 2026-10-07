-- Migration 28: who may move a request, not just who may touch one.
--
-- Until now the three staff roles were interchangeable for document requests:
-- every policy and this trigger asked is_staff(), which is true for the
-- secretary, the treasurer and the Punong Barangay alike. The order of work
-- existed only as STATUS_TRANSITIONS in the admin screen, so it was a courtesy
-- the UI offered rather than a rule anything enforced.
--
-- The barangay's actual workflow has three hands:
--
--   Secretary  checks a new request and either forwards it or returns it
--   Captain    approves or rejects what has been checked -- the final say
--   Treasurer  takes the payment and sees the document through to release
--
-- The Punong Barangay's permissions are cumulative. With one account per role,
-- strict separation would mean a request could not move at all while a single
-- official was away; the captain being able to cover either desk keeps the
-- queue moving without giving the other two each other's authority.
--
-- Read access is deliberately NOT narrowed. Nine screens read
-- document_requests -- the dashboard counts, the staff search, the reports,
-- the appointments page -- and all of them assume staff see the whole queue.
-- What a role may DO is the thing worth enforcing; what it may SEE is not.
--
-- This also moves the transition map itself into the database. Before, only
-- the admin screen knew that a pending request cannot jump straight to
-- released; now an impossible move is refused wherever it comes from.

-- ------------------------------------------------------------
-- Which desk the caller is sitting at.
--
-- Same shape as is_staff() and is_captain(): security definer so it can read
-- profiles under RLS, stable so a statement evaluates it once, and null for
-- anyone who is not approved barangay staff.
-- ------------------------------------------------------------
create or replace function current_staff_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles
  where id = auth.uid()
    and role in ('secretary', 'treasurer', 'captain')
    and status = 'approved';
$$;

comment on function current_staff_role() is
  'The signed-in official''s role, or null for residents and anyone not approved staff.';

revoke all on function current_staff_role() from public, anon;
grant execute on function current_staff_role() to authenticated;

-- ------------------------------------------------------------
-- The guard, now role-aware on the staff side.
--
-- The resident half is unchanged, including its wording: a resident may still
-- only resubmit a returned request, and may still change nothing else.
-- ------------------------------------------------------------
create or replace function guard_request_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_move text;
begin
  -- No JWT at all means server-side work or the SQL console, as before.
  if auth.uid() is null then
    return new;
  end if;

  v_role := current_staff_role();

  if v_role is not null then
    -- Money is the treasurer's desk. The captain can cover it; the secretary
    -- cannot, which is the whole point of separating the two.
    if new.fee_paid is distinct from old.fee_paid
       and v_role not in ('treasurer', 'captain') then
      raise exception 'Only the barangay treasurer can record a payment.';
    end if;

    if new.status is distinct from old.status then
      v_move := old.status::text || ' -> ' || new.status::text;

      -- Checking: a new request is read, then forwarded or returned. Putting
      -- a returned request back in the queue belongs to the same desk.
      if v_move in ('pending -> processing', 'pending -> rejected', 'rejected -> pending') then
        if v_role not in ('secretary', 'captain') then
          raise exception 'Checking a request is the barangay secretary''s step.';
        end if;

      -- Approval: the Punong Barangay alone, which is what "final approval"
      -- has to mean if it is to mean anything.
      elsif v_move in ('processing -> approved', 'processing -> rejected') then
        if v_role <> 'captain' then
          raise exception 'Only the Punong Barangay can approve or reject a checked request.';
        end if;

      -- After approval: payment, scheduling and handing the document over.
      elsif v_move in ('approved -> ready', 'approved -> scheduled',
                       'scheduled -> ready', 'ready -> released') then
        if v_role not in ('treasurer', 'captain') then
          raise exception 'Payment and release are the barangay treasurer''s step.';
        end if;

      -- Anything else was never a step in the workflow -- a released request
      -- reopening, or a pending one jumping the queue.
      else
        raise exception 'A request cannot move from % to %.', old.status, new.status;
      end if;
    end if;

    return new;
  end if;

  -- ---------------- residents, exactly as before ----------------
  if new.fee is distinct from old.fee then
    raise exception 'The fee is set by the barangay and cannot be changed.';
  end if;

  if new.fee_paid is distinct from old.fee_paid then
    raise exception 'Only the barangay treasurer can record a payment.';
  end if;

  if new.ref_no is distinct from old.ref_no
     or new.profile_id is distinct from old.profile_id
     or new.service_code is distinct from old.service_code
     or new.filed_at is distinct from old.filed_at then
    raise exception 'The reference number, applicant, document type and filing date cannot be changed.';
  end if;

  if new.assigned_to is distinct from old.assigned_to
     or new.released_at is distinct from old.released_at
     or new.remarks is distinct from old.remarks then
    raise exception 'Only barangay staff can change the assignment, remarks or release date.';
  end if;

  -- The only status move a resident may make is resubmitting a returned
  -- request. Everything else is the barangay's decision.
  if new.status is distinct from old.status
     and not (old.status = 'rejected' and new.status = 'pending') then
    raise exception 'Only barangay staff can change the status of a request.';
  end if;

  return new;
end;
$$;

revoke all on function guard_request_columns() from public, anon, authenticated;
