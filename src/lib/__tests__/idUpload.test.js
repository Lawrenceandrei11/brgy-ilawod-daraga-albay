/**
 * Replacing the ID on file.
 *
 * The property that matters is the one that is hardest to see by hand: after
 * ANY failure, the resident's valid_id_path still points at the document that
 * is actually in the bucket. The storage client is faked, so every failure
 * can be provoked deliberately.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { MAX_ID_BYTES } from '../idFile.js'
import { extensionFor, newIdPath, replaceValidId } from '../idUpload.js'

const USER = '11111111-2222-3333-4444-555555555555'
const OLD_PATH = `${USER}/valid-id.png`

const png = (size = 2048) => ({ name: 'new-id.png', type: 'image/png', size })
const pdf = () => ({ name: 'scan.pdf', type: 'application/pdf', size: 4096 })

/**
 * A stand-in for the supabase client. `profile.valid_id_path` is the thing
 * under test: the assertions below mostly ask what it is afterwards.
 */
function fakeClient({ uploadError = null, updateError = null } = {}) {
  const state = {
    profile: { valid_id_path: OLD_PATH },
    uploaded: [],
    removed: [],
  }
  return {
    state,
    storage: {
      from(bucket) {
        assert.equal(bucket, 'valid-ids', 'must stay in the private bucket')
        return {
          async upload(path, file, opts) {
            assert.equal(opts.upsert, false, 'must never overwrite an existing object')
            if (uploadError) return { error: uploadError }
            state.uploaded.push(path)
            return { error: null }
          },
          async remove(paths) {
            state.removed.push(...paths)
            return { error: null }
          },
        }
      },
    },
    from(table) {
      assert.equal(table, 'profiles')
      return {
        update(patch) {
          return {
            async eq(_col, id) {
              assert.equal(id, USER, 'may only update the signed-in resident')
              if (updateError) return { error: updateError }
              Object.assign(state.profile, patch)
              return { error: null }
            },
          }
        },
      }
    },
  }
}

// ------------------------------------------------------------------- paths

test('the extension comes from the file type, not a trusted filename', () => {
  assert.equal(extensionFor({ type: 'image/png', name: 'x.exe' }), 'png')
  assert.equal(extensionFor({ type: 'image/jpeg', name: 'x' }), 'jpg')
  assert.equal(extensionFor({ type: 'image/webp', name: 'x' }), 'webp')
  assert.equal(extensionFor({ type: 'application/pdf', name: 'x' }), 'pdf')
})

test('the new path is inside the resident own folder and is never the old one', () => {
  const path = newIdPath(USER, png(), 1700000000000, () => 0.5)
  assert.ok(path.startsWith(`${USER}/`), 'storage policies key on the first segment')
  assert.notEqual(path, OLD_PATH)
  assert.match(path, /\.png$/)
})

test('two replacements in the same millisecond still get different paths', () => {
  const a = newIdPath(USER, png(), 1700000000000, () => 0.11)
  const b = newIdPath(USER, png(), 1700000000000, () => 0.87)
  assert.notEqual(a, b)
})

// --------------------------------------------------------------- happy path

test('a successful replacement uploads first, then points the profile at it', async () => {
  const c = fakeClient()
  const r = await replaceValidId({ client: c, userId: USER, file: png() })
  assert.equal(r.ok, true)
  assert.equal(c.state.uploaded.length, 1)
  assert.equal(c.state.uploaded[0], r.path)
  assert.equal(c.state.profile.valid_id_path, r.path, 'profile now points at the new file')
  assert.notEqual(c.state.profile.valid_id_path, OLD_PATH)
  assert.deepEqual(c.state.removed, [], 'the old document is not deleted here')
})

test('a PDF replacement works the same way', async () => {
  const c = fakeClient()
  const r = await replaceValidId({ client: c, userId: USER, file: pdf() })
  assert.equal(r.ok, true)
  assert.match(r.path, /\.pdf$/)
  assert.equal(c.state.profile.valid_id_path, r.path)
})

test('the old document is left in the bucket, not overwritten', async () => {
  const c = fakeClient()
  await replaceValidId({ client: c, userId: USER, file: png() })
  // upsert:false is asserted inside the fake; this checks the path differed.
  assert.ok(!c.state.uploaded.includes(OLD_PATH))
})

// ------------------------------------------------------------ refused files

test('an unsupported type is refused before anything is uploaded', async () => {
  const c = fakeClient()
  const r = await replaceValidId({ client: c, userId: USER, file: { name: 'x.gif', type: 'image/gif', size: 10 } })
  assert.equal(r.ok, false)
  assert.equal(r.stage, 'invalid')
  assert.equal(r.message, 'Upload a PNG, JPEG, WEBP or PDF.')
  assert.deepEqual(c.state.uploaded, [])
  assert.equal(c.state.profile.valid_id_path, OLD_PATH)
})

test('an oversized file is refused before anything is uploaded', async () => {
  const c = fakeClient()
  const r = await replaceValidId({ client: c, userId: USER, file: png(MAX_ID_BYTES + 1) })
  assert.equal(r.ok, false)
  assert.equal(r.stage, 'invalid')
  assert.match(r.message, /larger than 5 MB/)
  assert.deepEqual(c.state.uploaded, [])
  assert.equal(c.state.profile.valid_id_path, OLD_PATH)
})

test('a file exactly on the limit is accepted', async () => {
  const c = fakeClient()
  const r = await replaceValidId({ client: c, userId: USER, file: png(MAX_ID_BYTES) })
  assert.equal(r.ok, true)
})

test('a signed-out caller cannot replace anything', async () => {
  const c = fakeClient()
  const r = await replaceValidId({ client: c, userId: null, file: png() })
  assert.equal(r.ok, false)
  assert.equal(r.stage, 'invalid')
  assert.deepEqual(c.state.uploaded, [])
})

// --------------------------------------------------------- failure recovery

test('an upload failure leaves the previous ID on file', async () => {
  const c = fakeClient({ uploadError: { message: 'network died' } })
  const r = await replaceValidId({ client: c, userId: USER, file: png() })
  assert.equal(r.ok, false)
  assert.equal(r.stage, 'upload')
  assert.match(r.message, /previous ID is still on file/)
  assert.equal(c.state.profile.valid_id_path, OLD_PATH, 'unchanged')
})

test('a profile-update failure leaves the previous ID on file AND tidies the orphan', async () => {
  const c = fakeClient({ updateError: { message: 'rls said no' } })
  const r = await replaceValidId({ client: c, userId: USER, file: png() })
  assert.equal(r.ok, false)
  assert.equal(r.stage, 'profile')
  assert.equal(c.state.profile.valid_id_path, OLD_PATH, 'still the old document')
  // The uploaded file nothing now refers to is removed again.
  assert.equal(c.state.removed.length, 1)
  assert.equal(c.state.removed[0], c.state.uploaded[0])
})

test('a failed cleanup still does not corrupt the profile', async () => {
  const c = fakeClient({ updateError: { message: 'rls said no' } })
  c.storage.from = () => ({
    async upload() {
      return { error: null }
    },
    async remove() {
      throw new Error('remove exploded')
    },
  })
  const r = await replaceValidId({ client: c, userId: USER, file: png() })
  assert.equal(r.ok, false)
  assert.equal(r.stage, 'profile')
  assert.equal(c.state.profile.valid_id_path, OLD_PATH)
})

test('the profile is never pointed at a document that was not uploaded', async () => {
  // The invariant, stated once: for every failure mode, old path survives.
  for (const opts of [
    { uploadError: { message: 'x' } },
    { updateError: { message: 'x' } },
  ]) {
    const c = fakeClient(opts)
    const r = await replaceValidId({ client: c, userId: USER, file: png() })
    assert.equal(r.ok, false)
    assert.equal(c.state.profile.valid_id_path, OLD_PATH)
  }
})
