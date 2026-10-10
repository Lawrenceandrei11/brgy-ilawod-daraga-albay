/**
 * Retiring a superseded ID, and spotting one that still needs looking at.
 *
 * The dangerous mistake here is deleting the document a resident actually has
 * on file, so most of these tests are about what must NOT be removed.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { cleanupSupersededIds, idReviewSupported, needsIdReview } from '../idRetention.js'

const USER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const KEEP = `${USER}/valid-id-1700000002-abc.png`
const OLD1 = 'valid-id.png'
const OLD2 = 'valid-id-1700000001-zzz.jpg'

function fakeClient({ listError = null, removeError = null, listThrows = false, removeThrows = false } = {}) {
  const state = { removed: null, listedPrefix: null }
  return {
    state,
    storage: {
      from(bucket) {
        assert.equal(bucket, 'valid-ids')
        return {
          async list(prefix) {
            state.listedPrefix = prefix
            if (listThrows) throw new Error('boom')
            if (listError) return { error: listError, data: null }
            return {
              error: null,
              data: [{ name: OLD1 }, { name: OLD2 }, { name: KEEP.split('/')[1] }],
            }
          },
          async remove(paths) {
            if (removeThrows) throw new Error('boom')
            if (removeError) return { error: removeError }
            state.removed = paths
            return { error: null }
          },
        }
      },
    },
  }
}

// ------------------------------------------------------------- the happy path

test('removes every older file and keeps the current one', async () => {
  const c = fakeClient()
  const r = await cleanupSupersededIds({ client: c, userId: USER, keepPath: KEEP })
  assert.equal(r.ok, true)
  assert.equal(c.state.listedPrefix, USER, 'only ever looks in this resident folder')
  assert.deepEqual(r.removed.sort(), [`${USER}/${OLD1}`, `${USER}/${OLD2}`].sort())
  assert.ok(!r.removed.includes(KEEP), 'the live document must survive')
})

test('does nothing when there is only the current file', async () => {
  const c = fakeClient()
  c.storage.from = () => ({
    async list() {
      return { error: null, data: [{ name: KEEP.split('/')[1] }] }
    },
    async remove() {
      throw new Error('must not be called')
    },
  })
  const r = await cleanupSupersededIds({ client: c, userId: USER, keepPath: KEEP })
  assert.equal(r.ok, true)
  assert.deepEqual(r.removed, [])
})

// ------------------------------------------- refusing to delete the only copy

test('refuses to run without a keepPath, which would mean "keep nothing"', async () => {
  for (const keepPath of [undefined, null, '']) {
    const c = fakeClient()
    const r = await cleanupSupersededIds({ client: c, userId: USER, keepPath })
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'no-keep-path')
    assert.equal(c.state.removed, null, 'nothing may be deleted')
  }
})

test('refuses to run without a user', async () => {
  const c = fakeClient()
  const r = await cleanupSupersededIds({ client: c, userId: null, keepPath: KEEP })
  assert.equal(r.ok, false)
  assert.equal(c.state.removed, null)
})

// ------------------------------------------------------- storage misbehaving

test('a failed listing deletes nothing and says so', async () => {
  for (const opts of [{ listError: { message: 'nope' } }, { listThrows: true }]) {
    const c = fakeClient(opts)
    const r = await cleanupSupersededIds({ client: c, userId: USER, keepPath: KEEP })
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'list-failed')
    assert.equal(c.state.removed, null)
  }
})

test('a failed delete is reported, not thrown — the review already stands', async () => {
  for (const opts of [{ removeError: { message: 'nope' } }, { removeThrows: true }]) {
    const c = fakeClient(opts)
    const r = await cleanupSupersededIds({ client: c, userId: USER, keepPath: KEEP })
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'remove-failed')
    assert.deepEqual(r.removed, [])
  }
})

test('cleanup is safe to run twice — the second run finds nothing to do', async () => {
  const c = fakeClient()
  await cleanupSupersededIds({ client: c, userId: USER, keepPath: KEEP })
  // Second pass against what would now be left.
  c.storage.from = () => ({
    async list() {
      return { error: null, data: [{ name: KEEP.split('/')[1] }] }
    },
    async remove() {
      throw new Error('must not be called')
    },
  })
  const again = await cleanupSupersededIds({ client: c, userId: USER, keepPath: KEEP })
  assert.equal(again.ok, true)
  assert.deepEqual(again.removed, [])
})

// --------------------------------------------------------- the queue predicate

test('a document is queued when it was replaced and never reviewed', () => {
  assert.equal(needsIdReview({ valid_id_replaced_at: '2026-10-10T04:00:00Z' }), true)
})

test('a document reviewed after it was replaced is not queued', () => {
  assert.equal(
    needsIdReview({
      valid_id_replaced_at: '2026-10-10T04:00:00Z',
      valid_id_reviewed_at: '2026-10-10T05:00:00Z',
    }),
    false,
  )
})

test('replacing it again after a review queues it again', () => {
  assert.equal(
    needsIdReview({
      valid_id_replaced_at: '2026-10-11T09:00:00Z',
      valid_id_reviewed_at: '2026-10-10T05:00:00Z',
    }),
    true,
  )
})

test('a resident who never replaced anything is never queued', () => {
  assert.equal(needsIdReview({ valid_id_replaced_at: null }), false)
  assert.equal(needsIdReview({}), false)
  assert.equal(needsIdReview(null), false)
})

test('before the migration the UI claims nothing', () => {
  // Columns absent: the admin screens must not assert anything either way.
  const preMigration = { id: 'x', status: 'approved' }
  assert.equal(idReviewSupported(preMigration), false)
  assert.equal(needsIdReview(preMigration), false)
  // Columns present but null: supported, and not queued.
  const postMigration = { id: 'x', status: 'approved', valid_id_replaced_at: null }
  assert.equal(idReviewSupported(postMigration), true)
  assert.equal(needsIdReview(postMigration), false)
})

// ----------------------------------------- the gate on the re-upload action
//
// The resident-side "Replace this ID" action is tied to idReviewSupported(),
// so it cannot appear before the database can record that a replacement needs
// checking. These pin that wiring: a profile shaped the way the API returns
// it today must not enable the action.

test('the re-upload gate stays shut until the migration adds the column', () => {
  // Exactly the shape profiles returns today: no such key at all.
  const today = {
    id: 'x',
    status: 'approved',
    valid_id_path: 'x/valid-id.png',
    valid_id_number: 'TEST-ILW-000046',
    valid_id_type: 'Postal ID',
  }
  assert.equal(idReviewSupported(today), false, 'must not offer re-upload pre-migration')

  // After the migration, present but null for everyone who never replaced.
  const after = { ...today, valid_id_replaced_at: null, valid_id_reviewed_at: null }
  assert.equal(idReviewSupported(after), true, 'offered once the column exists')
  assert.equal(needsIdReview(after), false, 'and nobody is queued on day one')
})

test('the gate does not depend on whether an ID is on file', () => {
  assert.equal(idReviewSupported({ valid_id_path: null }), false)
  assert.equal(idReviewSupported({ valid_id_path: null, valid_id_replaced_at: null }), true)
})

test('a missing or odd profile never opens the gate', () => {
  assert.equal(idReviewSupported(null), false)
  assert.equal(idReviewSupported(undefined), false)
})
