/**
 * The ID check, now that Gemini is the only reader.
 *
 * The distinction these tests exist to protect: whether the number was TYPED
 * by the resident or FILLED by the reader. Filled means the number came out
 * of the photograph, so comparing it to the photograph establishes nothing.
 * Typed means two independent readings of one card, and then a match means
 * something and a mismatch is evidence.
 *
 * Every number below is invented.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { ID_CHECK_IDLE, idCheckLabel, idCheckMessage, idVerdict } from '../idCheck.js'

const READ = '1234567890123456'

// ------------------------------------------------- the two different cases

test('THE POINT: an empty field is filled, and nothing is verified', () => {
  const s = idVerdict({ typed: '', read: READ, status: 'done' })
  assert.equal(s.status, 'filled')
  assert.equal(s.blocking, false)
  assert.equal(s.provenance, 'ai_extracted', 'the secretary must see this was not checked')
  assert.ok(!/matches/i.test(idCheckMessage(s)), 'and it must not read as a match')
})

test('THE POINT: a typed number is compared, not overwritten', () => {
  const s = idVerdict({ typed: READ, read: READ, status: 'done' })
  assert.equal(s.status, 'match')
  assert.equal(s.blocking, false)
})

test('a mismatch is the only thing that stops anyone', () => {
  const s = idVerdict({ typed: '9999888877776666', read: READ, status: 'done' })
  assert.equal(s.status, 'mismatch')
  assert.equal(s.blocking, true)
  // The number read is shown masked, never whole.
  assert.match(idCheckMessage(s), /ending ••••••••3456/)
  assert.ok(!idCheckMessage(s).includes(READ), 'the number itself never appears')
})

test('formatting differences are not mismatches', () => {
  // Same number, typed the way a person writes it off a card.
  for (const typed of ['1234-5678-9012-3456', '1234 5678 9012 3456', ' 1234567890123456 ']) {
    const s = idVerdict({ typed, read: READ, status: 'done' })
    assert.equal(s.status, 'match', typed)
    assert.equal(s.blocking, false)
  }
})

test('case and punctuation on an alphanumeric number are ignored too', () => {
  const s = idVerdict({ typed: 'n01-12-123456', read: 'N0112123456', status: 'done' })
  assert.equal(s.status, 'match')
})

// ------------------------------------------- nothing else blocks, ever

test('every outcome that is not a mismatch lets the resident through', () => {
  const cases = [
    ['nothing attempted', idVerdict({})],
    ['still reading', idVerdict({ status: 'reading' })],
    ['reader unavailable', idVerdict({ status: 'unavailable' })],
    ['no number on the card', idVerdict({ typed: READ, read: '', status: 'done' })],
    ['field filled by reader', idVerdict({ typed: '', read: READ, status: 'done' })],
    ['typed and agreed', idVerdict({ typed: READ, read: READ, status: 'done' })],
  ]
  for (const [label, s] of cases) {
    assert.equal(s.blocking, false, label)
  }
  // There is no offline reader left, so blocking on "could not read" would
  // mean an outage at Google stops registration entirely.
  assert.equal(idVerdict({ status: 'unavailable' }).provenance, 'pending_manual')
  assert.equal(idVerdict({ typed: READ, read: '', status: 'done' }).status, 'unread')
})

test('a match is NOT recorded as auto_verified', () => {
  // The comparison happens in the browser. The server cannot tell a real
  // match from a crafted request claiming one, and guard_profile_columns
  // refuses auto_verified from a resident for that reason.
  const s = idVerdict({ typed: READ, read: READ, status: 'done' })
  assert.equal(s.provenance, 'pending_manual')
  assert.notEqual(s.provenance, 'auto_verified')
})

test('only a filled field is recorded as ai_extracted', () => {
  const provenances = {
    filled: idVerdict({ typed: '', read: READ, status: 'done' }).provenance,
    match: idVerdict({ typed: READ, read: READ, status: 'done' }).provenance,
    mismatch: idVerdict({ typed: '1111', read: READ, status: 'done' }).provenance,
    unread: idVerdict({ typed: READ, read: '', status: 'done' }).provenance,
    unavailable: idVerdict({ status: 'unavailable' }).provenance,
    idle: idVerdict({}).provenance,
  }
  assert.equal(provenances.filled, 'ai_extracted')
  for (const [k, v] of Object.entries(provenances)) {
    if (k !== 'filled') assert.equal(v, 'pending_manual', k)
  }
})

// --------------------------------------------------------- what is shown

test('only a match may read as one', () => {
  const PASS = idCheckLabel({ status: 'match' })
  for (const status of ['filled', 'unread', 'unavailable', 'mismatch', 'reading', 'idle']) {
    assert.notEqual(idCheckLabel({ status }), PASS, status)
    assert.ok(!/^matches/i.test(idCheckLabel({ status })), status)
  }
})

test('every settled state says something useful', () => {
  for (const status of ['match', 'mismatch', 'filled', 'unread', 'unavailable']) {
    const msg = idCheckMessage({ status, readMasked: '••••3456' })
    assert.ok(msg.length > 30, status)
    assert.match(msg, /secretary|Correct the number/, status)
  }
  assert.equal(idCheckMessage(ID_CHECK_IDLE), '')
})
