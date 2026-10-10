/**
 * The second SMS switch, run against a real Postgres.
 *
 * The point of the migration is that two very different blast radii stop
 * sharing one switch: a document request notification goes to the one
 * resident who asked for the document, while a notice broadcast goes to every
 * approved profile at once. These tests exist to prove the two are now
 * independent, and in particular that turning SMS on for document requests
 * does NOT arm broadcasts.
 *
 * The migration file is read and executed verbatim, so these tests cannot
 * drift from the SQL that would be applied. Its dependencies -- sms_setting,
 * queue_sms, is_staff, normalize_ph_mobile, sms_plain -- are copied into the
 * fixture from the live definitions, because migration 16 as a whole also
 * wants pg_cron, the vault and storage, none of which exist here.
 *
 * Synthetic data only: invented UUIDs, invented notices, invented numbers in
 * the 0999 test range. Nothing is sent; there is no network in PGlite.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const MIGRATION = 'supabase/migrations/20261010203541_31_sms_announcement_gate.sql'

const STAFF = '11111111-1111-1111-1111-111111111111'
const RESIDENT = '22222222-2222-2222-2222-222222222222'
const RESIDENT2 = '33333333-3333-3333-3333-333333333333'
const NOTICE = '44444444-4444-4444-4444-444444444444'

/** sms_setting, queue_sms and friends, copied verbatim from production. */
const LIVE_PARTS = `
  create or replace function sms_setting(p_key text, p_default text)
  returns text language sql stable security definer set search_path to 'public' as $f$
    select coalesce((select value ->> 'value' from settings where key = p_key), p_default);
  $f$;

  create or replace function normalize_ph_mobile(p_mobile text)
  returns text language sql immutable set search_path to 'public' as $f$
    select case
      when d ~ '^00639[0-9]{9}$' then '+' || substr(d, 3)
      when d ~ '^639[0-9]{9}$'   then '+' || d
      when d ~ '^09[0-9]{9}$'    then '+63' || substr(d, 2)
      when d ~ '^9[0-9]{9}$'     then '+63' || d
      else null
    end
    from (select regexp_replace(coalesce(p_mobile, ''), '[^0-9]', '', 'g') as d) s;
  $f$;

  create or replace function sms_plain(p_text text)
  returns text language sql immutable set search_path to 'public' as $f$
    select regexp_replace(coalesce(p_text, ''), '[^ -~]', '', 'g');
  $f$;

  create or replace function is_staff() returns boolean
  language sql stable security definer set search_path to 'public' as $f$
    select exists (
      select 1 from profiles
      where id = auth.uid()
        and role in ('secretary','treasurer','captain')
        and status = 'approved'
    );
  $f$;

  create or replace function queue_sms(
    p_profile_id uuid, p_body text, p_kind text,
    p_request_id uuid default null, p_announcement_id uuid default null,
    p_priority smallint default 5
  ) returns uuid language plpgsql security definer set search_path to 'public' as $f$
  declare
    v_profile   profiles%rowtype;
    v_recipient text;
    v_status    sms_status := 'queued';
    v_reason    text;
    v_id        uuid;
  begin
    if p_body is null or btrim(p_body) = '' then
      return null;
    end if;

    if sms_setting('sms_enabled', 'false') <> 'true' then
      return null;
    end if;

    select * into v_profile from profiles where id = p_profile_id;
    if not found then
      return null;
    end if;

    v_recipient := normalize_ph_mobile(v_profile.mobile);

    if v_profile.status <> 'approved' then
      v_status := 'skipped';
      v_reason := 'Resident record is not approved.';
    elsif not v_profile.sms_opt_in then
      v_status := 'skipped';
      v_reason := 'Resident has turned text messages off.';
    elsif v_recipient is null then
      v_status := 'skipped';
      v_reason := 'No usable mobile number on file.';
    end if;

    insert into sms_messages (
      profile_id, recipient, body, kind, request_id, announcement_id,
      priority, status, skip_reason
    )
    values (
      p_profile_id, v_recipient, left(sms_plain(p_body), 160), p_kind,
      p_request_id, p_announcement_id, coalesce(p_priority, 5), v_status, v_reason
    )
    on conflict do nothing
    returning id into v_id;

    return v_id;
  end;
  $f$;
`

/** Enough of the live database for the migration and its callers to run. */
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
    create type sms_status     as enum ('queued','sending','sent','failed','skipped');

    create table settings (
      key        text primary key,
      value      jsonb not null,
      updated_at timestamptz not null default now()
    );

    create table profiles (
      id          uuid primary key,
      full_name   text,
      role        user_role      not null default 'resident',
      status      profile_status not null default 'pending',
      mobile      text,
      sms_opt_in  boolean not null default true,
      created_at  timestamptz not null default now()
    );

    create table announcements (
      id           uuid primary key,
      title        text not null,
      published_at timestamptz
    );

    create table sms_messages (
      id              uuid primary key default gen_random_uuid(),
      profile_id      uuid references profiles(id) on delete set null,
      recipient       text,
      body            text not null,
      kind            text not null,
      request_id      uuid,
      announcement_id uuid references announcements(id) on delete cascade,
      priority        smallint not null default 5,
      status          sms_status not null default 'queued',
      skip_reason     text,
      attempts        int not null default 0,
      next_attempt_at timestamptz not null default now(),
      sent_at         timestamptz,
      created_at      timestamptz not null default now()
    );
  `)

  await db.exec(LIVE_PARTS)

  await db.exec(`
    insert into profiles (id, full_name, role, status, mobile, sms_opt_in) values
      ('${STAFF}',     'Test Secretary', 'secretary', 'approved', '09990000001', true),
      ('${RESIDENT}',  'Test Resident',  'resident',  'approved', '09990000002', true),
      ('${RESIDENT2}', 'Second Person',  'resident',  'approved', '09990000003', true);

    insert into announcements (id, title, published_at)
      values ('${NOTICE}', 'Synthetic test notice', now());

    -- The barangay switch on, as it would be for the document request test.
    insert into settings (key, value) values ('sms_enabled', '{"value": true}'::jsonb);
  `)

  // The migration under test, verbatim.
  await db.exec(readFileSync(MIGRATION, 'utf8'))

  return db
}

const asStaff = (db) =>
  db.exec(`set request.jwt.claims = '${STAFF}';`)

/** Run a statement and return the error message, or null when it succeeded. */
async function errorFrom(db, fn) {
  try {
    await fn()
    return null
  } catch (err) {
    return err.message
  }
}

const setSwitch = (db, key, json) =>
  db.exec(`insert into settings (key, value) values ('${key}', '${json}'::jsonb)
           on conflict (key) do update set value = excluded.value;`)

const broadcast = (db) =>
  db.query(`select queue_announcement_sms('${NOTICE}') as result`)

const docRequestSms = (db) =>
  db.query(`select queue_sms('${RESIDENT}', 'Brgy Ilawod: your clearance is ready.',
                             'request', null, null, 5::smallint) as id`)

const queued = async (db, kind) =>
  Number(
    (await db.query(`select count(*)::int as n from sms_messages where kind = '${kind}'`)).rows[0].n
  )

// ------------------------------------------- the two paths are independent

test('S1 the migration seeds the new switch, off', async () => {
  const db = await world()
  const { rows } = await db.query(
    `select value::text as v from settings where key = 'sms_announcements_enabled'`
  )
  assert.equal(rows.length, 1, 'the setting exists after the migration')
  assert.equal(rows[0].v, '{"value": false}', 'and it ships off')
  await db.close()
})

test('S2 THE POINT: sms_enabled alone queues document requests but NOT broadcasts', async () => {
  const db = await world()
  await asStaff(db)
  // sms_enabled is true; sms_announcements_enabled is false by seed.

  const { rows } = await docRequestSms(db)
  assert.ok(rows[0].id, 'a document request notification is queued')
  assert.equal(await queued(db, 'request'), 1)

  const err = await errorFrom(db, () => broadcast(db))
  assert.match(err ?? '', /Texting notices to residents is switched off/)
  assert.match(err ?? '', /Document request updates are unaffected/)
  assert.equal(await queued(db, 'announcement'), 0, 'not one broadcast message was queued')

  await db.close()
})

test('S3 with both switches on, broadcasts work again', async () => {
  const db = await world()
  await asStaff(db)
  await setSwitch(db, 'sms_announcements_enabled', '{"value": true}')

  const { rows } = await broadcast(db)
  const result = rows[0].result
  assert.equal(result.queued, 3, 'all three approved profiles are texted, staff included')
  assert.equal(await queued(db, 'announcement'), 3)

  // And document requests still work alongside it.
  const doc = await docRequestSms(db)
  assert.ok(doc.rows[0].id)
  await db.close()
})

test('S4 sms_enabled off blocks both, and reports the barangay switch first', async () => {
  const db = await world()
  await asStaff(db)
  await setSwitch(db, 'sms_enabled', '{"value": false}')
  await setSwitch(db, 'sms_announcements_enabled', '{"value": true}')

  const err = await errorFrom(db, () => broadcast(db))
  assert.match(err ?? '', /Text messaging is switched off for the barangay/,
    'the general switch is named, not the announcement one')

  const { rows } = await docRequestSms(db)
  assert.equal(rows[0].id, null, 'queue_sms queues nothing at all')
  assert.equal(await queued(db, 'request'), 0)
  await db.close()
})

// ------------------------------------------------ the default-false cases

test('S5 a MISSING setting row blocks broadcasts', async () => {
  const db = await world()
  await asStaff(db)
  await db.exec(`delete from settings where key = 'sms_announcements_enabled';`)

  const err = await errorFrom(db, () => broadcast(db))
  assert.match(err ?? '', /Texting notices to residents is switched off/)
  assert.equal(await queued(db, 'announcement'), 0)

  // Document requests are untouched by the missing row.
  const { rows } = await docRequestSms(db)
  assert.ok(rows[0].id, 'the document request path does not depend on it')
  await db.close()
})

test('S6 an explicitly null setting blocks broadcasts', async () => {
  // sms_setting is coalesce(value ->> 'value', default), so JSON null falls
  // through to 'false' exactly as a missing row does.
  const db = await world()
  await asStaff(db)
  await setSwitch(db, 'sms_announcements_enabled', '{"value": null}')

  const err = await errorFrom(db, () => broadcast(db))
  assert.match(err ?? '', /Texting notices to residents is switched off/)
  await db.close()
})

test('S7 nothing but exactly true opens the gate', async () => {
  const db = await world()
  await asStaff(db)

  for (const value of ['{"value": false}', '{"value": "yes"}', '{"value": 1}', '{"value": "TRUE"}', '{}']) {
    await setSwitch(db, 'sms_announcements_enabled', value)
    const err = await errorFrom(db, () => broadcast(db))
    assert.match(err ?? '', /switched off/, `${value} must not open the gate`)
  }
  assert.equal(await queued(db, 'announcement'), 0)

  // The JSON string "true" is accepted as well as the boolean, because
  // ->> renders both as 'true'. Worth knowing rather than discovering.
  await setSwitch(db, 'sms_announcements_enabled', '{"value": "true"}')
  assert.equal(await errorFrom(db, () => broadcast(db)), null)
  await db.close()
})

test('S8 re-running the migration never switches broadcasts on', async () => {
  // `on conflict do nothing`: an operator who had already turned broadcasts on
  // keeps that, and one who had them off does not get them flipped.
  const db = await world()
  await setSwitch(db, 'sms_announcements_enabled', '{"value": true}')
  await db.exec(readFileSync(MIGRATION, 'utf8'))

  const { rows } = await db.query(
    `select value::text as v from settings where key = 'sms_announcements_enabled'`
  )
  assert.equal(rows[0].v, '{"value": true}', 'the operator value survives a re-run')
  await db.close()
})

test('S9 the other guards are unchanged', async () => {
  const db = await world()
  await setSwitch(db, 'sms_announcements_enabled', '{"value": true}')

  // Not staff.
  await db.exec(`set request.jwt.claims = '${RESIDENT}';`)
  assert.match((await errorFrom(db, () => broadcast(db))) ?? '', /Only barangay staff/)

  // Unpublished notice.
  await asStaff(db)
  await db.exec(`update announcements set published_at = null where id = '${NOTICE}';`)
  assert.match((await errorFrom(db, () => broadcast(db))) ?? '', /Publish the notice/)

  assert.equal(await queued(db, 'announcement'), 0)
  await db.close()
})
