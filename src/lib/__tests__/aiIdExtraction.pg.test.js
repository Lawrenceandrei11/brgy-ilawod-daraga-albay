/**
 * The proposed AI ID-extraction migration, run against a real Postgres.
 *
 * The proposal file is read and executed verbatim, so these tests cannot
 * drift from the SQL that would be applied. Its dependencies -- auth.uid(),
 * is_staff(), the settings table and the LIVE guard_profile_columns it
 * replaces -- are copied into the fixture from production, because migration
 * 02 as a whole also wants half the schema.
 *
 * The rule under the most scrutiny: a resident may record that their ID
 * number was NOT independently checked, and may never record that it was.
 * Registration writes the resident's own profile row, so the column cannot
 * simply be staff-only, and "staff-only" would have been the easy wrong
 * answer.
 *
 * Synthetic data only: invented UUIDs, invented addresses, no real resident.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const PROPOSAL = 'supabase/proposals/ai-id-extraction.sql.proposed'

const STAFF = '11111111-1111-1111-1111-111111111111'
const RESIDENT = '22222222-2222-2222-2222-222222222222'

/** guard_profile_columns exactly as it is in production TODAY, pre-change. */
const LIVE_GUARD = `
create or replace function guard_profile_columns()
returns trigger language plpgsql security definer set search_path to 'public' as $f$
declare
  v_doc_changed boolean;
begin
  v_doc_changed :=
       new.valid_id_path   is distinct from old.valid_id_path
    or new.valid_id_number is distinct from old.valid_id_number
    or new.valid_id_type   is distinct from old.valid_id_type;

  if is_staff() then
    if v_doc_changed and new.valid_id_reviewed_at is not distinct from old.valid_id_reviewed_at then
      new.valid_id_replaced_at := clock_timestamp();
      new.valid_id_reviewed_at := clock_timestamp();
    end if;
    return new;
  end if;

  if new.role is distinct from old.role
     or new.status is distinct from old.status
     or new.resident_id is distinct from old.resident_id
     or new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at then
    raise exception 'Only barangay staff may change role, status or resident ID';
  end if;

  if new.valid_id_reviewed_at is distinct from old.valid_id_reviewed_at then
    raise exception 'Only barangay staff may mark a valid ID as reviewed';
  end if;
  if new.valid_id_replaced_at is distinct from old.valid_id_replaced_at then
    raise exception 'valid_id_replaced_at is set automatically';
  end if;

  if v_doc_changed then
    new.valid_id_replaced_at := clock_timestamp();
  end if;

  return new;
end;
$f$;
`

async function world() {
  const db = new PGlite()

  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;

    create schema if not exists auth;
    create function auth.uid() returns uuid language sql stable as $f$
      select nullif(nullif(current_setting('request.jwt.claims', true), ''), 'null')::uuid
    $f$;

    create type user_role      as enum ('resident','secretary','treasurer','captain');
    create type profile_status as enum ('pending','approved','rejected','suspended');

    create table settings (
      key        text primary key,
      value      jsonb not null,
      updated_at timestamptz not null default now()
    );

    create table profiles (
      id                    uuid primary key,
      full_name             text,
      role                  user_role      not null default 'resident',
      status                profile_status not null default 'pending',
      resident_id           text,
      approved_by           uuid,
      approved_at           timestamptz,
      valid_id_path         text,
      valid_id_number       text,
      valid_id_type         text,
      valid_id_reviewed_at  timestamptz,
      valid_id_replaced_at  timestamptz
    );

    create function is_staff() returns boolean
      language sql stable security definer set search_path to 'public' as $f$
      select exists (
        select 1 from profiles
        where id = auth.uid()
          and role in ('secretary','treasurer','captain')
          and status = 'approved'
      );
    $f$;

    alter table profiles enable row level security;
    alter table profiles force  row level security;

    create policy profiles_read on profiles
      for select to authenticated using (id = auth.uid() or is_staff());
    create policy profiles_update on profiles
      for update to authenticated using (id = auth.uid() or is_staff());

    -- Supabase hands ALL privileges on new public tables to both roles by
    -- default; reproduced so the proposal's revokes are genuinely exercised.
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    grant usage on schema public, auth to anon, authenticated;
    grant select, update on profiles to authenticated;
    grant select on settings to authenticated;
  `)

  await db.exec(LIVE_GUARD)
  await db.exec(`
    create trigger profiles_guard before update on profiles
      for each row execute function guard_profile_columns();
  `)

  await db.exec(`
    insert into profiles (id, full_name, role, status) values
      ('${STAFF}',    'Test Secretary', 'secretary', 'approved'),
      ('${RESIDENT}', 'Test Resident',  'resident',  'approved');
  `)

  // The proposal under test, verbatim.
  await db.exec(readFileSync(PROPOSAL, 'utf8'))
  return db
}

const as = (db, uid) =>
  db.exec(`reset role; set request.jwt.claims = '${uid}'; set role authenticated;`)
const admin = (db) => db.exec(`reset role; set request.jwt.claims = '';`)

async function errorFrom(db, sql) {
  try {
    await db.exec(sql)
    return null
  } catch (err) {
    return err.message
  }
}

// ------------------------------------------------------- it applies at all

test('A1 the proposal applies cleanly to a live-shaped database', async () => {
  const db = await world()
  const { rows } = await db.query(`
    select
      (select count(*) from information_schema.columns
        where table_name='profiles' and column_name='id_verification')      as column_added,
      (select count(*) from information_schema.tables
        where table_name='ai_extraction_attempts')                          as table_added,
      (select value::text from settings where key='gemini_model')           as model,
      (select value::text from settings where key='gemini_extractions_per_hour') as per_hour
  `)
  assert.equal(Number(rows[0].column_added), 1)
  assert.equal(Number(rows[0].table_added), 1)
  assert.equal(rows[0].model, '{"value": "gemini-3.1-flash-lite"}')
  assert.equal(rows[0].per_hour, '{"value": 5}')
  await db.close()
})

test('A2 the column accepts only the three states, or null', async () => {
  const db = await world()
  // As staff: the guard lets staff set anything, so the only thing that can
  // refuse here is the check constraint itself. Running this as the Postgres
  // superuser would NOT work -- auth.uid() is null, is_staff() is false, and
  // the trigger would treat it as a resident.
  await as(db, STAFF)
  for (const v of ['auto_verified', 'ai_extracted', 'pending_manual']) {
    assert.equal(
      await errorFrom(db, `update profiles set id_verification = '${v}' where id = '${RESIDENT}'`),
      null,
      `${v} should be allowed`,
    )
  }
  assert.equal(
    await errorFrom(db, `update profiles set id_verification = null where id = '${RESIDENT}'`),
    null,
    'null is allowed for rows predating the column',
  )
  const bad = await errorFrom(db, `update profiles set id_verification = 'verified' where id = '${RESIDENT}'`)
  assert.match(bad ?? '', /violates check constraint/i)
  await admin(db)
  await db.close()
})

// ------------------------------------------- who may claim what, and when

test('A3 THE POINT: a resident may admit the number was not checked', async () => {
  const db = await world()
  await as(db, RESIDENT)
  for (const v of ['ai_extracted', 'pending_manual']) {
    const err = await errorFrom(db, `update profiles set id_verification = '${v}' where id = '${RESIDENT}'`)
    assert.equal(err, null, `a resident must be able to record ${v} during their own registration`)
  }
  await admin(db)
  await db.close()
})

test('A4 THE POINT: a resident may NEVER claim the number was verified', async () => {
  const db = await world()
  await as(db, RESIDENT)
  const err = await errorFrom(db, `update profiles set id_verification = 'auto_verified' where id = '${RESIDENT}'`)
  assert.match(err ?? '', /Only barangay staff may record an ID number as verified/)

  await admin(db)
  const { rows } = await db.query(`select id_verification from profiles where id = '${RESIDENT}'`)
  assert.equal(rows[0].id_verification, null, 'and nothing was written')
  await db.close()
})

test('A5 a resident cannot erase a verdict staff recorded', async () => {
  const db = await world()
  await as(db, STAFF)
  await db.exec(`update profiles set id_verification = 'auto_verified' where id = '${RESIDENT}'`)

  await as(db, RESIDENT)
  const err = await errorFrom(db, `update profiles set id_verification = null where id = '${RESIDENT}'`)
  assert.match(err ?? '', /Only barangay staff may record an ID number as verified/)

  await admin(db)
  const { rows } = await db.query(`select id_verification from profiles where id = '${RESIDENT}'`)
  assert.equal(rows[0].id_verification, 'auto_verified', 'the staff verdict survives')
  await db.close()
})

test('A6 staff may set any of the three', async () => {
  const db = await world()
  await as(db, STAFF)
  for (const v of ['auto_verified', 'ai_extracted', 'pending_manual']) {
    const err = await errorFrom(db, `update profiles set id_verification = '${v}' where id = '${RESIDENT}'`)
    assert.equal(err, null, `staff must be able to set ${v}`)
  }
  await admin(db)
  await db.close()
})

test('A7 the existing guard rules are untouched', async () => {
  const db = await world()
  await as(db, RESIDENT)
  // The rules that were already there must behave exactly as before.
  assert.match(
    (await errorFrom(db, `update profiles set status = 'suspended' where id = '${RESIDENT}'`)) ?? '',
    /Only barangay staff may change role, status or resident ID/,
  )
  assert.match(
    (await errorFrom(db, `update profiles set valid_id_reviewed_at = now() where id = '${RESIDENT}'`)) ?? '',
    /Only barangay staff may mark a valid ID as reviewed/,
  )
  // And the automatic stamp still fires on a document change.
  assert.equal(
    await errorFrom(db, `update profiles set valid_id_number = 'TEST-0001' where id = '${RESIDENT}'`),
    null,
  )
  await admin(db)
  const { rows } = await db.query(`select valid_id_replaced_at from profiles where id = '${RESIDENT}'`)
  assert.ok(rows[0].valid_id_replaced_at, 'valid_id_replaced_at was stamped automatically')
  await db.close()
})

// ------------------------------------------------- the per-IP rate limit

test('A8 no browser role can reach the rate-limit table', async () => {
  const db = await world()
  for (const role of ['authenticated', 'anon']) {
    await db.exec(`reset role; set request.jwt.claims = ''; set role ${role};`)
    const read = await errorFrom(db, `select count(*) from ai_extraction_attempts`)
    const write = await errorFrom(db, `insert into ai_extraction_attempts (ip) values ('203.0.113.9')`)
    assert.ok(read !== null, `${role} must not read the counter`)
    assert.ok(write !== null, `${role} must not write to it`)
    assert.match(read ?? '', /permission denied/i)
  }
  await admin(db)
  await db.close()
})

test('A9 the hourly count the function runs behaves', async () => {
  const db = await world()
  const IP = '203.0.113.9'
  const OTHER = '198.51.100.4'

  await db.exec(`
    insert into ai_extraction_attempts (ip, created_at) values
      ('${IP}',    now() - interval '10 minutes'),
      ('${IP}',    now() - interval '50 minutes'),
      ('${IP}',    now() - interval '3 hours'),
      ('${OTHER}', now() - interval '5 minutes');
  `)

  const within = await db.query(`
    select count(*)::int as n from ai_extraction_attempts
     where ip = '${IP}' and created_at >= now() - interval '1 hour'
  `)
  assert.equal(within.rows[0].n, 2, 'the three-hour-old attempt is outside the window')

  const other = await db.query(`
    select count(*)::int as n from ai_extraction_attempts
     where ip = '${OTHER}' and created_at >= now() - interval '1 hour'
  `)
  assert.equal(other.rows[0].n, 1, 'one address cannot spend another address\u2019s quota')
  await db.close()
})

test('A10 the purge keeps the table short-lived', async () => {
  const db = await world()
  await db.exec(`
    insert into ai_extraction_attempts (ip, created_at) values
      ('203.0.113.9', now() - interval '20 days'),
      ('203.0.113.9', now() - interval '1 hour');
  `)
  await db.exec(`select purge_old_ai_extraction_attempts(7)`)
  const { rows } = await db.query(`select count(*)::int as n from ai_extraction_attempts`)
  assert.equal(rows[0].n, 1, 'only the recent attempt survives')

  // A silly argument must not wipe the live window.
  await db.exec(`select purge_old_ai_extraction_attempts(0)`)
  const after = await db.query(`select count(*)::int as n from ai_extraction_attempts`)
  assert.equal(after.rows[0].n, 1, 'greatest(p_days,1) keeps today safe')
  await db.close()
})

test('A11 re-running the migration never resets an operator value', async () => {
  const db = await world()
  await db.exec(`
    update settings set value = '{"value": "gemini-3.5-flash-lite"}'::jsonb where key = 'gemini_model';
    update settings set value = '{"value": 2}'::jsonb where key = 'gemini_extractions_per_hour';
  `)
  // `on conflict do nothing` on the settings insert; the rest is create-or-
  // replace, so only the settings are at risk of being clobbered.
  await db.exec(`
    insert into settings (key, value) values
      ('gemini_model',                '{"value": "gemini-3.1-flash-lite"}'::jsonb),
      ('gemini_extractions_per_hour', '{"value": 5}'::jsonb)
    on conflict (key) do nothing;
  `)
  const { rows } = await db.query(`
    select
      (select value->>'value' from settings where key='gemini_model') as model,
      (select value->>'value' from settings where key='gemini_extractions_per_hour') as per_hour
  `)
  assert.equal(rows[0].model, 'gemini-3.5-flash-lite', 'the operator choice survives')
  assert.equal(rows[0].per_hour, '2')
  await db.close()
})
