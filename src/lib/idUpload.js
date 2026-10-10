/**
 * Replacing the valid ID a resident has on file.
 *
 * The ordering matters more than anything else here. The new document is
 * uploaded to its OWN path first, and the profile is pointed at it only once
 * that upload has succeeded. Nothing overwrites the old file, so a failure at
 * any point leaves the resident's record still pointing at a document that
 * exists. The alternative -- upsert over the same path -- destroys the only
 * copy of the old ID the moment the new upload starts, and a dropped
 * connection then leaves the barangay with a record pointing at nothing.
 *
 * The storage client is passed in rather than imported, so the whole sequence
 * can be tested without a network or a bucket.
 */

import { validateIdFile } from './idFile.js'

/** image/png -> png. The browser's type is trusted ahead of the filename. */
const EXT_BY_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

export function extensionFor(file) {
  const byType = EXT_BY_TYPE[file?.type]
  if (byType) return byType
  const fromName = file?.name?.split('.').pop()?.toLowerCase()
  return /^[a-z0-9]{1,5}$/.test(fromName ?? '') ? fromName : 'bin'
}

/**
 * A path nothing else can already occupy.
 *
 * Still inside the resident's own folder, because the storage policies key on
 * the first path segment being auth.uid() -- putting it anywhere else would
 * be refused, and should be.
 */
export function newIdPath(userId, file, now = Date.now(), rand = Math.random) {
  const suffix = Math.floor(rand() * 1e6)
    .toString(36)
    .padStart(4, '0')
  return `${userId}/valid-id-${now}-${suffix}.${extensionFor(file)}`
}

/**
 * Upload a replacement and point the profile at it.
 *
 * Returns { ok: true, path } or { ok: false, stage, message } where stage is
 * 'invalid' | 'upload' | 'profile'. On any failure the resident's existing
 * valid_id_path is left exactly as it was.
 */
export async function replaceValidId({ client, userId, file, onProgress }) {
  const problem = validateIdFile(file)
  if (problem) return { ok: false, stage: 'invalid', message: problem }
  if (!userId) return { ok: false, stage: 'invalid', message: 'You are not signed in.' }

  const path = newIdPath(userId, file)

  onProgress?.('uploading')
  const { error: uploadError } = await client.storage
    .from('valid-ids')
    .upload(path, file, { upsert: false, contentType: file.type })

  if (uploadError) {
    return {
      ok: false,
      stage: 'upload',
      message: 'Your ID could not be uploaded. Your previous ID is still on file.',
    }
  }

  onProgress?.('saving')
  const { error: profileError } = await client
    .from('profiles')
    .update({ valid_id_path: path })
    .eq('id', userId)

  if (profileError) {
    // The upload landed but the record still points at the old document. Tidy
    // the orphan away so the bucket does not accumulate files nothing refers
    // to. Best effort: if this fails too, the orphan is harmless -- the
    // profile is unchanged either way, which is the thing that matters.
    try {
      await client.storage.from('valid-ids').remove([path])
    } catch {
      /* nothing to do, and nothing broken by it */
    }
    return {
      ok: false,
      stage: 'profile',
      message: 'Your ID was uploaded but your record could not be updated. Your previous ID is still on file.',
    }
  }

  return { ok: true, path }
}
