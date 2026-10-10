/**
 * The proposed ID re-verification migration, run against a real Postgres.
 *
 * PGlite is Postgres compiled to WASM, in-process: no Docker, no network, and
 * no possibility of reaching the production database. The fixture is the
 * minimum the migration actually depends on -- auth.uid(), the two enums,
 * eleven of the thirty-one profiles columns, is_staff() copied verbatim, and
 * the two RLS policies.
 *
 * FORCE ROW LEVEL SECURITY matters: PGlite runs as the bootstrap superuser,
 * and superusers bypass RLS. Without it the policy tests would pass while
 * proving nothing.
 *
 * Synthetic data only -- four invented rows, no seed data, no real resident.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const SEC = '11111111-1111-1111-1111-111111111111'
const RES = '22222222-2222-2222-2222-222222222222'
const OTHER = '33333333-3333-3333-3333-333333333333'

/** guard_profile_columns() exactly as it is in production today. */
const LIVE_GUARD = `
create or replace function public.guard_profile_columns()
returns trigger language plpgsql security definer set search_path to 'public'
as $f$
begin
  if is_staff() then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.status is distinct from old.status
     or new.resident_id is distinct from old.resident_id
     or new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at then
    raise exception 'Only barangay staff may change role, status or resident ID';
  end if;
  return new;
end;
$f$;`

async function fixture() {
  const db = new PGlite()
  await db.exec(`
    create schema if not exists auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(nullif(current_setting('request.jwt.claims', true), ''), 'null')::uuid
    $$;

    create type user_role as enum ('resident','secretary','treasurer','captain');
    create type profile_status as enum ('pending','approved','rejected','suspended');

    create table profiles (
      id uuid primary key,
      full_name text,
      role user_role not null default 'resident',
      status profile_status not null default 'pending',
      resident_id text,
      approved_by uuid,
      approved_at timestamptz,
      address_line text,
      valid_id_path text,
      valid_id_number text,
      valid_id_type text
    );

    create function is_staff() returns boolean language sql stable security definer as $$
      select exists (select 1 from profiles
        where id = auth.uid() and role in ('secretary','treasurer','captain')
          and status = 'approved')
    $$;

    alter table profiles enable row level security;
    -- Without FORCE, the superuser running these tests bypasses RLS entirely.
    alter table profiles force row level security;
    create policy profiles_read_own on profiles for select
      using (id = auth.uid() or is_staff());
    create policy profiles_update_own on profiles for update
      using (id = auth.uid() or is_staff()) with check (id = auth.uid() or is_staff());

    create role authenticated nologin;
    grant usage on schema public, auth to authenticated;
    grant select, update on profiles to authenticated;

    insert into profiles (id, full_name, role, status, resident_id, approved_at, valid_id_path, valid_id_number, valid_id_type) values
      ('${SEC}',   'Staff Secretary', 'secretary', 'approved', null,            now(), null,              null,          null),
      ('${RES}',   'Test Resident',   'resident',  'approved', 'ILW-2026-0001', now(), '${RES}/a.png',    'TEST-000001', 'Postal ID'),
      ('${OTHER}', 'Other Resident',  'resident',  'approved', 'ILW-2026-0002', now(), '${OTHER}/b.png',  'TEST-000002', 'Postal ID');
  `)
  // The guard function must exist before the trigger can reference it.
  await db.exec(LIVE_GUARD)
  await db.exec(`create trigger profiles_guard_columns before update on profiles
    for each row execute function guard_profile_columns();`)
  return db
}

/** Apply the proposal's executable SQL, skipping the ALTER (table is fresh). */
async function applyProposal(db) {
  const sql = readFileSync('supabase/proposals/valid-id-recheck.sql.proposed', 'utf8')
  await db.exec(`
    alter table profiles
      add column if not exists valid_id_replaced_at timestamptz,
      add column if not exists valid_id_reviewed_at timestamptz;`)
  // The two function bodies and the index, taken from the proposal itself so
  // the tests cannot drift from the file that will be applied.
  const guard = sql.slice(
    sql.indexOf('create or replace function public.guard_profile_columns()'),
    sql.indexOf('-- No second trigger'),
  )
  const rpc = sql.slice(
    sql.indexOf('create or replace function public.mark_valid_id_reviewed(uuid)') >= 0
      ? sql.indexOf('create or replace function public.mark_valid_id_reviewed(uuid)')
      : sql.indexOf('create or replace function public.mark_valid_id_reviewed(p_profile_id uuid)'),
    sql.indexOf('revoke all on function'),
  )
  assert.ok(guard.includes('v_doc_changed'), 'guard body not found in the proposal file')
  assert.ok(rpc.includes('is_staff()'), 'rpc body not found in the proposal file')
  await db.exec(guard)
  await db.exec(rpc)
}

// A superuser bypasses RLS even with FORCE, so acting as a user means
// switching to a non-superuser role as well as setting the claim.
const asUser = (db, uid) =>
  db.exec(`reset role; set request.jwt.claims = '${uid}'; set role authenticated;`)
const admin = (db) => db.exec(`reset role; set request.jwt.claims = '';`)

async function refused(db, sql) {
  try {
    await db.exec(sql)
    return null
  } catch (e) {
    return String(e.message ?? e)
  }
}

const row = async (db, id) =>
  (await db.query(`select * from profiles where id = $1`, [id])).rows[0]

const queue = async (db) =>
  (
    await db.query(`select count(*)::int n from profiles
       where valid_id_replaced_at is not null
         and (valid_id_reviewed_at is null or valid_id_reviewed_at < valid_id_replaced_at)`)
  ).rows[0].n

// ============================ the tests ============================

test('the live guard does NOT flag a replacement (the gap being fixed)', async () => {
  const db = await fixture()
  await db.exec(LIVE_GUARD)
  await db.exec(`alter table profiles
    add column valid_id_replaced_at timestamptz, add column valid_id_reviewed_at timestamptz;`)
  await asUser(db, RES)
  await db.exec(`update profiles set valid_id_path = '${RES}/new.png' where id = '${RES}';`)
  await admin(db)
  assert.equal((await row(db, RES)).valid_id_replaced_at, null, 'live guard stamps nothing')
  await db.close()
})

test('T1-T4 the trigger stamps every identity-document change and nothing else', async () => {
  const db = await fixture()
  await db.exec(LIVE_GUARD)
  await applyProposal(db)
  await asUser(db, RES)

  // T1 file
  await db.exec(`update profiles set valid_id_path = '${RES}/new.png' where id = '${RES}';`)
  let r = await row(db, RES)
  assert.ok(r.valid_id_replaced_at, 'T1 path change stamped')
  assert.equal(r.valid_id_reviewed_at, null, 'T1 not reviewed')

  // T2 number only
  await asUser(db, SEC)   // staff may clear it; the resident may not
  await db.exec(`update profiles set valid_id_replaced_at = null where id='${RES}';`)
  await asUser(db, RES)
  await db.exec(`update profiles set valid_id_number = 'CHANGED-1' where id = '${RES}';`)
  assert.ok((await row(db, RES)).valid_id_replaced_at, 'T2 number change stamped')

  // T3 type only
  await asUser(db, SEC)   // staff may clear it; the resident may not
  await db.exec(`update profiles set valid_id_replaced_at = null where id='${RES}';`)
  await asUser(db, RES)
  await db.exec(`update profiles set valid_id_type = 'Passport' where id = '${RES}';`)
  assert.ok((await row(db, RES)).valid_id_replaced_at, 'T3 type change stamped')

  // T4 unrelated column
  await asUser(db, SEC)   // staff may clear it; the resident may not
  await db.exec(`update profiles set valid_id_replaced_at = null where id='${RES}';`)
  await asUser(db, RES)
  await db.exec(`update profiles set address_line = '1 New Street' where id = '${RES}';`)
  assert.equal((await row(db, RES)).valid_id_replaced_at, null, 'T4 unrelated change not stamped')

  await db.close()
})

test('T5 two changes in one transaction advance the stamp (clock_timestamp regression)', async () => {
  const db = await fixture()
  await db.exec(LIVE_GUARD)
  await applyProposal(db)
  await asUser(db, RES)
  await db.exec('begin;')
  await db.exec(`update profiles set valid_id_path = '${RES}/one.png' where id = '${RES}';`)
  const first = (await row(db, RES)).valid_id_replaced_at
  await db.exec(`update profiles set valid_id_path = '${RES}/two.png' where id = '${RES}';`)
  const second = (await row(db, RES)).valid_id_replaced_at
  await db.exec('commit;')
  assert.ok(new Date(second) > new Date(first), 'with now() these would tie')
  await db.close()
})

test('T6-T9 a resident cannot forge, backdate, clear, or self-review', async () => {
  const db = await fixture()
  await db.exec(LIVE_GUARD)
  await applyProposal(db)
  await asUser(db, RES)
  await db.exec(`update profiles set valid_id_path = '${RES}/new.png' where id = '${RES}';`)

  const t6 = await refused(db, `update profiles set valid_id_reviewed_at = now() where id='${RES}';`)
  assert.match(t6 ?? '', /staff may mark a valid ID as reviewed/, 'T6 self-review refused')

  const t7 = await refused(db, `update profiles set valid_id_replaced_at = '1970-01-01' where id='${RES}';`)
  assert.match(t7 ?? '', /set automatically/, 'T7 backdating refused')

  const t8 = await refused(db, `update profiles set valid_id_replaced_at = null where id='${RES}';`)
  assert.match(t8 ?? '', /set automatically/, 'T8 clearing refused')

  const t9 = await refused(db, `select mark_valid_id_reviewed('${RES}');`)
  assert.match(t9 ?? '', /Only barangay staff/, 'T9 rpc refused')

  await db.close()
})

test('T10 the live rules are preserved verbatim', async () => {
  const db = await fixture()
  await db.exec(LIVE_GUARD)
  await applyProposal(db)
  await asUser(db, RES)
  for (const col of [
    `status = 'pending'`,
    `resident_id = 'ILW-9999'`,
    `role = 'captain'`,
    `approved_at = now()`,
    `approved_by = '${SEC}'`,
  ]) {
    const err = await refused(db, `update profiles set ${col} where id='${RES}';`)
    assert.match(err ?? '', /Only barangay staff may change role, status or resident ID/, col)
  }
  await db.close()
})

test('T11 a resident cannot touch another resident row', async () => {
  const db = await fixture()
  await db.exec(LIVE_GUARD)
  await applyProposal(db)
  await asUser(db, RES)
  await db.exec(`update profiles set valid_id_path = '${OTHER}/hacked.png' where id = '${OTHER}';`)

  // Only their own row is visible, so the attempt matched nothing.
  const seen = await db.query('select count(*)::int n from profiles')
  assert.equal(seen.rows[0].n, 1, 'a resident sees only themselves')

  // Confirm from outside the policy that the other row really is untouched.
  await admin(db)
  assert.equal((await row(db, OTHER)).valid_id_path, `${OTHER}/b.png`, 'RLS blocked the write')
  await db.close()
})

test('T12-T14 the queue fills, clears on review, and refills on re-replacement', async () => {
  const db = await fixture()
  await db.exec(LIVE_GUARD)
  await applyProposal(db)

  await asUser(db, RES)
  await db.exec(`update profiles set valid_id_path = '${RES}/new.png' where id = '${RES}';`)
  await asUser(db, SEC)
  assert.equal(await queue(db), 1, 'T12 queued after replacement')

  const kept = await db.query(`select mark_valid_id_reviewed('${RES}') as p`)
  assert.equal(kept.rows[0].p, `${RES}/new.png`, 'rpc returns the path it blessed')
  assert.equal(await queue(db), 0, 'T13 cleared after review')

  await asUser(db, RES)
  await db.exec(`update profiles set valid_id_number = 'AGAIN-2' where id = '${RES}';`)
  await asUser(db, SEC)
  assert.equal(await queue(db), 1, 'T14 re-queued after a further change')
  await db.close()
})

test('T15 approval and access survive the whole cycle', async () => {
  const db = await fixture()
  await db.exec(LIVE_GUARD)
  await applyProposal(db)
  const before = await row(db, RES)

  await asUser(db, RES)
  await db.exec(`update profiles set valid_id_path = '${RES}/new.png' where id = '${RES}';`)
  await db.exec(`update profiles set valid_id_number = 'X-1' where id = '${RES}';`)
  await asUser(db, SEC)
  await db.query(`select mark_valid_id_reviewed('${RES}')`)

  const after = await row(db, RES)
  for (const col of ['status', 'resident_id', 'role', 'approved_by', 'approved_at']) {
    assert.deepEqual(after[col], before[col], `${col} must be untouched`)
  }
  assert.equal(after.status, 'approved')
  await db.close()
})

test('T16 staff replacing a document never queues itself', async () => {
  const db = await fixture()
  await db.exec(LIVE_GUARD)
  await applyProposal(db)
  await asUser(db, SEC)
  await db.exec(`update profiles set valid_id_path = '${RES}/by-staff.png' where id = '${RES}';`)
  assert.equal(await queue(db), 0, 'staff change is reviewed as it is made')
  const r = await row(db, RES)
  assert.ok(r.valid_id_replaced_at && r.valid_id_reviewed_at, 'both stamped')
  await db.close()
})
