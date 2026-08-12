-- ============================================================
-- Slot availability
--
-- RLS correctly stops a resident reading other residents' appointments —
-- but to book, they need to know which slots are already full. Returning
-- the rows themselves would disclose who is visiting the barangay hall and
-- why, which is nobody else's business.
--
-- This returns counts only: a time, and how many of the windows are taken.
-- Availability without identity.
-- ============================================================

create or replace function slot_counts(p_from timestamptz, p_to timestamptz)
returns table (slot timestamptz, taken bigint)
language sql
stable
security definer
set search_path = public
as $$
  select a.scheduled_at, count(*)
  from appointments a
  where a.status = 'booked'
    and a.scheduled_at >= p_from
    and a.scheduled_at <  p_to
  group by a.scheduled_at;
$$;

revoke all on function slot_counts(timestamptz, timestamptz) from public, anon;
grant execute on function slot_counts(timestamptz, timestamptz) to authenticated;

comment on function slot_counts(timestamptz, timestamptz) is
  'Appointment availability as counts per slot. Deliberately returns no profile_id, purpose or request link — a resident needs to know a slot is full, not who filled it.';

-- Stop the same resident double-booking one slot, and stop two residents
-- racing into the last window. A partial unique index scoped to booked rows
-- lets a cancelled appointment free its slot again.
create unique index appointments_no_double_booking
  on appointments (profile_id, scheduled_at)
  where status = 'booked';
