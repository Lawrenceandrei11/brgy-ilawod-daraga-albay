-- ============================================================
-- Profiles (1:1 with auth.users) and the service catalogue
-- ============================================================

create table profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  role                user_role      not null default 'resident',
  status              profile_status not null default 'pending',

  -- Assigned by the secretary at approval time, not at signup, because it is
  -- the barangay's record number rather than an account id.
  resident_id         text unique,

  full_name           text not null,
  date_of_birth       date,
  sex                 text,
  civil_status        text,
  mobile              text,
  email               text,

  -- household & address (registration step 2)
  purok               smallint check (purok between 1 and 7),
  address_line        text,
  years_of_residency  smallint,
  household_head      text,
  household_size      smallint,

  -- identity proof (registration step 1)
  valid_id_type       text,
  valid_id_number     text,
  valid_id_path       text,

  approved_by         uuid references profiles(id) on delete set null,
  approved_at         timestamptz,
  rejection_reason    text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index profiles_role_idx   on profiles (role);
create index profiles_status_idx on profiles (status);
create index profiles_purok_idx  on profiles (purok);

create trigger profiles_touch
  before update on profiles
  for each row execute function touch_updated_at();

-- Every new auth user gets a profile immediately, in 'pending' status.
-- Doing this in the database rather than the client means an account can
-- never exist without a matching barangay record.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, mobile)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', 'Unnamed resident'),
    new.email,
    new.raw_user_meta_data ->> 'mobile'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Staff check used by nearly every RLS policy.
-- SECURITY DEFINER is required: it bypasses RLS on `profiles`, which is what
-- stops the profiles policies from recursing into themselves.
create or replace function is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and role in ('secretary', 'treasurer', 'captain')
      and status = 'approved'
  );
$$;

create or replace function is_captain()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'captain' and status = 'approved'
  );
$$;

-- ---------- services ----------
create table services (
  code                    text primary key,
  name                    text not null,
  description             text,
  fee                     numeric(10,2) not null default 0,
  processing_days         smallint not null default 1,
  requires_council_review boolean not null default false,
  icon                    text,          -- PNG slot filename
  requirements            text[],        -- what the resident must bring
  sort_order              smallint not null default 0,
  active                  boolean not null default true
);
