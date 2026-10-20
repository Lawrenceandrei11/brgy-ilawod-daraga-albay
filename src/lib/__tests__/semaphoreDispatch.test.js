/**
 * The Semaphore dispatcher's decisions, run against the real module.
 *
 * This imports supabase/functions/sms-dispatch/semaphore.ts directly. Node 24
 * strips the types, so these are not tests of a copy of the logic -- they are
 * tests of the file that gets deployed. That matters: the dispatcher used to
 * be one file that imported `createClient` from an https URL and called
 * Deno.serve, so Node could not load any of it and none of it was covered. A
 * backslash stripped out of a regex reached a deployed function that way once.
 *
 * What is NOT covered here, honestly: the claim loop, the Supabase writes and
 * the fetch itself all live in index.ts and still cannot be imported by Node.
 * The redirect's *choice* of destination is one line in index.ts; what is
 * tested here is the normalisation that line depends on, plus a source
 * assertion that the line still reads the way it should. The queue, pacing,
 * cap and the two notification gates are Postgres behaviour and are covered
 * by the .pg.test.js files.
 *
 * Every number below is invented, in the 0999 test range where possible.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  backoffFor,
  BACKOFF_SECONDS,
  buildSemaphoreForm,
  classifySemaphore,
  classifyTransportError,
  MAX_ATTEMPTS,
  REQUEST_TIMEOUT_MS,
  resolveProvider,
  SEMAPHORE_URL,
  shapeSemaphoreResponse,
  toE164,
  toSemaphoreNumber,
} from '../../../supabase/functions/sms-dispatch/semaphore.ts'

const DISPATCH_SRC = 'supabase/functions/sms-dispatch/index.ts'
const SEMAPHORE_SRC = 'supabase/functions/sms-dispatch/semaphore.ts'
const DIAGNOSE_SRC = 'supabase/functions/sms-diagnose/index.ts'

// ---------------------------------------------------------------------------
// Provider configuration
// ---------------------------------------------------------------------------

test('P1 semaphore is accepted, in any casing or padding', () => {
  for (const value of ['semaphore', 'Semaphore', 'SEMAPHORE', '  semaphore  ']) {
    const got = resolveProvider(value)
    assert.equal(got.ok, true, `${JSON.stringify(value)} should be accepted`)
    assert.equal(got.provider, 'semaphore')
  }
})

test('P2 an unset or empty provider is semaphore, the documented default', () => {
  for (const value of [undefined, null, '', '   ']) {
    const got = resolveProvider(value)
    assert.equal(got.ok, true, `${JSON.stringify(value)} should fall back`)
    assert.equal(got.provider, 'semaphore')
  }
})

test('P3 THE POINT: httpsms is REFUSED, not silently rerouted', () => {
  const got = resolveProvider('httpsms')
  assert.equal(got.ok, false)
  // The old code mapped this to a real send path; the one before that mapped
  // anything unrecognised to semaphore. Either way a stale rollback attempt
  // would have sent. Now it stops, and says why.
  assert.match(got.error, /httpsms/)
  assert.match(got.error, /no longer supports|only provider/i)
})

test('P4 any other value is refused rather than assumed', () => {
  for (const value of ['twilio', 'smsapiph', 'semaphore2', 'sem aphore', 'true', '1']) {
    const got = resolveProvider(value)
    assert.equal(got.ok, false, `${JSON.stringify(value)} must not be accepted`)
    assert.match(got.error, /only provider/i)
  }
})

test('P5 a refusal echoes the bad value only as short printable text', () => {
  const got = resolveProvider('x'.repeat(200) + '\u0000\u001b')
  assert.equal(got.ok, false)
  // No control characters, and bounded: this string comes from a settings row
  // and ends up in an error response and the logs.
  assert.doesNotMatch(got.error, /[\u0000-\u001f]/)
  assert.ok(got.error.length < 200, `error was ${got.error.length} chars`)
})

// ---------------------------------------------------------------------------
// Sender name
// ---------------------------------------------------------------------------

test('S1 the sender name is sent when configured', () => {
  const form = buildSemaphoreForm('KEY', '+639991234567', 'hello', 'BRGYILAWOD')
  assert.equal(form.get('sendername'), 'BRGYILAWOD')
  assert.equal(form.get('message'), 'hello')
  assert.equal(form.get('apikey'), 'KEY')
})

test('S2 no sender name is sent when none is configured', () => {
  const form = buildSemaphoreForm('KEY', '+639991234567', 'hello', '')
  assert.equal(form.has('sendername'), false)
})

test('S3 the sender name is NOT hardcoded anywhere in the function', () => {
  const dispatch = readFileSync(DISPATCH_SRC, 'utf8')
  const semaphore = readFileSync(SEMAPHORE_SRC, 'utf8')
  // It may be named in prose, but must never be a string literal the code
  // sends: it has to come from sms_semaphore_sendername.
  for (const [name, src] of [['index.ts', dispatch], ['semaphore.ts', semaphore]]) {
    for (const line of src.split('\n')) {
      const code = line.replace(/\s+/g, ' ').trim()
      if (code.startsWith('*') || code.startsWith('//')) continue
      assert.doesNotMatch(
        code,
        /['"`]BRGYILAWOD['"`]/,
        `${name} has BRGYILAWOD as a code literal: ${code}`,
      )
    }
  }
  assert.match(dispatch, /sms_semaphore_sendername/)
})

// ---------------------------------------------------------------------------
// The number sent to Semaphore, and the redirect it depends on
// ---------------------------------------------------------------------------

test('N1 Semaphore gets the number without a leading plus', () => {
  assert.equal(toSemaphoreNumber('+639991234567'), '639991234567')
  assert.equal(toSemaphoreNumber('639991234567'), '639991234567')
})

test('N2 every form a human types for the test recipient normalises the same', () => {
  const expected = '+639991234567'
  for (const typed of [
    '09991234567',
    '9991234567',
    '639991234567',
    '+639991234567',
    '00639991234567',
    '0999 123 4567',
    '0999-123-4567',
  ]) {
    assert.equal(toE164(typed), expected, `${typed} should normalise to ${expected}`)
  }
})

test('N3 a number that is not a PH mobile does not normalise', () => {
  // The dispatcher refuses outright on null rather than falling back to the
  // real recipient, which is the whole safety property of the redirect.
  for (const bad of ['', '12345', '0812345678', '080012345678', 'not a number', '0999123456']) {
    assert.equal(toE164(bad), null, `${bad} must not normalise`)
  }
})

test('N4 the redirect still overrides the real recipient, and fails closed', () => {
  const src = readFileSync(DISPATCH_SRC, 'utf8')
  // The one line that protects residents during a test.
  assert.match(src, /const destination = testRecipient \?\? row\.recipient/)
  // And a test recipient that cannot be parsed must refuse, never fall through.
  assert.match(src, /if \(rawTestRecipient && !testRecipient\)/)
  assert.match(src, /not a valid Philippine mobile number/)
})

// ---------------------------------------------------------------------------
// message_id capture
// ---------------------------------------------------------------------------

test('M1 the message id and status are lifted out of the reply', () => {
  const body = [{ message_id: 283019537, status: 'Pending', sender_name: 'BRGYILAWOD', network: 'Smart' }]
  const shaped = shapeSemaphoreResponse(200, body, '99')
  assert.equal(shaped.provider, 'semaphore')
  assert.equal(shaped.http_status, 200)
  assert.equal(shaped.message_id, 283019537)
  assert.equal(shaped.semaphore_status, 'Pending')
  assert.equal(shaped.rate_limit_remaining, '99')
  // The whole reply is kept, so network and sender_name stay auditable.
  assert.deepEqual(shaped.body, body)
})

test('M2 a reply with no message id records a null id, not a guess', () => {
  const shaped = shapeSemaphoreResponse(200, [{ status: 'Pending' }], null)
  assert.equal(shaped.message_id, null)
})

test('M3 the api key is never part of what gets stored', () => {
  const shaped = shapeSemaphoreResponse(200, [{ message_id: 1 }], null)
  assert.doesNotMatch(JSON.stringify(shaped), /apikey/i)
})

// ---------------------------------------------------------------------------
// What is worth retrying
// ---------------------------------------------------------------------------

test('C1 a 2xx with a message id is sent', () => {
  const got = classifySemaphore(200, [{ message_id: 283019537, status: 'Pending' }], null)
  assert.equal(got.kind, 'sent')
})

test('C2 a 2xx WITHOUT a message id is failed, never sent', () => {
  // Semaphore answers validation errors inside a 200. Nothing reached the
  // network, so logging it as sent would be a lie in the audit log.
  const got = classifySemaphore(200, { senderName: ['The senderName supplied is not valid'] }, null)
  assert.equal(got.kind, 'failed')
  assert.match(got.error, /did not accept/)
})

test('C3 Failed and Refunded inside a 2xx are failures', () => {
  for (const status of ['Failed', 'Refunded']) {
    const got = classifySemaphore(200, [{ message_id: 1, status }], null)
    assert.equal(got.kind, 'failed', `${status} should be a failure`)
    assert.match(got.error, new RegExp(status))
  }
})

test('C4 Queued, Pending and Sent all count as accepted', () => {
  for (const status of ['Queued', 'Pending', 'Sent']) {
    assert.equal(classifySemaphore(200, [{ message_id: 1, status }], null).kind, 'sent')
  }
})

test('C5 a rejected key fails and names the secret, never its value', () => {
  for (const code of [401, 403]) {
    const got = classifySemaphore(code, { error: 'nope' }, null)
    assert.equal(got.kind, 'failed')
    assert.match(got.error, /SMS_API_KEY/)
  }
})

test('C6 THE EXPENSIVE ONE: a 500 naming senderName fails fast, it does not retry', () => {
  // This is the real refusal from 2026-09-29, eighteen times over. Retrying it
  // six times would have cost six credits to fail six identical ways.
  const body = [{ senderName: 'The senderName supplied is not valid' }]
  const got = classifySemaphore(500, body, null)
  assert.equal(got.kind, 'failed')
  assert.match(got.error, /senderName supplied is not valid/)
})

test('C7 a bare 5xx is retried, because waiting in a queue is free', () => {
  const got = classifySemaphore(502, { message: 'Bad gateway' }, null)
  assert.equal(got.kind, 'retry')
})

test('C8 a 429 is retried and honours Retry-After when it is a number', () => {
  const withHeader = classifySemaphore(429, {}, '90')
  assert.equal(withHeader.kind, 'retry')
  assert.equal(withHeader.afterSeconds, 90)

  const garbage = classifySemaphore(429, {}, 'later')
  assert.equal(garbage.kind, 'retry')
  assert.equal(garbage.afterSeconds, undefined)
})

test('C9 any other 4xx fails rather than spending another credit', () => {
  for (const code of [400, 402, 404, 422]) {
    assert.equal(classifySemaphore(code, { error: 'no' }, null).kind, 'failed')
  }
})

test('C10 a timeout is retried and says how long it waited', () => {
  const got = classifyTransportError('The signal has been aborted')
  assert.equal(got.kind, 'retry')
  assert.match(got.error, new RegExp(String(REQUEST_TIMEOUT_MS / 1000)))

  const other = classifyTransportError('dns failure')
  assert.equal(other.kind, 'retry')
  assert.equal(other.error, 'dns failure')
})

test('C11 backoff climbs and then holds at the last step', () => {
  assert.equal(backoffFor(1), BACKOFF_SECONDS[0])
  assert.equal(backoffFor(2), BACKOFF_SECONDS[1])
  assert.equal(backoffFor(BACKOFF_SECONDS.length), BACKOFF_SECONDS.at(-1))
  // Past the end, and defensively below the start.
  assert.equal(backoffFor(99), BACKOFF_SECONDS.at(-1))
  assert.equal(backoffFor(0), BACKOFF_SECONDS[0])
  assert.equal(MAX_ATTEMPTS, BACKOFF_SECONDS.length)
})

// ---------------------------------------------------------------------------
// No httpSMS path survives
// ---------------------------------------------------------------------------

test('X1 there is no executable httpSMS send path left', () => {
  for (const file of [DISPATCH_SRC, SEMAPHORE_SRC, DIAGNOSE_SRC]) {
    const src = readFileSync(file, 'utf8')
    assert.doesNotMatch(src, /api\.httpsms\.com/, `${file} still reaches httpSMS`)
    assert.doesNotMatch(src, /HTTPSMS_API_KEY/, `${file} still reads the httpSMS key`)
    assert.doesNotMatch(src, /httpsms_from/, `${file} still reads httpsms_from`)
    assert.doesNotMatch(src, /sendViaHttpSms|classifyHttpSms/, `${file} still has httpSMS functions`)
  }
})

test('X2 Semaphore is the only provider endpoint the dispatcher knows', () => {
  const src = readFileSync(DISPATCH_SRC, 'utf8') + readFileSync(SEMAPHORE_SRC, 'utf8')
  const hosts = [...src.matchAll(/https:\/\/([a-z0-9.-]+)/g)].map((m) => m[1])
  const providerHosts = hosts.filter((h) => !h.includes('esm.sh') && !h.includes('deno.land'))
  assert.deepEqual([...new Set(providerHosts)], ['api.semaphore.co'])
  assert.equal(SEMAPHORE_URL, 'https://api.semaphore.co/api/v4/messages')
})

test('X3 the dispatcher reads exactly one provider key, Semaphore\'s', () => {
  const src = readFileSync(DISPATCH_SRC, 'utf8')
  const keys = [...src.matchAll(/Deno\.env\.get\('([A-Z_]+)'\)/g)].map((m) => m[1])
  assert.deepEqual(
    [...new Set(keys)].sort(),
    ['SMS_API_KEY', 'SMS_DISPATCH_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL'],
  )
})

test('X4 sms-diagnose can only GET, so it can never send', () => {
  const src = readFileSync(DIAGNOSE_SRC, 'utf8')
  const methods = [...src.matchAll(/method: '([A-Z]+)'/g)].map((m) => m[1])
  assert.deepEqual([...new Set(methods)], ['GET'])
  // And it looks up Semaphore now, not a provider the system no longer uses.
  assert.match(src, /api\.semaphore\.co/)
})

test('X5 sms-diagnose does not echo the account email or a full number', () => {
  const src = readFileSync(DIAGNOSE_SRC, 'utf8')
  // Semaphore's reply carries the account owner's email in `user`; the
  // summariser must not pass it through.
  const summary = src.slice(src.indexOf('function summarise'), src.indexOf('function asList'))
  assert.doesNotMatch(summary, /m\.user\b/)
  assert.match(summary, /recipient_masked/)
  assert.doesNotMatch(summary, /recipient: m\.recipient/)
})
