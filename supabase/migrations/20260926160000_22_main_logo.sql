-- ============================================================
-- The system's main logo, changeable by the Punong Barangay
--
-- Nothing new is invented here. The file goes in public-assets, the bucket
-- the officials' portraits and notice covers already use, under a branding/
-- folder of its own so it cannot be confused with either. Which file is
-- current is recorded in settings, whose policies already say what this
-- feature needs: settings_captain_write lets only the captain write a
-- setting, settings_staff_read lets staff read one.
--
-- Two things still had to be added:
--
--   1. Storage was too generous. public_assets_staff_* let any staff member
--      write anywhere in the bucket, so a secretary could have replaced the
--      logo by uploading over it. Those three policies now exclude the
--      branding/ folder unless the caller is the captain. Everything else in
--      the bucket is untouched, so announcements and portraits still work
--      exactly as before.
--
--   2. The logo has to be readable by people who cannot read settings: a
--      visitor with no account, a resident signing in. main_logo_path()
--      hands out that one key and nothing else.
-- ============================================================

-- ------------------------------------------------------------
-- Which file is the logo, readable by everyone
-- ------------------------------------------------------------
create or replace function main_logo_path()
returns text
language sql
stable
security definer
set search_path = public
as $$
  -- #>> '{}' unwraps the jsonb string; a null or removed setting means the
  -- default artwork, which the page falls back to on its own.
  select nullif(btrim(coalesce(value #>> '{}', '')), '')
  from settings
  where key = 'main_logo_path';
$$;

comment on function main_logo_path() is
  'The current main logo''s path in public-assets, or null for the default artwork. Readable by anyone; only the captain can change it (settings_captain_write).';

revoke all on function main_logo_path() from public;
grant execute on function main_logo_path() to anon, authenticated;

-- ------------------------------------------------------------
-- branding/ is the captain's folder
--
-- Same three policies as before, with one clause added to each: staff keep
-- the rest of the bucket, the branding folder needs the captain. Written as
-- "not in branding OR captain" so a non-captain is refused by the policy
-- itself, not by the page.
-- ------------------------------------------------------------
drop policy if exists public_assets_staff_write on storage.objects;
create policy public_assets_staff_write on storage.objects
  for insert
  with check (
    bucket_id = 'public-assets'
    and is_staff()
    and ((storage.foldername(name))[1] is distinct from 'branding' or is_captain())
  );

drop policy if exists public_assets_staff_update on storage.objects;
create policy public_assets_staff_update on storage.objects
  for update
  using (
    bucket_id = 'public-assets'
    and is_staff()
    and ((storage.foldername(name))[1] is distinct from 'branding' or is_captain())
  )
  with check (
    bucket_id = 'public-assets'
    and is_staff()
    and ((storage.foldername(name))[1] is distinct from 'branding' or is_captain())
  );

drop policy if exists public_assets_staff_delete on storage.objects;
create policy public_assets_staff_delete on storage.objects
  for delete
  using (
    bucket_id = 'public-assets'
    and is_staff()
    and ((storage.foldername(name))[1] is distinct from 'branding' or is_captain())
  );
