-- ============================================================
-- Profile pictures for residents and Admin portal users
--
-- A picture only shows who is signed in. It is never read by face sign-in,
-- which matches against face_templates alone; the two live in different
-- places so that can never change by accident.
-- ============================================================

alter table profiles
  add column if not exists avatar_path text;

comment on column profiles.avatar_path is
  'Path in the private avatars bucket, always under the owner''s own folder. Owner-only (guard_avatar_path). Never used for face matching.';

-- ------------------------------------------------------------
-- The bucket
--
-- Private: a resident's photo is personal data, so it is served only
-- through short-lived signed URLs to the person it belongs to. Its own
-- bucket, not valid-ids, so selfies never sit beside ID scans.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Each user reads and writes only avatars/<their own id>/..., the same
-- pattern valid-ids uses. Unlike valid-ids, staff get no read-all rule:
-- nobody but the owner ever needs to fetch someone's picture.
drop policy if exists avatars_read_own   on storage.objects;
drop policy if exists avatars_insert_own on storage.objects;
drop policy if exists avatars_update_own on storage.objects;
drop policy if exists avatars_delete_own on storage.objects;

create policy avatars_read_own on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ------------------------------------------------------------
-- Owner-only avatar_path
--
-- profiles_update_own lets staff update any profile, which approving
-- residents needs. Without this, a staff member could also set or clear a
-- resident's picture. It applies to every role equally, so neither side
-- can touch the other's.
-- ------------------------------------------------------------
create or replace function guard_avatar_path()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.avatar_path is not distinct from old.avatar_path then
    return new;
  end if;
  if tg_op = 'INSERT' and new.avatar_path is null then
    return new;
  end if;

  -- auth.uid() is null only for server-side and SQL-console changes.
  if auth.uid() is not null and auth.uid() <> new.id then
    raise exception 'You can only change your own profile picture.';
  end if;

  if new.avatar_path is not null and split_part(new.avatar_path, '/', 1) <> new.id::text then
    raise exception 'A profile picture must be stored in your own folder.';
  end if;

  return new;
end;
$$;

revoke all on function guard_avatar_path() from public, anon, authenticated;

drop trigger if exists profiles_guard_avatar on profiles;
create trigger profiles_guard_avatar
  before insert or update of avatar_path on profiles
  for each row execute function guard_avatar_path();
