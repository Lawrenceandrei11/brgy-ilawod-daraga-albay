/**
 * The re-upload gate must be shut unless someone deliberately opened it.
 * Applying the migration satisfies the OTHER condition; this one is separate.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { idReuploadEnabled } from '../features.js'
import { idReviewSupported } from '../idRetention.js'

test('the gate is shut when nothing is configured', () => {
  assert.equal(idReuploadEnabled({}), false)
  assert.equal(idReuploadEnabled(undefined), false)
  assert.equal(idReuploadEnabled({ VITE_ID_REUPLOAD: undefined }), false)
  assert.equal(idReuploadEnabled({ VITE_ID_REUPLOAD: '' }), false)
})

test('only the exact string "true" opens it', () => {
  assert.equal(idReuploadEnabled({ VITE_ID_REUPLOAD: 'true' }), true)
  for (const v of ['TRUE', 'True', 'true ', ' true', '1', 'yes', 'on', 'false', 0, 1, null]) {
    assert.equal(idReuploadEnabled({ VITE_ID_REUPLOAD: v }), false, JSON.stringify(v))
  }
})

test('the migration alone does NOT enable re-upload', () => {
  // Post-migration profile: the column exists, so the database is ready...
  const migrated = { id: 'x', status: 'approved', valid_id_replaced_at: null }
  assert.equal(idReviewSupported(migrated), true, 'database side ready')
  // ...but with no flag set, the resident-side action stays shut.
  const enabled = idReuploadEnabled({}) && idReviewSupported(migrated)
  assert.equal(enabled, false, 'migration must not switch the workflow on')
})

test('both conditions are required, in either direction', () => {
  const migrated = { valid_id_replaced_at: null }
  const notMigrated = { id: 'x' }
  const on = { VITE_ID_REUPLOAD: 'true' }
  assert.equal(idReuploadEnabled(on) && idReviewSupported(notMigrated), false, 'flag alone is not enough')
  assert.equal(idReuploadEnabled({}) && idReviewSupported(migrated), false, 'column alone is not enough')
  assert.equal(idReuploadEnabled(on) && idReviewSupported(migrated), true, 'both together')
})
