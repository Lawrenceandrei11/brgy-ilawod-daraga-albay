-- ============================================================
-- 30_blotter_evidence
--
-- Photographs attached to a blotter report.
--
-- APPLIED. This migration has been applied to production and is recorded in
-- supabase_migrations.schema_migrations as version 20261010191236, name
-- 30_blotter_evidence. This filename matches that version. Do not apply it
-- again; the DDL below is not written to be re-runnable.
--
-- This file is the authoritative copy. The executed statements were verified
-- against it afterwards: with comments and whitespace stripped, both sides
-- hash identically, so the SQL here is what ran.
--
-- supabase/proposals/blotter-evidence.sql.proposed is a pointer to this file
-- and contains no SQL, so there is nothing there to apply by accident.
--
-- Tested against a real Postgres with PGlite in
-- src/lib/__tests__/blotterEvidence.pg.test.js, which reads THIS file.
--
-- Additive throughout: no existing table, policy, bucket or function is
-- altered or dropped. blotter_reports keeps its three policies and its absent
-- DELETE policy, so report deletion behaviour is unchanged. track_blotter is
-- untouched -- it returns a fixed five-column list, so evidence cannot leak
-- through the anonymous tracker.
--
-- Two design decisions are load-bearing:
--
--   uploaded_by is NOT NULL with ON DELETE RESTRICT. Auditability is the whole
--   point of the column, and ON DELETE SET NULL would destroy exactly the fact
--   being audited. RESTRICT makes the database refuse to let a profile vanish
--   while evidence still attributes an upload to it. delete_resident already
--   refuses to delete a resident who has any blotter report; this makes the
--   same guarantee at the schema level, where it does not depend on that RPC
--   being the only path.
--
--   The storage DELETE policy allows removing only objects that NO evidence
--   row refers to. That is exactly the upload-failure window: the file has
--   landed but nothing points at it yet, so the client can tidy up. The moment
--   a row exists the object is permanent -- a resident cannot delete it, not
--   through the app and not through a direct Storage call. There is no staff
--   delete either: evidence on an official record is a record.
--
-- Remaining limitation, deliberately not solved here: Storage validates the
-- content type an upload DECLARES, not the bytes. A file renamed to .jpg with
-- a crafted header can still satisfy the bucket. The client decodes every
-- image before uploading, which closes the ordinary case, but a determined
-- uploader could still store non-image bytes under an image content type.
-- Magic-byte verification would need an Edge Function at a trusted boundary
-- and is out of scope for this change.
-- ============================================================

-- ---------- the table ----------

create table blotter_evidence (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references blotter_reports(id) on delete cascade,
  storage_path text not null unique,
  content_type text not null check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
  byte_size    integer not null check (byte_size > 0 and byte_size <= 5242880),
  uploaded_by  uuid not null references profiles(id) on delete restrict,
  created_at   timestamptz not null default now()
);

comment on table blotter_evidence is
  'Photographs attached to a blotter report. Files live in the private blotter-evidence bucket; this table is the only record that they exist.';

create index blotter_evidence_report_idx on blotter_evidence (report_id, created_at);

-- ---------- least privilege at the grant layer too ----------
--
-- Supabase's default privileges hand ALL privileges on a new public table to
-- both anon and authenticated, leaving RLS as the only gate. Verified on this
-- project: blotter_reports and profiles both carry the full set for both
-- roles. For evidence that is more than is needed, so it is taken back:
--
--   anon gets nothing at all -- it has no policy here either, but a role that
--   cannot reach the table does not depend on a policy staying correct;
--
--   authenticated gets select and insert only. There is deliberately no
--   UPDATE or DELETE policy, and withholding the privilege as well means a
--   policy added carelessly in future still cannot make evidence editable.

revoke all on blotter_evidence from anon;
revoke all on blotter_evidence from authenticated;
grant select, insert on blotter_evidence to authenticated;

-- ---------- at most five per report ----------
--
-- The cap belongs here rather than only in the browser. The row lock on the
-- parent report serialises concurrent inserts for the same report, so two
-- tabs uploading at once cannot both read four and both insert a fifth.

create or replace function enforce_blotter_evidence_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  perform 1 from blotter_reports where id = new.report_id for update;

  select count(*) into n from blotter_evidence where report_id = new.report_id;
  if n >= 5 then
    raise exception 'A blotter report may have at most 5 evidence photos.';
  end if;

  return new;
end;
$$;

create trigger blotter_evidence_limit
  before insert on blotter_evidence
  for each row execute function enforce_blotter_evidence_limit();

-- ---------- row level security ----------

alter table blotter_evidence enable row level security;

-- Mirrors blotter_read exactly: the complainant who filed it, or approved
-- staff. is_staff() is secretary, treasurer or captain -- the same people who
-- already review the blotter, no wider and no narrower.
create policy blotter_evidence_read on blotter_evidence
  for select to authenticated
  using (
    exists (
      select 1 from blotter_reports b
      where b.id = blotter_evidence.report_id
        and (b.complainant_id = auth.uid() or is_staff())
    )
  );

-- A resident may attach only to their OWN report, and only as themselves. A
-- forged report_id is refused by the database, not by the screen.
create policy blotter_evidence_insert_own on blotter_evidence
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from blotter_reports b
      where b.id = blotter_evidence.report_id
        and b.complainant_id = auth.uid()
    )
  );

-- Deliberately no UPDATE and no DELETE policy. Once a photograph is attached
-- to a filed report it is part of the record: it cannot be edited, reassigned
-- to another report, or removed.

-- ---------- the bucket ----------
--
-- PRIVATE. A photograph of an injury or of the inside of someone's house is
-- not something to serve from a public URL, and this bucket must never be
-- flipped to public.
--
-- A new bucket rather than reusing valid-ids: that bucket's read policy already
-- grants owner-or-staff by path, and mixing government ID documents with
-- incident evidence under one policy namespace would make least-privilege and
-- retention harder to reason about, not easier.
--
-- No PDF: evidence is photographic. No SVG: it can carry script, and although
-- public-assets accepts it, nothing here should.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('blotter-evidence', 'blotter-evidence', false, 5242880,
   array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- ---------- is this object already part of the record? ----------
--
-- SECURITY DEFINER so the answer does not depend on what the caller can see
-- through blotter_evidence's own RLS. A storage policy that subqueried the
-- table directly would be asking a question whose answer changes with the
-- reader, which is not what "is this associated" means.
--
-- It lives in `private`, NOT in `public`, so the Data API does not turn it
-- into /rest/v1/rpc/evidence_is_associated. PostgREST exposes only the schemas
-- listed in the project's API settings; a schema that is not on that list has
-- no REST surface at all. That list is platform configuration rather than
-- database state -- pgrst.db_schemas is set neither database-wide nor on the
-- authenticator role -- so it cannot be read from SQL. It was checked in the
-- Dashboard before this migration was applied: Data API -> Settings -> Exposed
-- schemas holds exactly graphql_public and public, and not private. Should
-- that ever change, the exposure would be no worse than leaving the function
-- in public, and the value it returns is only a boolean about a path that
-- already contains a timestamp and a random suffix.
--
-- search_path is empty and every reference is schema-qualified, so the body
-- cannot be redirected by a caller's search_path.

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated;

create or replace function private.evidence_is_associated(p_path text)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (select 1 from public.blotter_evidence where storage_path = p_path);
$fn$;

-- Only signed-in callers, and only through the storage policy in practice.
revoke all on function private.evidence_is_associated(text) from public;
revoke all on function private.evidence_is_associated(text) from anon;
grant execute on function private.evidence_is_associated(text) to authenticated;

-- ---------- storage policies ----------
-- Path convention: blotter-evidence/<uploader id>/<report id>/<file>
-- The first segment is what every policy keys on, exactly as valid-ids and
-- avatars already do.

create policy blotter_evidence_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'blotter-evidence'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- The complainant reads their own evidence; staff read all of it. Both still
-- need a signed URL, because the bucket is private.
create policy blotter_evidence_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'blotter-evidence'
    and ((storage.foldername(name))[1] = auth.uid()::text or is_staff())
  );

-- The upload-failure window, and nothing else. Once an evidence row refers to
-- this object the policy stops matching and the object cannot be deleted by
-- anyone through the API -- which is the requirement: a resident must not be
-- able to remove evidence once it is attached to a filed report.
create policy blotter_evidence_delete_unassociated on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'blotter-evidence'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not private.evidence_is_associated(name)
  );

-- No UPDATE policy: an uploaded photograph is never overwritten in place.
