-- ============================================================
-- First, middle and last name on a profile
--
-- full_name stays the one column the whole app reads, so a name edited here
-- appears in the top bar, the dashboards, the Admin Management list and the
-- request history without any of them changing. The parts are what the Admin
-- profile page edits, and full_name is composed from them.
--
-- Residents keep full_name only: registration asks for a full legal name as
-- printed on an ID, and that flow is untouched.
-- ============================================================

alter table profiles
  add column if not exists first_name  text,
  add column if not exists middle_name text,
  add column if not exists last_name   text;

comment on column profiles.first_name is
  'Given name. When set, full_name is composed from the parts by compose_full_name().';

-- ------------------------------------------------------------
-- Keep full_name in step with the parts
-- ------------------------------------------------------------
create or replace function compose_full_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.first_name  is not distinct from old.first_name
     and new.middle_name is not distinct from old.middle_name
     and new.last_name   is not distinct from old.last_name then
    return new;
  end if;

  -- Only when the parts are actually in use; a resident's full_name is left
  -- exactly as their registration recorded it.
  if coalesce(btrim(new.first_name), '') <> '' or coalesce(btrim(new.last_name), '') <> '' then
    new.full_name := btrim(concat_ws(' ',
      nullif(btrim(new.first_name), ''),
      nullif(btrim(new.middle_name), ''),
      nullif(btrim(new.last_name), '')));
  end if;

  return new;
end;
$$;

-- ------------------------------------------------------------
-- Your own name, and nobody else's
--
-- profiles_update_own lets staff update any profile, which approving and
-- correcting resident records needs. This narrows that one case: a staff
-- account's name can only be changed by the person it belongs to. Staff can
-- still correct a resident's name, as they could before.
-- ------------------------------------------------------------
create or replace function guard_name_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.full_name   is not distinct from old.full_name
     and new.first_name  is not distinct from old.first_name
     and new.middle_name is not distinct from old.middle_name
     and new.last_name   is not distinct from old.last_name then
    return new;
  end if;

  -- auth.uid() is null only for server-side and SQL-console changes.
  if auth.uid() is not null and auth.uid() <> new.id and old.role <> 'resident' then
    raise exception 'You can only change your own name.';
  end if;

  return new;
end;
$$;

revoke all on function compose_full_name() from public, anon, authenticated;
revoke all on function guard_name_change() from public, anon, authenticated;

-- Triggers fire in name order, so compose runs before guard. That is fine:
-- the guard compares the new names with the old ones either way, so a change
-- to someone else's name is still refused before anything is written.
drop trigger if exists profiles_guard_name on profiles;
create trigger profiles_guard_name
  before update on profiles
  for each row execute function guard_name_change();

drop trigger if exists profiles_compose_name on profiles;
create trigger profiles_compose_name
  before insert or update on profiles
  for each row execute function compose_full_name();
