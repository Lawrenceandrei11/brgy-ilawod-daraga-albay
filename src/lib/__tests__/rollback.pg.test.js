/**
 * The rollback script, exercised in an isolated Postgres.
 *
 * The thing being proved is the ORDER: the function is restored before the
 * columns are dropped. Dropping first would leave the migration's guard body
 * referencing columns that no longer exist, and every UPDATE on profiles --
 * including the ones staff would need to recover -- would fail.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

/**
 * These tests read the two recovery artefacts from the pre-migration backup,
 * which lives OUTSIDE the repository on purpose -- it sits beside a CSV of
 * real resident data and must never be committed. So on any machine but the
 * one that took the backup, the inputs simply are not there.
 *
 * Absent inputs are a skip. Anything else is a failure: if the files exist
 * but have the wrong contents, or the rollback misbehaves, these must go red
 * rather than quietly pass.
 */
const BACKUP = process.env.BRGY_BACKUP_DIR ?? 'C:/Users/Perri/Desktop/brgy-backup-2026-10-10-premigration'
const REQUIRED = ['guard_profile_columns.live.sql', 'rollback.sql']
const missing = REQUIRED.filter((f) => !existsSync(`${BACKUP}/${f}`))
const skip =
  missing.length === 0
    ? false
    : `pre-migration backup not available here (missing ${missing.join(', ')}). ` +
      'Set BRGY_BACKUP_DIR to run these.'

const RES = '22222222-2222-2222-2222-222222222222'

async function base() {
  const db = new PGlite()
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(nullif(current_setting('request.jwt.claims', true), ''), 'null')::uuid $$;
    create type user_role as enum ('resident','secretary','treasurer','captain');
    create type profile_status as enum ('pending','approved','rejected','suspended');
    create table profiles (
      id uuid primary key, full_name text,
      role user_role not null default 'resident',
      status profile_status not null default 'pending',
      resident_id text, approved_by uuid, approved_at timestamptz,
      address_line text, valid_id_path text, valid_id_number text, valid_id_type text);
    create function is_staff() returns boolean language sql stable security definer as $$
      select exists (select 1 from profiles where id = auth.uid()
        and role in ('secretary','treasurer','captain') and status='approved') $$;
    insert into profiles (id, role, status, resident_id, valid_id_path)
      values ('${RES}','resident','approved','ILW-0001','${RES}/a.png');`)
  // The live guard, from the backup file itself.
  await db.exec(readFileSync(`${BACKUP}/guard_profile_columns.live.sql`, 'utf8'))
  await db.exec(`create trigger profiles_guard_columns before update on profiles
    for each row execute function guard_profile_columns();`)
  return db
}

async function applyMigration(db) {
  const sql = readFileSync('supabase/proposals/valid-id-recheck.sql.proposed', 'utf8')
  await db.exec(`alter table profiles
    add column valid_id_replaced_at timestamptz, add column valid_id_reviewed_at timestamptz;`)
  await db.exec(sql.slice(
    sql.indexOf('create or replace function public.guard_profile_columns()'),
    sql.indexOf('-- No second trigger')))
  await db.exec(sql.slice(
    sql.indexOf('create or replace function public.mark_valid_id_reviewed'),
    sql.indexOf('revoke all on function')))
  await db.exec(`create index profiles_valid_id_needs_check on profiles (valid_id_replaced_at)
    where valid_id_replaced_at is not null;`)
}

/** The rollback file, minus BEGIN/COMMIT (PGlite exec runs its own txn). */
function rollbackSql() {
  return readFileSync(`${BACKUP}/rollback.sql`, 'utf8')
    .replace(/^begin;$/m, '')
    .replace(/^commit;$/m, '')
}

const guardBody = async (db) =>
  (await db.query(
    `select pg_get_functiondef('public.guard_profile_columns()'::regprocedure) d`,
  )).rows[0].d

test('the migration applies, then the rollback restores the original function', { skip }, async () => {
  const db = await base()
  const before = await guardBody(db)
  assert.ok(!before.includes('v_doc_changed'), 'baseline is the live guard')

  await applyMigration(db)
  assert.ok((await guardBody(db)).includes('v_doc_changed'), 'migration installed')

  await db.exec(rollbackSql())

  const after = await guardBody(db)
  assert.ok(!after.includes('v_doc_changed'), 'migration guard gone')
  assert.ok(after.includes('Only barangay staff may change role, status or resident ID'))
  assert.equal(after, before, 'function restored byte for byte')
  await db.close()
})

test('the rollback leaves no columns, index or RPC behind', { skip }, async () => {
  const db = await base()
  await applyMigration(db)
  await db.exec(rollbackSql())

  const cols = await db.query(`select count(*)::int n from information_schema.columns
    where table_name='profiles' and column_name in ('valid_id_replaced_at','valid_id_reviewed_at')`)
  assert.equal(cols.rows[0].n, 0, 'columns dropped')

  const rpc = await db.query(`select count(*)::int n from pg_proc where proname='mark_valid_id_reviewed'`)
  assert.equal(rpc.rows[0].n, 0, 'rpc dropped')

  const idx = await db.query(`select count(*)::int n from pg_indexes
    where indexname='profiles_valid_id_needs_check'`)
  assert.equal(idx.rows[0].n, 0, 'index dropped')
  await db.close()
})

test('profiles is still writable after the rollback, and the old rules still bite', { skip }, async () => {
  const db = await base()
  await applyMigration(db)
  await db.exec(rollbackSql())

  // The point of restoring the function first: updates still work.
  await db.exec(`update profiles set address_line = 'after rollback' where id = '${RES}';`)
  const r = await db.query(`select address_line from profiles where id = '${RES}'`)
  assert.equal(r.rows[0].address_line, 'after rollback')

  // And the original guard is enforcing again.
  await db.exec(`set request.jwt.claims = '${RES}';`)
  let blocked = false
  try {
    await db.exec(`update profiles set status = 'pending' where id = '${RES}';`)
  } catch (e) {
    blocked = /Only barangay staff may change role, status or resident ID/.test(e.message)
  }
  assert.ok(blocked, 'restored guard still refuses a status change')
  await db.close()
})

test('dropping the columns FIRST would break profiles — why the order matters', { skip }, async () => {
  const db = await base()
  await applyMigration(db)

  // The wrong order, deliberately.
  await db.exec(`alter table profiles
    drop column valid_id_replaced_at, drop column valid_id_reviewed_at;`)

  let broke = false
  try {
    await db.exec(`update profiles set address_line = 'x' where id = '${RES}';`)
  } catch {
    broke = true
  }
  assert.ok(broke, 'every update fails if the columns go before the function is restored')
  await db.close()
})
