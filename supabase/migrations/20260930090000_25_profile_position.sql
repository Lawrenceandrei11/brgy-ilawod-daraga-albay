-- Migration 25: the title an official is addressed by.
--
-- Until now the position shown in the Admin portal was read off the role enum
-- through a label hard-coded in the pages, so an official could only ever be
-- called Punong Barangay, Barangay Secretary or Barangay Treasurer. A barangay
-- council has more titles than that -- Kagawad, SK Chairperson -- so the title
-- becomes text the official writes for themselves.
--
-- It is deliberately NOT the role. The role is what decides who may do what
-- (is_captain(), the staff policies), so if typing a title changed the role,
-- any official could type their way into the captain's powers. This column is
-- a label; nothing reads it to decide permission.

alter table profiles
  add column if not exists position_title text
    constraint profiles_position_title_len check (char_length(position_title) <= 60);

comment on column profiles.position_title is
  'Free-text title of a staff member, shown in the Admin portal. A label only: permissions come from role.';

-- The guard from migration 19 already settles whose name may change. The
-- position is the same kind of thing -- your own to write, nobody else's -- so
-- it is guarded in the same place rather than in a second trigger.
create or replace function guard_name_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Blank or spaces mean "no title of my own", so they are kept as null and
  -- the portal falls back to the label of the role.
  new.position_title := nullif(btrim(new.position_title), '');

  if new.full_name   is not distinct from old.full_name
     and new.first_name  is not distinct from old.first_name
     and new.middle_name is not distinct from old.middle_name
     and new.last_name   is not distinct from old.last_name
     and new.position_title is not distinct from old.position_title then
    return new;
  end if;

  -- A position belongs to the barangay staff. No resident page writes one and
  -- none shows one, so it is refused here rather than quietly stored where
  -- nothing would ever read it.
  if new.position_title is not null and new.role = 'resident' then
    raise exception 'Only barangay staff have a position.';
  end if;

  -- auth.uid() is null only for server-side and SQL-console changes.
  if auth.uid() is not null and auth.uid() <> new.id and old.role <> 'resident' then
    raise exception 'You can only change your own name and position.';
  end if;

  return new;
end;
$$;

revoke all on function guard_name_change() from public, anon, authenticated;
