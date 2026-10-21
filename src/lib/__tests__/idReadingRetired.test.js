/**
 * ID reading is manual. Nothing goes to Gemini, or to anyone else.
 *
 * Barangay E-Assist used to send a downscaled photograph of a resident's
 * government ID to Google's Gemini API. It no longer does, by any provider.
 * The reason was not cost or accuracy: the key was on an unpaid tier, and
 * Google's terms for unpaid use say submitted content is used to improve
 * their products, may be read by human reviewers, and should not include
 * personal information. A government ID is exactly that.
 *
 * These tests are what stops it coming back by accident. They assert absence,
 * which is unusual but is the whole point: the safest ID-reading integration
 * is the one that is not there.
 *
 * What is still tested elsewhere, and deliberately kept:
 *   idCheck.test.js            the mismatch rule and provenance states
 *   aiIdExtraction.pg.test.js  profiles.id_verification, its constraint, the
 *                              guard against self-verification, and the
 *                              retention objects -- all preserved schema
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { idVerdict } from '../idCheck.js'

const REGISTER = 'src/pages/auth/Register.jsx'
const ENDPOINT = 'supabase/functions/id-extract/index.ts'

/** Every .js/.jsx under src/, so "nowhere in the app" means nowhere. */
function appFiles(dir = 'src', found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) appFiles(p, found)
    else if (/\.(js|jsx)$/.test(entry.name)) found.push(p)
  }
  return found
}

// ------------------------------------------------- the client sends nothing

test('R1 THE POINT: no file in the app reaches Gemini', () => {
  const offenders = []
  for (const f of appFiles()) {
    if (f.includes('__tests__')) continue
    const src = readFileSync(f, 'utf8')
    if (/generativelanguage\.googleapis|GEMINI_URL|GEMINI_API_KEY/.test(src)) offenders.push(f)
  }
  assert.deepEqual(offenders, [], 'these still reference Gemini')
})

test('R2 nothing invokes the id-extract endpoint any more', () => {
  // Narrowly the retired endpoint. `functions.invoke` itself is fine and is
  // still used by face-login and admin-create-user, which are unrelated.
  const offenders = []
  for (const f of appFiles()) {
    if (f.includes('__tests__')) continue
    const src = readFileSync(f, 'utf8')
    if (/invoke\(\s*['"]id-extract['"]|supabaseInvoker|extractIdFields/.test(src)) {
      offenders.push(f)
    }
  }
  assert.deepEqual(offenders, [], 'these still call the retired endpoint')

  // And the two that legitimately invoke other functions still do.
  const stillThere = appFiles().filter((f) => /functions\.invoke/.test(readFileSync(f, 'utf8')))
  assert.ok(
    stillThere.some((f) => f.includes('FaceLogin')),
    'face-login must not have been removed as collateral',
  )
})

test('R3 the extraction module is gone, not merely unused', () => {
  assert.equal(existsSync('src/lib/idExtract.js'), false)
  assert.equal(existsSync('supabase/functions/id-extract/refund.ts'), false)
})

// ------------------------------------------------- the registration form

test('R4 the AI consent box and read button are gone from registration', () => {
  const src = readFileSync(REGISTER, 'utf8')
  for (const gone of [
    'aiConsent', 'aiBusy', 'aiNotice', 'aiStatus', 'aiAtCapacity',
    'readMyId', 'extractIdFields', 'supabaseInvoker', 'AI_ID_READING_ENABLED',
    'Read my ID for me',
  ]) {
    assert.ok(!src.includes(gone), `Register.jsx still has ${gone}`)
  }
})

test('R5 THE MISLEADING CONSENT TEXT IS GONE', () => {
  // Two claims were shown to residents and both had become false: the unpaid
  // tier does retain content, and the reader had been reading the ID number
  // since 2026-10-17. Neither sentence may come back.
  const src = readFileSync(REGISTER, 'utf8')
  assert.doesNotMatch(src, /Nothing is kept at Google/i)
  assert.doesNotMatch(src, /not your ID number/i)
  assert.doesNotMatch(src, /Gemini/i)
  assert.doesNotMatch(src, /Google/i)
})

test('R6 residents are told to type the details in, and who will check them', () => {
  const src = readFileSync(REGISTER, 'utf8')
  assert.match(src, /Type your ID details into the fields above yourself/i)
  assert.match(src, /authorised barangay officer/i)
  assert.match(src, /not sent to\s*\n?\s*any outside service|not sent to any outside service/i)
})

test('R7 the ID upload and its validation are untouched', () => {
  const src = readFileSync(REGISTER, 'utf8')
  assert.match(src, /accept=\{ID_ACCEPT_ATTR\}/, 'the upload field must remain')
  assert.match(src, /validateIdFile\(file\)/, 'the size and type rules must remain')
  assert.match(src, /valid-ids/, 'it must still go to the private bucket')
})

// ------------------------------------------------- verification is preserved

test('R8 manual entry is non-blocking and records pending_manual', () => {
  const v = idVerdict({ status: 'idle' })
  assert.equal(v.blocking, false)
  assert.equal(v.provenance, 'pending_manual')
})

test('R9 the form asks for the verdict rather than hardcoding it', () => {
  // Keeps the rule in one place, so a future reader cannot diverge from it.
  const src = readFileSync(REGISTER, 'utf8')
  assert.match(src, /idVerdict\(\{ status: 'idle' \}\)/)
  assert.match(src, /if \(idCheck\.blocking\) return/, 'the gate must stay wired')
  assert.match(src, /onProvenance\?\.\(idCheck\.provenance\)/)
  assert.doesNotMatch(src, /onProvenance\?\.\('pending_manual'\)/, 'must not be hardcoded')
})

test('R10 the mismatch rule is retained, not deleted', () => {
  // Decision: keep harmless security logic. Unreachable today because nothing
  // produces a reading, but intact so it cannot be lost.
  const v = idVerdict({ typed: 'A-111-222', read: 'B-333-444', status: 'done' })
  assert.equal(v.blocking, true)
  assert.equal(v.provenance, 'pending_manual')
})

test('R11 no state can produce auto_verified from the browser', () => {
  for (const status of ['idle', 'reading', 'unavailable', 'unread', 'filled', 'match', 'mismatch']) {
    const v = idVerdict({ typed: '123', read: status === 'match' ? '123' : null, status })
    assert.notEqual(v.provenance, 'auto_verified', `status ${status}`)
  }
})

// ------------------------------------------------- the retired endpoint

test('R12 THE POINT: the endpoint answers 410 Gone', () => {
  const src = readFileSync(ENDPOINT, 'utf8')
  assert.match(src, /status: 410/)
  assert.match(src, /retired: true/)
})

test('R13 it cannot call Gemini, read the body, or touch the key', () => {
  const src = readFileSync(ENDPOINT, 'utf8')
  // Strip comments: the header explains what it must not do, in those words.
  const code = src
    .split('\n')
    .filter((l) => {
      const t = l.trim()
      return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')

  assert.doesNotMatch(code, /fetch\s*\(/, 'no outbound request of any kind')
  assert.doesNotMatch(code, /Deno\.env\.get/, 'no secret is read, including the Gemini key')
  assert.doesNotMatch(code, /req\.json\(\)|req\.text\(\)|req\.arrayBuffer\(\)/, 'the body is never read')
  assert.doesNotMatch(code, /createClient/, 'no database connection')
  assert.doesNotMatch(code, /reserve_ai_extraction|release_ai_extraction/, 'no rate-limit reservation')
  assert.doesNotMatch(code, /console\./, 'nothing about the caller is logged')
  assert.doesNotMatch(code, /generativelanguage|GEMINI/, 'no Gemini endpoint or credential')
})

test('R14 it still answers the CORS preflight', () => {
  // Without this an older bundle sees a CORS failure instead of the message,
  // which reads as a broken site rather than a retired feature.
  const src = readFileSync(ENDPOINT, 'utf8')
  assert.match(src, /OPTIONS/)
  assert.match(src, /Access-Control-Allow-Origin/)
})

test('R15 the 410 body is written for a resident, not an operator', () => {
  const src = readFileSync(ENDPOINT, 'utf8')

  // Only the sentence that actually goes over the wire. The file header
  // explains the tier decision at length, and should -- that is for whoever
  // reads the code, not for whoever calls the endpoint.
  const gone = src.slice(src.indexOf('const GONE'), src.indexOf('Deno.serve'))

  assert.match(gone, /Type your ID details in yourself/i)
  assert.match(gone, /authorised barangay officer/i)
  assert.doesNotMatch(gone, /tier|quota|billing|unpaid|Gemini|Google/i,
    'the response must not explain our account arrangements to callers')
})

// ------------------------------------------------- obsolete work is gone

test('R16 the obsolete local migrations were removed', () => {
  // 33 (AI rate limits) and 34 (the Gemini on/off switch) were never applied
  // to production and never committed. 34 is redundant against a 410.
  assert.equal(existsSync('supabase/migrations/20261020140000_33_ai_extraction_rate_limits.sql'), false)
  assert.equal(existsSync('supabase/migrations/20261021090000_34_gemini_extraction_switch.sql'), false)
})

test('R17 migration 32 and the preserved schema are untouched', () => {
  // Explicitly kept: it is recorded in production, and profiles.id_verification
  // plus its guard are what the manual review workflow runs on.
  assert.equal(existsSync('supabase/proposals/ai-id-extraction.sql.proposed'), true)
  const sql = readFileSync('supabase/proposals/ai-id-extraction.sql.proposed', 'utf8')
  assert.match(sql, /id_verification/)
  assert.match(sql, /guard_profile_columns/)
})
