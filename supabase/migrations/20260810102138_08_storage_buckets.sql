-- ============================================================
-- Storage
--
-- valid-ids is PRIVATE. A photograph of someone's government ID is the most
-- sensitive file this system holds; it must never be reachable by URL.
-- Files are namespaced by owner id so the policies can key off the path.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('valid-ids', 'valid-ids', false, 5242880,
   array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']),
  ('public-assets', 'public-assets', true, 5242880,
   array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;

-- ---------- valid-ids: owner or staff only ----------
-- Path convention: valid-ids/<profile_id>/<filename>
create policy valid_ids_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'valid-ids'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy valid_ids_read_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'valid-ids'
    and ((storage.foldername(name))[1] = auth.uid()::text or is_staff())
  );

create policy valid_ids_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'valid-ids'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy valid_ids_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'valid-ids'
    and ((storage.foldername(name))[1] = auth.uid()::text or is_staff())
  );

-- ---------- public-assets: world-readable, staff-writable ----------
create policy public_assets_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'public-assets');

create policy public_assets_staff_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'public-assets' and is_staff());

create policy public_assets_staff_update on storage.objects
  for update to authenticated
  using (bucket_id = 'public-assets' and is_staff());

create policy public_assets_staff_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'public-assets' and is_staff());
