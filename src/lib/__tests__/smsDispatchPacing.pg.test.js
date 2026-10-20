/**
 * claim_sms: the daily cap and the pacing gates, against a real Postgres.
 *
 * These are the parts of dispatch that are NOT in the Edge Function, and that
 * is deliberate -- pacing has to survive two invocations overlapping and a
 * dispatcher dying mid-flight, which only the database can guarantee. So this
 * is where they have to be tested.
 *
 * It matters more now than it did. With httpSMS removed there is one provider
 * and every send costs a Semaphore credit, so a pacing gate that leaks is a
 * gate that spends the barangay's money. The cap is also the documented
 * dispatch-level stop: `sms_enabled` is a QUEUE-time gate and does nothing
 * about rows already queued, whereas `sms_daily_cap = 0` holds the queue. D11
 * is that claim.
 *
 * claim_sms is read out of the migration and executed verbatim, so these
 * tests cannot drift from the SQL that is actually applied.
 *
 * Synthetic data only: invented UUIDs and invented numbers in the 0999 test
 * range. Nothing is sent; there is no network in PGlite.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const MIGRATION = 'supabase/migrations/20260905090000_16_sms_notifications.sql'
const RESIDENT = '22222222-2222-2222-2222-222222222222'

/**
 * Pull one function definition out of the migration rather than copying it.
 * The body is dollar-quoted with $$, so the definition ends at the first
 * "$$;" after the header.
 */
function functionFromMigration(name) {
  const sql = readFileSync(MIGRATION, 'utf8')
  const start = sql.indexOf(`create or replace function ${name}`)
  assert.notEqual(start, -1, `${name} not found in ${MIGRATION}`)
  const end = sql.indexOf('$$;', start)
  assert.notEqual(end, -1, `unterminated body for ${name}`)
  return sql.slice(start, end + 3)
}

async function world() {
  const db = new PGlite()

  await db.exec(`
    create type sms_status as enum ('queued','sending','sent','failed','skipped');

    create table settings (
      key   text primary key,
      value jsonb not null
    );

    -- The columns claim_sms reads, sets, or returns via "select *".
    create table sms_messages (
      id                uuid primary key default gen_random_uuid(),
      profile_id        uuid,
      recipient         text,
      sent_to           text,
      body              text not null,
      kind              text not null,
      request_id        uuid,
      announcement_id   uuid,
      priority          smallint not null default 5,
      status            sms_status not null default 'queued',
      skip_reason       text,
      attempts          int not null default 0,
      last_error        text,
      provider_response jsonb,
      next_attempt_at   timestamptz not null default now(),
      claimed_at        timestamptz,
      sent_at           timestamptz,
      created_at        timestamptz not null default now()
    );

    create or replace function sms_setting(p_key text, p_default text)
    returns text language sql stable set search_path to 'public' as $f$
      select coalesce((select value ->> 'value' from settings where key = p_key), p_default);
    $f$;
  `)

  await db.exec(functionFromMigration('claim_sms'))
  return db
}

const setSetting = (db, key, json) =>
  db.exec(`insert into settings (key, value) values ('${key}', '${json}'::jsonb)
           on conflict (key) do update set value = excluded.value;`)

/**
 * One queued message. `age` backdates created_at/next_attempt_at so ordering
 * is deterministic; `due` controls whether it is due yet.
 */
const addQueued = (db, { priority = 5, dueInSeconds = 0, body = 'test' } = {}) =>
  db.query(
    `insert into sms_messages (profile_id, recipient, body, kind, priority, next_attempt_at)
     values ('${RESIDENT}', '+639990000002', '${body}', 'request_status', ${priority},
             now() + make_interval(secs => ${dueInSeconds}))
     returning id`,
  )

/** A row that has already been sent, `agoHours` ago. Counts against the cap. */
const addSent = (db, agoHours) =>
  db.exec(
    `insert into sms_messages (profile_id, recipient, body, kind, status, sent_at, claimed_at)
     values ('${RESIDENT}', '+639990000002', 'already gone', 'request_status', 'sent',
             now() - make_interval(hours => ${agoHours}),
             now() - make_interval(hours => ${agoHours}))`,
  )

const claim = async (db, staleSeconds = 180) =>
  (await db.query(`select * from claim_sms(${staleSeconds})`)).rows

// ---------------------------------------------------------------- daily cap

test('D1 the cap blocks a claim once the day is spent', async () => {
  const db = await world()
  await setSetting(db, 'sms_daily_cap', '{"value": 1}')
  await setSetting(db, 'sms_min_gap_seconds', '{"value": 0}')
  await addSent(db, 1) // one sent an hour ago
  await addQueued(db)

  assert.equal((await claim(db)).length, 0, 'nothing may be claimed at the cap')
})

test('D2 under the cap, the message is claimed', async () => {
  const db = await world()
  await setSetting(db, 'sms_daily_cap', '{"value": 1}')
  await setSetting(db, 'sms_min_gap_seconds', '{"value": 0}')
  await addQueued(db)

  assert.equal((await claim(db)).length, 1)
})

test('D3 the cap is a rolling 24 hours, not a calendar day', async () => {
  const db = await world()
  await setSetting(db, 'sms_daily_cap', '{"value": 1}')
  await setSetting(db, 'sms_min_gap_seconds', '{"value": 0}')
  await addSent(db, 25) // older than the window
  await addQueued(db)

  assert.equal((await claim(db)).length, 1, 'a send 25h ago must not count')
})

test('D11 THE KILL SWITCH: a cap of 0 holds the queue completely', async () => {
  // This is the documented dispatch-level stop. sms_enabled does NOT stop
  // dispatch -- it only stops queueing -- so this is what holds rows that are
  // already queued. The gate is ">= cap", so 0 sent >= 0 is true immediately.
  const db = await world()
  await setSetting(db, 'sms_daily_cap', '{"value": 0}')
  await setSetting(db, 'sms_min_gap_seconds', '{"value": 0}')
  await addQueued(db)

  assert.equal((await claim(db)).length, 0, 'a cap of 0 must claim nothing at all')
})

// ----------------------------------------------------------------- pacing

test('D4 a message claimed inside the gap blocks the next claim', async () => {
  const db = await world()
  await setSetting(db, 'sms_daily_cap', '{"value": 300}')
  await setSetting(db, 'sms_min_gap_seconds', '{"value": 10}')
  await addQueued(db, { body: 'first' })
  await addQueued(db, { body: 'second' })

  const first = await claim(db)
  assert.equal(first.length, 1)

  // Mark it done so the "never two in flight" gate is not what blocks us;
  // the gap is.
  await db.exec(`update sms_messages set status = 'sent', sent_at = now() where id = '${first[0].id}'`)

  assert.equal((await claim(db)).length, 0, 'the 10s gap must still hold')
})

test('D5 once the gap has passed, the next message is claimed', async () => {
  const db = await world()
  await setSetting(db, 'sms_daily_cap', '{"value": 300}')
  await setSetting(db, 'sms_min_gap_seconds', '{"value": 10}')
  await addQueued(db, { body: 'first' })
  await addQueued(db, { body: 'second' })

  const first = await claim(db)
  await db.exec(`update sms_messages
                    set status = 'sent', sent_at = now(),
                        claimed_at = now() - interval '11 seconds'
                  where id = '${first[0].id}'`)

  assert.equal((await claim(db)).length, 1, 'past the gap it should claim again')
})

test('D6 never two in flight: a sending row blocks everything', async () => {
  const db = await world()
  await setSetting(db, 'sms_daily_cap', '{"value": 300}')
  await setSetting(db, 'sms_min_gap_seconds', '{"value": 0}')
  await addQueued(db)
  await db.exec(
    `insert into sms_messages (profile_id, recipient, body, kind, status, claimed_at)
     values ('${RESIDENT}', '+639990000002', 'in flight', 'request_status', 'sending',
             now() - interval '5 seconds')`,
  )

  assert.equal((await claim(db)).length, 0)
})

test('D7 a stale sending row is rescued, then claimable again', async () => {
  const db = await world()
  await setSetting(db, 'sms_daily_cap', '{"value": 300}')
  await setSetting(db, 'sms_min_gap_seconds', '{"value": 0}')
  // Claimed long ago by a dispatcher that died without reporting.
  await db.exec(
    `insert into sms_messages (profile_id, recipient, body, kind, status, claimed_at, attempts)
     values ('${RESIDENT}', '+639990000002', 'abandoned', 'request_status', 'sending',
             now() - interval '10 minutes', 1)`,
  )

  const rows = await claim(db, 180)
  assert.equal(rows.length, 1, 'the abandoned row should be rescued and reclaimed')
  // Its attempt count keeps climbing, so a poisonous row cannot loop forever.
  assert.equal(rows[0].attempts, 2)
})

// -------------------------------------------------------- what gets claimed

test('D8 claiming marks the row sending, stamps it, and burns an attempt', async () => {
  const db = await world()
  await setSetting(db, 'sms_daily_cap', '{"value": 300}')
  await setSetting(db, 'sms_min_gap_seconds', '{"value": 0}')
  await addQueued(db)

  const rows = await claim(db)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'sending')
  assert.equal(rows[0].attempts, 1, 'counted at claim time, not on success')
  assert.notEqual(rows[0].claimed_at, null)
})

test('D9 priority wins: a status text goes before a broadcast', async () => {
  const db = await world()
  await setSetting(db, 'sms_daily_cap', '{"value": 300}')
  await setSetting(db, 'sms_min_gap_seconds', '{"value": 0}')
  await addQueued(db, { priority: 5, body: 'broadcast' })
  await addQueued(db, { priority: 1, body: 'status' })

  const rows = await claim(db)
  assert.equal(rows[0].body, 'status')
})

test('D10 a message not yet due is left alone', async () => {
  const db = await world()
  await setSetting(db, 'sms_daily_cap', '{"value": 300}')
  await setSetting(db, 'sms_min_gap_seconds', '{"value": 0}')
  await addQueued(db, { dueInSeconds: 600 }) // backing off

  assert.equal((await claim(db)).length, 0)
})

test('D12 the defaults are used when the settings rows are missing', async () => {
  // No settings at all: the cap defaults to 300 and the gap to 10, so a first
  // message still goes out rather than the queue stalling.
  const db = await world()
  await addQueued(db)

  assert.equal((await claim(db)).length, 1)
})
