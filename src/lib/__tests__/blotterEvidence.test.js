/**
 * Blotter evidence: validation, paths, and the attach sequence.
 *
 * The Supabase client is mocked. No network, no bucket, no database. Every
 * report id and user id below is invented, and the "photographs" are synthetic
 * blobs of zero bytes -- no real resident evidence, and nothing personal.
 *
 * The test that matters most is the one about ordering: a photograph that
 * fails must never take the filed report with it, and a row insert that fails
 * must not leave a file behind that nothing refers to.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ACCEPTED_EVIDENCE_TYPES,
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_IMAGES,
  attachEvidence,
  evidencePath,
  selectionProblem,
  validateEvidenceFile,
} from '../blotterEvidence.js'

const USER = '22222222-2222-2222-2222-222222222222'
const REPORT = '44444444-4444-4444-4444-444444444444'

/** A synthetic file. Nothing is read from disk and nothing is real. */
function fakeFile({ name = 'photo.jpg', type = 'image/jpeg', size = 1024 } = {}) {
  return { name, type, size }
}

/**
 * A stand-in for the pieces of the Supabase client attachEvidence touches.
 * `upload` and `insert` decide what those calls do.
 */
function fakeClient({ upload = () => ({ error: null }), insert = () => ({ error: null }) } = {}) {
  const calls = { uploads: [], inserts: [], removes: [] }
  return {
    calls,
    storage: {
      from(bucket) {
        return {
          async upload(path, file, options) {
            calls.uploads.push({ bucket, path, file, options })
            return upload(path, file)
          },
          async remove(paths) {
            calls.removes.push({ bucket, paths })
            return { error: null }
          },
        }
      },
    },
    from(table) {
      return {
        async insert(row) {
          calls.inserts.push({ table, row })
          return insert(row)
        },
      }
    },
  }
}

/** Every synthetic blob decodes, unless a test says otherwise. */
const decodes = async () => true

// ------------------------------------------------------------- validation

test('the three accepted types pass, and nothing else does', () => {
  for (const type of ACCEPTED_EVIDENCE_TYPES) {
    assert.equal(validateEvidenceFile(fakeFile({ type })), null, type)
  }
  for (const type of ['application/pdf', 'image/svg+xml', 'image/gif', 'text/plain', '']) {
    assert.match(validateEvidenceFile(fakeFile({ type })), /JPEG, PNG or WebP/, type)
  }
})

test('the size limit is the bucket limit, and the boundary is inclusive', () => {
  assert.equal(MAX_EVIDENCE_BYTES, 5 * 1024 * 1024)
  assert.equal(validateEvidenceFile(fakeFile({ size: MAX_EVIDENCE_BYTES })), null, 'exactly 5 MB is fine')
  assert.match(validateEvidenceFile(fakeFile({ size: MAX_EVIDENCE_BYTES + 1 })), /larger than 5 MB/)
})

test('a missing or empty file is refused before anything else', () => {
  assert.match(validateEvidenceFile(null), /Choose a photo/)
  assert.match(validateEvidenceFile(fakeFile({ size: 0 })), /empty/)
})

test('the selection cap is five, and the message says how much room is left', () => {
  assert.equal(MAX_EVIDENCE_IMAGES, 5)
  assert.equal(selectionProblem(0, 5), null, 'five at once is allowed')
  assert.equal(selectionProblem(4, 1), null)
  assert.match(selectionProblem(4, 2), /room for 1 more/)
  assert.match(selectionProblem(5, 1), /Remove one first/)
})

// ------------------------------------------------------------------ paths

test('the path starts with the uploader id, so the storage policy accepts it', () => {
  const path = evidencePath(USER, REPORT, fakeFile())
  assert.equal(path.split('/')[0], USER, 'first segment must be auth.uid()')
  assert.equal(path.split('/')[1], REPORT, 'second segment names the report')
  assert.match(path, /\.jpg$/)
})

test('the extension follows the type, not the file name', () => {
  assert.match(evidencePath(USER, REPORT, fakeFile({ name: 'x.jpg', type: 'image/png' })), /\.png$/)
  assert.match(evidencePath(USER, REPORT, fakeFile({ type: 'image/webp' })), /\.webp$/)
})

test('two photos in the same batch never collide', () => {
  const a = evidencePath(USER, REPORT, fakeFile(), () => 0.11)
  const b = evidencePath(USER, REPORT, fakeFile(), () => 0.77)
  assert.notEqual(a, b)
})

// -------------------------------------------------------- attach sequence

test('every photo is uploaded, then attached, in order', async () => {
  const c = fakeClient()
  const files = [fakeFile({ name: 'a.jpg' }), fakeFile({ name: 'b.png', type: 'image/png' })]

  const r = await attachEvidence({ client: c, userId: USER, reportId: REPORT, files, decode: decodes })

  assert.equal(r.ok, true)
  assert.equal(r.attached.length, 2)
  assert.deepEqual(r.failed, [])
  assert.equal(c.calls.uploads.length, 2)
  assert.equal(c.calls.inserts.length, 2)
  assert.equal(c.calls.uploads[0].bucket, 'blotter-evidence', 'the private bucket, never public-assets')
  assert.equal(c.calls.uploads[0].options.upsert, false, 'never overwrite an existing object')
  assert.deepEqual(c.calls.removes, [], 'nothing to clean up when all is well')
})

test('the evidence row records the report, path, type and size', async () => {
  const c = fakeClient()
  const file = fakeFile({ name: 'injury.webp', type: 'image/webp', size: 2048 })

  await attachEvidence({ client: c, userId: USER, reportId: REPORT, files: [file], decode: decodes })

  const { table, row } = c.calls.inserts[0]
  assert.equal(table, 'blotter_evidence')
  assert.equal(row.report_id, REPORT)
  assert.equal(row.uploaded_by, USER)
  assert.equal(row.content_type, 'image/webp')
  assert.equal(row.byte_size, 2048)
  assert.equal(row.storage_path, c.calls.uploads[0].path, 'the row points at the object just uploaded')
})

test('an unacceptable photo never reaches the bucket', async () => {
  const c = fakeClient()
  const files = [fakeFile({ name: 'scan.pdf', type: 'application/pdf' }), fakeFile({ name: 'ok.jpg' })]

  const r = await attachEvidence({ client: c, userId: USER, reportId: REPORT, files, decode: decodes })

  assert.equal(r.ok, false)
  assert.equal(r.attached.length, 1, 'the acceptable one still lands')
  assert.equal(r.failed.length, 1)
  assert.equal(r.failed[0].name, 'scan.pdf')
  assert.equal(c.calls.uploads.length, 1, 'only the good file was uploaded')
})

test('a file that will not decode is refused, however it is labelled', async () => {
  // A .jpg that is really something else: the type satisfies the bucket, so
  // decoding is what catches it.
  const c = fakeClient()
  const r = await attachEvidence({
    client: c,
    userId: USER,
    reportId: REPORT,
    files: [fakeFile({ name: 'notreally.jpg' })],
    decode: async () => false,
  })

  assert.equal(r.ok, false)
  assert.match(r.failed[0].message, /could not be opened as a photo/)
  assert.equal(c.calls.uploads.length, 0, 'nothing was uploaded')
})

test('a decode that throws is treated as a refusal, not a crash', async () => {
  const c = fakeClient()
  const r = await attachEvidence({
    client: c,
    userId: USER,
    reportId: REPORT,
    files: [fakeFile()],
    decode: async () => {
      throw new Error('decode blew up')
    },
  })

  assert.equal(r.ok, false)
  assert.match(r.failed[0].message, /could not be opened as a photo/)
  assert.equal(c.calls.uploads.length, 0)
})

test('an upload failure is named, and leaves no evidence row', async () => {
  const c = fakeClient({ upload: () => ({ error: { message: 'network' } }) })

  const r = await attachEvidence({
    client: c,
    userId: USER,
    reportId: REPORT,
    files: [fakeFile({ name: 'damage.jpg' })],
    decode: decodes,
  })

  assert.equal(r.ok, false)
  assert.equal(r.failed[0].name, 'damage.jpg')
  assert.equal(c.calls.inserts.length, 0, 'nothing claims the file exists')
  assert.deepEqual(c.calls.removes, [], 'there is no object to remove')
})

test('a row insert failure removes the orphan it just created', async () => {
  // This is the only moment the object can be deleted: the storage policy
  // allows removing objects no evidence row refers to, and none does yet.
  const c = fakeClient({ insert: () => ({ error: { message: 'violates row-level security' } }) })

  const r = await attachEvidence({
    client: c,
    userId: USER,
    reportId: REPORT,
    files: [fakeFile({ name: 'lot.jpg' })],
    decode: decodes,
  })

  assert.equal(r.ok, false)
  assert.match(r.failed[0].message, /could not be attached/)
  assert.equal(c.calls.removes.length, 1, 'the orphan was cleaned up')
  assert.deepEqual(c.calls.removes[0].paths, [c.calls.uploads[0].path])
  assert.equal(c.calls.removes[0].bucket, 'blotter-evidence')
})

test('a failed cleanup is not allowed to throw out of the sequence', async () => {
  const c = {
    storage: {
      from: () => ({
        async upload() {
          return { error: null }
        },
        async remove() {
          throw new Error('remove failed too')
        },
      }),
    },
    from: () => ({
      async insert() {
        return { error: { message: 'nope' } }
      },
    }),
  }

  const r = await attachEvidence({
    client: c,
    userId: USER,
    reportId: REPORT,
    files: [fakeFile()],
    decode: decodes,
  })
  assert.equal(r.ok, false)
  assert.equal(r.failed.length, 1, 'reported, not thrown')
})

test('a partial batch reports exactly which photos failed', async () => {
  let n = 0
  const c = fakeClient({
    upload: () => {
      n += 1
      return n === 2 ? { error: { message: 'network' } } : { error: null }
    },
  })
  const files = [
    fakeFile({ name: 'one.jpg' }),
    fakeFile({ name: 'two.jpg' }),
    fakeFile({ name: 'three.jpg' }),
  ]

  const r = await attachEvidence({ client: c, userId: USER, reportId: REPORT, files, decode: decodes })

  assert.equal(r.ok, false)
  assert.deepEqual(r.attached.map((a) => a.name), ['one.jpg', 'three.jpg'])
  assert.deepEqual(r.failed.map((f) => f.name), ['two.jpg'])
})

test('no files at all is a success with nothing attached', async () => {
  const c = fakeClient()
  const r = await attachEvidence({ client: c, userId: USER, reportId: REPORT, files: [], decode: decodes })
  assert.equal(r.ok, true)
  assert.deepEqual(r.attached, [])
  assert.equal(c.calls.uploads.length, 0)
})

test('a missing report id or user id attaches nothing', async () => {
  const c = fakeClient()
  for (const args of [
    { userId: USER, reportId: null },
    { userId: null, reportId: REPORT },
  ]) {
    const r = await attachEvidence({ client: c, ...args, files: [fakeFile()], decode: decodes })
    assert.equal(r.ok, false)
    assert.equal(r.failed.length, 1)
  }
  assert.equal(c.calls.uploads.length, 0, 'nothing is uploaded without both ids')
})

test('progress is reported per file, and never reveals a path', async () => {
  const c = fakeClient()
  const seen = []
  await attachEvidence({
    client: c,
    userId: USER,
    reportId: REPORT,
    files: [fakeFile({ name: 'a.jpg' })],
    decode: decodes,
    onProgress: (p) => seen.push(p),
  })

  assert.deepEqual(seen.map((p) => p.stage), ['checking', 'uploading', 'attaching'])
  for (const p of seen) {
    assert.equal(p.total, 1)
    assert.ok(!('path' in p), 'a signed path is never handed to the UI layer')
  }
})
