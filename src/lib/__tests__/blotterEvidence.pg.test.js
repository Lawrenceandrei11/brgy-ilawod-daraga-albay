/**
 * The blotter-evidence migration, run against a real Postgres.
 *
 * PGlite is Postgres compiled to WASM, in-process: no Docker, no network, and
 * no possibility of reaching the production database. The proposal file is
 * read and executed verbatim rather than retyped here, so these tests cannot
 * drift from the SQL that would actually be applied.
 *
 * The storage half runs against a stub `storage` schema -- buckets, objects
 * and foldername() reproduced from Supabase's own definitions. That proves the
 * POLICY LOGIC. It does not prove the Storage API's behaviour (signed URLs,
 * the bucket's own MIME and size rejection), which has no equivalent here.
 *
 * FORCE ROW LEVEL SECURITY matters: PGlite runs as the bootstrap superuser,
 * and superusers bypass RLS. The tests SET ROLE to a real non-superuser
 * `authenticated` role, which is how the policies get exercised at all.
 *
 * Synthetic data only -- invented UUIDs, invented reports, no seed data, no
 * real resident and no real evidence.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const MIGRATION = 'supabase/migrations/20261010191236_30_blotter_evidence.sql'
const BUCKET_MARKER = '-- ---------- the bucket ----------'

const CAPTAIN = '11111111-1111-1111-1111-111111111111'
const RESIDENT = '22222222-2222-2222-2222-222222222222'
const OTHER = '33333333-3333-3333-3333-333333333333'
const REPORT = '44444444-4444-4444-4444-444444444444'
const OTHER_REPORT = '55555555-5555-5555-5555-555555555555'

/** The migration, split where the public schema ends and storage begins. */
function migrationParts() {
  const sql = readFileSync(MIGRATION, 'utf8')
  const at = sql.indexOf(BUCKET_MARKER)
  assert.ok(at > 0, 'the migration must still contain the bucket marker')
  return { publicSql: sql.slice(0, at), storageSql: sql.slice(at) }
}

/**
 * Enough of the live database for the proposal to run: auth.uid(), the enums,
 * the handful of columns these policies read, is_staff() copied verbatim from
 * production, and the live blotter_reports policies.
 */
async function publicWorld() {
  const db = new PGlite()

  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;

    create schema if not exists auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(nullif(current_setting('request.jwt.claims', true), ''), 'null')::uuid
    $$;

    create type user_role      as enum ('resident','secretary','treasurer','captain');
    create type profile_status as enum ('pending','approved','rejected','suspended');
    create type blotter_status as enum ('filed','under_mediation','resolved','referred','dismissed');

    create table profiles (
      id        uuid primary key,
      full_name text,
      role      user_role      not null default 'resident',
      status    profile_status not null default 'pending'
    );

    create table blotter_reports (
      id             uuid primary key default gen_random_uuid(),
      ref_no         text unique not null,
      complainant_id uuid not null references profiles(id) on delete cascade,
      incident_type  text not null,
      incident_at    timestamptz not null default now(),
      location       text not null,
      narrative      text not null,
      status         blotter_status not null default 'filed',
      created_at     timestamptz not null default now(),
      updated_at     timestamptz not null default now()
    );

    create function is_staff() returns boolean
      language sql stable security definer set search_path to 'public' as $$
      select exists (
        select 1 from profiles
        where id = auth.uid()
          and role in ('secretary','treasurer','captain')
          and status = 'approved'
      );
    $$;

    alter table profiles        enable row level security;
    alter table profiles        force  row level security;
    alter table blotter_reports enable row level security;
    alter table blotter_reports force  row level security;

    create policy profiles_read_own on profiles
      for select to authenticated using (id = auth.uid() or is_staff());

    create policy blotter_insert_own on blotter_reports
      for insert to authenticated with check (complainant_id = auth.uid());
    create policy blotter_read on blotter_reports
      for select to authenticated using (complainant_id = auth.uid() or is_staff());
    create policy blotter_staff_update on blotter_reports
      for update to authenticated using (is_staff()) with check (is_staff());

    -- Supabase hands ALL privileges on new public tables to anon and
    -- authenticated by default (verified on the live project). Reproduced here
    -- so the proposal’s own revoke/grant is exercised exactly as it would be.
    alter default privileges in schema public grant all on tables to anon, authenticated;

    grant usage on schema public, auth to anon, authenticated;
    grant select on profiles to authenticated;
    grant select, insert, update on blotter_reports to authenticated;
  `)

  return db
}

/** Supabase's storage schema, reduced to what the policies touch. */
async function storageWorld(db) {
  await db.exec(`
    create schema storage;

    create table storage.buckets (
      id                 text primary key,
      name               text not null,
      public             boolean not null default false,
      file_size_limit    bigint,
      allowed_mime_types text[]
    );

    create table storage.objects (
      id        uuid primary key default gen_random_uuid(),
      bucket_id text not null references storage.buckets(id),
      name      text not null,
      owner     uuid,
      unique (bucket_id, name)
    );

    -- Reproduced from Supabase's own definition: the folder segments, which is
    -- the path without its final element.
    create function storage.foldername(name text) returns text[]
      language plpgsql immutable as $$
      declare parts text[];
      begin
        select string_to_array(name, '/') into parts;
        return parts[1:array_length(parts, 1) - 1];
      end;
      $$;

    alter table storage.objects enable row level security;
    alter table storage.objects force  row level security;

    grant usage on schema storage to anon, authenticated;
    grant select, insert, delete on storage.objects to authenticated;
    grant select on storage.buckets to anon, authenticated;
  `)
}

/** Synthetic rows, inserted as superuser -- not a path the app has. */
async function seed(db) {
  await db.exec(`
    insert into profiles (id, full_name, role, status) values
      ('${CAPTAIN}',  'Test Captain',  'captain',  'approved'),
      ('${RESIDENT}', 'Test Resident', 'resident', 'approved'),
      ('${OTHER}',    'Other Person',  'resident', 'approved');

    insert into blotter_reports (id, ref_no, complainant_id, incident_type, location, narrative)
    values
      ('${REPORT}',       'BLT-00001', '${RESIDENT}', 'Noise complaint', 'Purok 1', 'Synthetic narrative.'),
      ('${OTHER_REPORT}', 'BLT-00002', '${OTHER}',    'Theft',           'Purok 2', 'Synthetic narrative.');
  `)
}

/** The whole world, with the proposal applied exactly as written. */
async function world() {
  const db = await publicWorld()
  await storageWorld(db)
  const { publicSql, storageSql } = migrationParts()
  await db.exec(publicSql)
  await db.exec(storageSql)
  await seed(db)
  return db
}

const as = (db, uid) =>
  db.exec(`reset role; set request.jwt.claims = '${uid}'; set role authenticated;`)
const admin = (db) => db.exec(`reset role; set request.jwt.claims = '';`)

/** Run a statement and return the error message, or null when it succeeded. */
async function refused(db, sql) {
  try {
    await db.exec(sql)
    return null
  } catch (err) {
    return err.message
  }
}

const evidenceRow = (reportId, uploader, path) => `
  insert into blotter_evidence (report_id, storage_path, content_type, byte_size, uploaded_by)
  values ('${reportId}', '${path}', 'image/jpeg', 2048, '${uploader}');
`

const objectRow = (path) => `
  insert into storage.objects (bucket_id, name) values ('blotter-evidence', '${path}');
`

// ------------------------------------------------- the proposal applies

test('P1 the migration applies cleanly to a live-shaped database', async () => {
  const db = await world()
  const { rows } = await db.query(`
    select
      (select count(*) from blotter_evidence)                                      as rows_now,
      (select public from storage.buckets where id = 'blotter-evidence')           as is_public,
      (select allowed_mime_types from storage.buckets where id='blotter-evidence') as mimes,
      (select file_size_limit from storage.buckets where id='blotter-evidence')    as limit_bytes
  `)
  assert.equal(Number(rows[0].rows_now), 0)
  assert.equal(rows[0].is_public, false, 'the evidence bucket must never be public')
  assert.deepEqual(rows[0].mimes, ['image/png', 'image/jpeg', 'image/webp'])
  assert.equal(Number(rows[0].limit_bytes), 5242880)
  await db.close()
})

test('P2 the bucket accepts no PDF and no SVG', async () => {
  const db = await world()
  const { rows } = await db.query(
    `select allowed_mime_types as m from storage.buckets where id = 'blotter-evidence'`
  )
  for (const bad of ['application/pdf', 'image/svg+xml', 'image/gif']) {
    assert.ok(!rows[0].m.includes(bad), `${bad} must not be accepted`)
  }
  await db.close()
})

// --------------------------------------------------- who can read a row

test('P3 the complainant reads their own evidence and nobody else\u2019s', async () => {
  const db = await world()
  await db.exec(evidenceRow(REPORT, RESIDENT, `${RESIDENT}/${REPORT}/mine.jpg`))
  await db.exec(evidenceRow(OTHER_REPORT, OTHER, `${OTHER}/${OTHER_REPORT}/theirs.jpg`))

  await as(db, RESIDENT)
  const { rows } = await db.query('select storage_path from blotter_evidence')
  assert.equal(rows.length, 1, 'exactly their own')
  assert.match(rows[0].storage_path, /mine\.jpg$/)

  await admin(db)
  await db.close()
})

test('P4 an unrelated resident sees no evidence at all', async () => {
  const db = await world()
  await db.exec(evidenceRow(REPORT, RESIDENT, `${RESIDENT}/${REPORT}/mine.jpg`))

  // OTHER has their own report but nothing to do with this one.
  await as(db, OTHER)
  const { rows } = await db.query('select * from blotter_evidence')
  assert.equal(rows.length, 0)

  await admin(db)
  await db.close()
})

test('P5 staff read every report\u2019s evidence', async () => {
  const db = await world()
  await db.exec(evidenceRow(REPORT, RESIDENT, `${RESIDENT}/${REPORT}/a.jpg`))
  await db.exec(evidenceRow(OTHER_REPORT, OTHER, `${OTHER}/${OTHER_REPORT}/b.jpg`))

  await as(db, CAPTAIN)
  const { rows } = await db.query('select storage_path from blotter_evidence')
  assert.equal(rows.length, 2, 'the blotter is reviewed by staff, so staff see the evidence')

  await admin(db)
  await db.close()
})

// --------------------------------------------------- who can insert one

test('P6 a resident attaches to their own report', async () => {
  const db = await world()
  await as(db, RESIDENT)
  const err = await refused(db, evidenceRow(REPORT, RESIDENT, `${RESIDENT}/${REPORT}/ok.jpg`))
  assert.equal(err, null, 'their own report, as themselves')
  await admin(db)
  await db.close()
})

test('P7 a resident cannot attach to someone else\u2019s report', async () => {
  const db = await world()
  await as(db, RESIDENT)
  // A forged report_id: the row claims to belong to OTHER's report.
  const err = await refused(db, evidenceRow(OTHER_REPORT, RESIDENT, `${RESIDENT}/${OTHER_REPORT}/x.jpg`))
  assert.match(err ?? '', /row-level security/i)
  await admin(db)
  await db.close()
})

test('P8 a resident cannot attribute an upload to another person', async () => {
  const db = await world()
  await as(db, RESIDENT)
  const err = await refused(db, evidenceRow(REPORT, OTHER, `${RESIDENT}/${REPORT}/y.jpg`))
  assert.match(err ?? '', /row-level security/i)
  await admin(db)
  await db.close()
})

test('P9 staff cannot attach evidence to a resident\u2019s report', async () => {
  // Only the complainant attaches. Staff review; they do not add to the file.
  const db = await world()
  await as(db, CAPTAIN)
  const err = await refused(db, evidenceRow(REPORT, CAPTAIN, `${CAPTAIN}/${REPORT}/z.jpg`))
  assert.match(err ?? '', /row-level security/i)
  await admin(db)
  await db.close()
})

test('P10 evidence can never be updated or deleted through the API', async () => {
  const db = await world()
  await db.exec(evidenceRow(REPORT, RESIDENT, `${RESIDENT}/${REPORT}/fixed.jpg`))

  await as(db, RESIDENT)
  // No UPDATE or DELETE policy exists, so both are refused for everyone.
  const upd = await refused(db, `update blotter_evidence set byte_size = 1`)
  const del = await refused(db, `delete from blotter_evidence`)
  assert.ok(upd !== null, `a resident cannot edit attached evidence: ${upd}`)
  assert.ok(del !== null, 'a resident cannot delete attached evidence')

  await as(db, CAPTAIN)
  const staffDel = await refused(db, `delete from blotter_evidence`)
  assert.ok(staffDel !== null, 'not even staff: evidence on a filed report is a record')

  await admin(db)
  const { rows } = await db.query('select count(*)::int as n from blotter_evidence')
  assert.equal(rows[0].n, 1, 'the row survived every attempt')
  await db.close()
})

// ----------------------------------------------- the five-photo ceiling

test('P11 a sixth photo is refused by the database, not just the form', async () => {
  const db = await world()
  await as(db, RESIDENT)

  for (let i = 1; i <= 5; i += 1) {
    const err = await refused(db, evidenceRow(REPORT, RESIDENT, `${RESIDENT}/${REPORT}/p${i}.jpg`))
    assert.equal(err, null, `photo ${i} should be accepted`)
  }

  const sixth = await refused(db, evidenceRow(REPORT, RESIDENT, `${RESIDENT}/${REPORT}/p6.jpg`))
  assert.match(sixth ?? '', /at most 5 evidence photos/)

  await admin(db)
  const { rows } = await db.query('select count(*)::int as n from blotter_evidence')
  assert.equal(rows[0].n, 5)
  await db.close()
})

test('P12 the ceiling is per report, not per resident', async () => {
  const db = await world()
  await as(db, RESIDENT)
  for (let i = 1; i <= 5; i += 1) {
    await db.exec(evidenceRow(REPORT, RESIDENT, `${RESIDENT}/${REPORT}/q${i}.jpg`))
  }
  await admin(db)

  // OTHER's own report still has all five of its own places free.
  await as(db, OTHER)
  const err = await refused(db, evidenceRow(OTHER_REPORT, OTHER, `${OTHER}/${OTHER_REPORT}/r1.jpg`))
  assert.equal(err, null)

  await admin(db)
  await db.close()
})

// ------------------------------------------------- deletion and the FKs

test('P13 deleting a report takes its evidence rows with it', async () => {
  const db = await world()
  await db.exec(evidenceRow(REPORT, RESIDENT, `${RESIDENT}/${REPORT}/gone.jpg`))

  // No DELETE policy exists on blotter_reports, so this is a superuser action,
  // not something the app can do. It proves the cascade, not a user journey.
  await db.exec(`delete from blotter_reports where id = '${REPORT}'`)

  const { rows } = await db.query('select count(*)::int as n from blotter_evidence')
  assert.equal(rows[0].n, 0, 'the rows cascade')
  await db.close()
})

test('P14 a profile cannot be deleted while evidence credits them', async () => {
  // uploaded_by is NOT NULL with ON DELETE RESTRICT: auditability is the point
  // of the column, so the database refuses to let the uploader disappear.
  const db = await world()
  await db.exec(evidenceRow(REPORT, RESIDENT, `${RESIDENT}/${REPORT}/audit.jpg`))

  const err = await refused(db, `delete from profiles where id = '${RESIDENT}'`)
  assert.match(err ?? '', /violates RESTRICT setting of foreign key constraint/i)

  const { rows } = await db.query('select count(*)::int as n from blotter_evidence')
  assert.equal(rows[0].n, 1, 'the evidence and its attribution both survive')
  await db.close()
})

// ------------------------------------------------------ storage policies

test('P15 a resident may upload only under their own id', async () => {
  const db = await world()
  await as(db, RESIDENT)

  const own = await refused(db, objectRow(`${RESIDENT}/${REPORT}/ok.jpg`))
  assert.equal(own, null, 'their own folder')

  const foreign = await refused(db, objectRow(`${OTHER}/${OTHER_REPORT}/sneak.jpg`))
  assert.match(foreign ?? '', /row-level security/i)

  await admin(db)
  await db.close()
})

test('P16 an unrelated resident cannot read another resident\u2019s evidence object', async () => {
  const db = await world()
  await db.exec(objectRow(`${RESIDENT}/${REPORT}/private.jpg`))

  await as(db, OTHER)
  const { rows } = await db.query(`select name from storage.objects`)
  assert.equal(rows.length, 0, 'nothing, so no signed URL can be requested for it')

  await as(db, RESIDENT)
  const mine = await db.query(`select name from storage.objects`)
  assert.equal(mine.rows.length, 1, 'the owner sees their own')

  await as(db, CAPTAIN)
  const staff = await db.query(`select name from storage.objects`)
  assert.equal(staff.rows.length, 1, 'staff see it, which is how review works')

  await admin(db)
  await db.close()
})

test('P17 an unassociated object CAN be deleted by its owner: the cleanup window', async () => {
  const db = await world()
  const path = `${RESIDENT}/${REPORT}/orphan.jpg`
  await db.exec(objectRow(path))
  // No blotter_evidence row refers to it -- the upload landed, the insert did
  // not. This is the only moment the file can be removed.

  await as(db, RESIDENT)
  const err = await refused(db, `delete from storage.objects where name = '${path}'`)
  assert.equal(err, null)

  await admin(db)
  const { rows } = await db.query(`select count(*)::int as n from storage.objects`)
  assert.equal(rows[0].n, 0, 'no permanent orphan is left behind')
  await db.close()
})

test('P18 an associated object CANNOT be deleted, even by its owner', async () => {
  const db = await world()
  const path = `${RESIDENT}/${REPORT}/attached.jpg`
  await db.exec(objectRow(path))
  await db.exec(evidenceRow(REPORT, RESIDENT, path))

  await as(db, RESIDENT)
  const err = await refused(db, `delete from storage.objects where name = '${path}'`)
  // The policy stops matching once a row refers to the object, so the delete
  // affects nothing. Either outcome is acceptable; the file surviving is not.
  await admin(db)
  const { rows } = await db.query(`select count(*)::int as n from storage.objects`)
  assert.equal(rows[0].n, 1, `the evidence file survived a direct Storage delete (${err ?? 'no error'})`)
  await db.close()
})

test('P19 staff cannot delete an associated evidence object either', async () => {
  const db = await world()
  const path = `${RESIDENT}/${REPORT}/attached.jpg`
  await db.exec(objectRow(path))
  await db.exec(evidenceRow(REPORT, RESIDENT, path))

  await as(db, CAPTAIN)
  await refused(db, `delete from storage.objects where name = '${path}'`)

  await admin(db)
  const { rows } = await db.query(`select count(*)::int as n from storage.objects`)
  assert.equal(rows[0].n, 1, 'evidence on a filed report is a record for everyone')
  await db.close()
})

test('P20 anon reaches neither the table nor the objects', async () => {
  const db = await world()
  await db.exec(objectRow(`${RESIDENT}/${REPORT}/a.jpg`))
  await db.exec(evidenceRow(REPORT, RESIDENT, `${RESIDENT}/${REPORT}/a.jpg`))

  await db.exec(`reset role; set request.jwt.claims = ''; set role anon;`)
  const table = await refused(db, `select * from blotter_evidence`)
  assert.ok(table !== null, 'anon has no privilege on the evidence table at all')

  const objects = await refused(db, `select count(*) from storage.objects`)
  assert.ok(objects !== null, 'and anon cannot even read the objects table')

  await admin(db)
  await db.close()
})

// ------------------------------------------- the helper is not an RPC

test('P21 the helper lives outside public, so the Data API cannot expose it', async () => {
  const db = await world()
  const { rows } = await db.query(`
    select n.nspname as schema, p.prosecdef as security_definer,
           coalesce(array_to_string(p.proconfig, ','), '') as config
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'evidence_is_associated'
  `)

  assert.equal(rows.length, 1, 'exactly one copy of the helper')
  assert.equal(rows[0].schema, 'private', 'never in public: PostgREST exposes public')
  assert.equal(rows[0].security_definer, true, 'the answer must not depend on the reader')
  // Empty, not just set: the body must resolve nothing from a caller's path.
  assert.equal(rows[0].config, 'search_path=""', 'search_path is pinned to empty')
  await db.close()
})

test('P22 the function body is schema-qualified, so an empty search_path works', async () => {
  const db = await world()
  // Calling it as superuser with a hostile search_path must still resolve.
  await db.exec(`set search_path to pg_catalog;`)
  const { rows } = await db.query(
    `select private.evidence_is_associated('nobody/nothing/none.jpg') as answer`
  )
  assert.equal(rows[0].answer, false)
  await db.exec(`reset search_path;`)
  await db.close()
})

test('P23 anon can neither reach the schema nor execute the helper', async () => {
  const db = await world()

  await db.exec(`reset role; set request.jwt.claims = ''; set role anon;`)
  const err = await refused(db, `select private.evidence_is_associated('a/b/c.jpg')`)
  assert.ok(err !== null, 'anon has no execute privilege, and no usage on the schema')
  assert.match(err ?? '', /permission denied/i)

  await admin(db)
  await db.close()
})

test('P24 authenticated can execute it, which is what the storage policy needs', async () => {
  const db = await world()
  await as(db, RESIDENT)
  const { rows } = await db.query(
    `select private.evidence_is_associated('nobody/nothing/none.jpg') as answer`
  )
  assert.equal(rows[0].answer, false, 'callable, so the DELETE policy can evaluate')
  await admin(db)
  await db.close()
})

test('P25 the helper answers the same for everyone, including about another resident', async () => {
  // This is why it is SECURITY DEFINER: an owner deleting their own object must
  // get "associated" even if some future RLS change hid the row from them.
  const db = await world()
  const path = `${OTHER}/${OTHER_REPORT}/theirs.jpg`
  await db.exec(objectRow(path))
  await db.exec(evidenceRow(OTHER_REPORT, OTHER, path))

  await as(db, RESIDENT)
  const { rows } = await db.query(
    `select private.evidence_is_associated('${path}') as answer`
  )
  assert.equal(rows[0].answer, true, 'the fact does not change with the reader')

  await admin(db)
  await db.close()
})
