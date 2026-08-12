-- ============================================================
-- Barangay E-Assist — extensions, enums and shared helpers
-- ============================================================

create extension if not exists "vector" with schema extensions;
create extension if not exists "pgcrypto" with schema extensions;

-- ---------- enums ----------
-- Staff roles mirror the barangay council positions shown on the landing page.
create type user_role as enum ('resident', 'secretary', 'treasurer', 'captain');

create type profile_status as enum ('pending', 'approved', 'rejected', 'suspended');

-- These seven are exactly the badges in the design system's component sheet.
create type request_status as enum (
  'pending', 'processing', 'approved', 'ready', 'released', 'rejected', 'scheduled'
);

create type face_angle as enum ('center', 'left', 'right');

create type auth_outcome as enum ('matched', 'below_threshold', 'no_enrollment', 'locked', 'error');

create type blotter_status as enum ('filed', 'under_mediation', 'resolved', 'referred', 'dismissed');

create type appointment_status as enum ('booked', 'completed', 'cancelled', 'no_show');

-- ---------- reference-number counters ----------
-- Reference numbers restart at 1 each calendar year, matching how the
-- barangay numbers its paper records (ILW-2026-00841).
create table id_counters (
  scope       text primary key,
  year        int  not null,
  last_value  int  not null default 0
);

create or replace function next_ref(p_scope text, p_prefix text, p_width int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from now() at time zone 'Asia/Manila');
  v_next int;
begin
  insert into id_counters (scope, year, last_value)
    values (p_scope, v_year, 1)
  on conflict (scope) do update
    set last_value = case
          when id_counters.year = v_year then id_counters.last_value + 1
          else 1
        end,
        year = v_year
  returning last_value into v_next;

  return p_prefix || '-' || v_year || '-' || lpad(v_next::text, p_width, '0');
end;
$$;

-- Anonymous reference codes are random, never sequential. A sequential code
-- would let anyone enumerate other people's reports, which would defeat the
-- point of the anonymous channel.
create or replace function random_ref_code()
returns text
language plpgsql
as $$
declare
  -- Crockford-style alphabet: no I, L, O or U, so the code can be read aloud
  -- and written down without ambiguity.
  alphabet text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  part1 text := '';
  part2 text := '';
  i int;
begin
  for i in 1..4 loop
    part1 := part1 || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  for i in 1..2 loop
    part2 := part2 || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return 'ANON-' || part1 || '-' || part2;
end;
$$;

-- ---------- updated_at ----------
create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
