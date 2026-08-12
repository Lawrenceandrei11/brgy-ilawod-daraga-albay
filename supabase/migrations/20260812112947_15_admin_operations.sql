-- ============================================================
-- Staff operations that a policy alone cannot express.
--
-- Approving a resident has to allocate a Resident ID, and next_ref() is
-- revoked from every client role precisely so nobody can burn the sequence.
-- These functions are the sanctioned way in: they check is_staff()
-- themselves rather than trusting the caller.
-- ============================================================

create or replace function approve_resident(p_profile_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rid    text;
  v_status profile_status;
begin
  if not is_staff() then
    raise exception 'Only barangay staff can approve a registration.';
  end if;

  select resident_id, status into v_rid, v_status
  from profiles where id = p_profile_id;

  if not found then
    raise exception 'No such resident.';
  end if;

  -- A Resident ID is allocated once and kept, even if the account is later
  -- suspended and reinstated — it is the barangay's record number.
  if v_rid is null then
    v_rid := next_ref('resident', 'ILW', 4);
  end if;

  update profiles set
    status           = 'approved',
    resident_id      = v_rid,
    approved_by      = auth.uid(),
    approved_at      = now(),
    rejection_reason = null
  where id = p_profile_id;

  return v_rid;
end;
$$;

create or replace function reject_resident(p_profile_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_staff() then
    raise exception 'Only barangay staff can reject a registration.';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Give a reason — the resident is shown this so they can put it right.';
  end if;

  update profiles set
    status           = 'rejected',
    rejection_reason = btrim(p_reason),
    approved_by      = auth.uid(),
    approved_at      = now()
  where id = p_profile_id;
end;
$$;

-- ------------------------------------------------------------
-- Confirming a face enrollment in person.
--
-- Staff can UPDATE face_templates but still cannot read the descriptor
-- column, so this returns only how many angles were confirmed.
-- ------------------------------------------------------------
create or replace function confirm_face_enrollment(p_profile_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_count int;
begin
  if not is_staff() then
    raise exception 'Only barangay staff can confirm a biometric enrollment.';
  end if;

  update face_templates set
    confirmed_by = auth.uid(),
    confirmed_at = now()
  where profile_id = p_profile_id;

  get diagnostics v_count = row_count;

  if v_count = 0 then
    raise exception 'That resident has not enrolled a face yet.';
  end if;

  return v_count;
end;
$$;

revoke all on function approve_resident(uuid)        from public, anon;
revoke all on function reject_resident(uuid, text)   from public, anon;
revoke all on function confirm_face_enrollment(uuid) from public, anon;
grant execute on function approve_resident(uuid)        to authenticated;
grant execute on function reject_resident(uuid, text)   to authenticated;
grant execute on function confirm_face_enrollment(uuid) to authenticated;

-- ------------------------------------------------------------
-- Reporting
--
-- Aggregates for the admin dashboard and reports module. Doing this in one
-- round trip keeps the dashboard honest about barangay-wide totals rather
-- than counting whatever happened to be paged into the client.
-- ------------------------------------------------------------
create or replace function admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare result jsonb;
begin
  if not is_staff() then
    raise exception 'Only barangay staff can read barangay-wide statistics.';
  end if;

  select jsonb_build_object(
    'requests_by_status', (
      select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
      from (select status::text, count(*) n from document_requests group by status) t
    ),
    'requests_pending',   (select count(*) from document_requests where status = 'pending'),
    'requests_ready',     (select count(*) from document_requests where status = 'ready'),
    'requests_total',     (select count(*) from document_requests),
    'residents_pending',  (select count(*) from profiles where status = 'pending'),
    'residents_approved', (select count(*) from profiles where status = 'approved' and role = 'resident'),
    'blotter_open',       (select count(*) from blotter_reports where status in ('filed','under_mediation')),
    'anon_new',           (select count(*) from anonymous_messages where status = 'new'),
    'appointments_today', (
      select count(*) from appointments
      where status = 'booked'
        and scheduled_at >= date_trunc('day', now() at time zone 'Asia/Manila')
        and scheduled_at <  date_trunc('day', now() at time zone 'Asia/Manila') + interval '1 day'
    ),
    'fees_collected', (
      select coalesce(sum(fee), 0) from document_requests where fee_paid
    ),
    'fees_outstanding', (
      select coalesce(sum(fee), 0) from document_requests
      where not fee_paid and status not in ('rejected','released')
    ),
    'by_service', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', code, 'name', name, 'count', n, 'fees', fees
      ) order by n desc), '[]'::jsonb)
      from (
        select s.code, s.name, count(r.id) n, coalesce(sum(r.fee) filter (where r.fee_paid), 0) fees
        from services s
        left join document_requests r on r.service_code = s.code
        where s.kind = 'document'
        group by s.code, s.name
      ) t
    ),
    'by_month', (
      select coalesce(jsonb_agg(jsonb_build_object('month', m, 'count', n) order by m), '[]'::jsonb)
      from (
        select to_char(date_trunc('month', filed_at), 'YYYY-MM') m, count(*) n
        from document_requests
        where filed_at > now() - interval '12 months'
        group by 1
      ) t
    ),
    'blotter_by_type', (
      select coalesce(jsonb_agg(jsonb_build_object('type', incident_type, 'count', n) order by n desc), '[]'::jsonb)
      from (select incident_type, count(*) n from blotter_reports group by 1) t
    ),
    'by_purok', (
      select coalesce(jsonb_agg(jsonb_build_object('purok', purok, 'count', n) order by purok), '[]'::jsonb)
      from (
        select p.purok, count(r.id) n
        from profiles p left join document_requests r on r.profile_id = p.id
        where p.purok is not null
        group by p.purok
      ) t
    )
  ) into result;

  return result;
end;
$$;

revoke all on function admin_stats() from public, anon;
grant execute on function admin_stats() to authenticated;
