-- ============================================================
-- Stop residents editing money and provenance on their own requests.
--
-- Found by testing: the update policy correctly lets a resident correct a
-- request that was sent back to them, but Row Level Security cannot
-- restrict *which columns* an allowed UPDATE may touch. So a resident with
-- a returned request could PATCH `fee: 0, fee_paid: true` and walk into the
-- barangay hall with a ₱200 business clearance marked paid.
--
-- Same class of hole as profile role escalation, and the same fix: a
-- trigger, because a policy cannot express "these columns are off limits".
-- A resident correcting a request should only be able to change what they
-- wrote — the purpose and the answers — and resubmit it.
-- ============================================================

create or replace function guard_request_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Staff, and server-side maintenance where there is no JWT at all, pass
  -- straight through. A browser client always carries a JWT, so this cannot
  -- be used by anon or authenticated to slip past the checks below.
  if auth.uid() is null or is_staff() then
    return new;
  end if;

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

create trigger document_requests_guard_columns
  before update on document_requests
  for each row execute function guard_request_columns();

revoke all on function guard_request_columns() from public, anon, authenticated;
