/**
 * Photographs attached to a blotter report.
 *
 * Evidence is sensitive: it shows injuries, damaged property, and the inside of
 * people's homes. It lives in the private `blotter-evidence` bucket, is reached
 * only through short-lived signed URLs, and is readable by the complainant and
 * approved barangay staff and by nobody else. The database enforces that, not
 * this file.
 *
 * Two rules here are worth stating plainly, because they are the reason the
 * sequence below is shaped the way it is:
 *
 *   1. A filed report is never sacrificed for a failed photograph. The report
 *      is inserted first and is never rolled back; an attachment that fails is
 *      reported as a failed attachment, and the resident can retry it.
 *
 *   2. Once an image is associated with a filed report it cannot be deleted --
 *      not by the resident, not through a direct Storage call. The storage
 *      policy permits deleting only objects that no blotter_evidence row
 *      refers to, which is exactly the window this file needs to tidy up
 *      after itself.
 *
 * The client is passed in rather than imported, so the whole sequence can be
 * tested without a network, a bucket, or a database.
 */

export const BUCKET = 'blotter-evidence'

/** Mirrors the bucket's allowed_mime_types, in the same order. */
export const ACCEPTED_EVIDENCE_TYPES = ['image/png', 'image/jpeg', 'image/webp']

/** What the file input advertises. Not `image/*`: the bucket is narrower. */
export const EVIDENCE_ACCEPT_ATTR = ACCEPTED_EVIDENCE_TYPES.join(',')

/** The bucket's own file_size_limit. Checked here so the resident hears it first. */
export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024

/**
 * Also enforced by a trigger on blotter_evidence, which is what actually binds.
 * A number here too, so the picker can stop offering before a round trip.
 */
export const MAX_EVIDENCE_IMAGES = 5

const EXT_BY_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

/** A sentence to show the resident, or null when the file is acceptable. */
export function validateEvidenceFile(file) {
  if (!file) return 'Choose a photo.'
  if (!file.size) return 'That file is empty.'
  if (file.size > MAX_EVIDENCE_BYTES) return 'That photo is larger than 5 MB. Try a smaller one.'
  if (!ACCEPTED_EVIDENCE_TYPES.includes(file.type)) return 'Choose a JPEG, PNG or WebP photo.'
  return null
}

/**
 * Whether this many photos may be added to a selection that already has some.
 * Returns a sentence or null.
 */
export function selectionProblem(existingCount, addingCount) {
  const total = existingCount + addingCount
  if (total > MAX_EVIDENCE_IMAGES) {
    const left = Math.max(0, MAX_EVIDENCE_IMAGES - existingCount)
    if (left === 0) return `You can attach up to ${MAX_EVIDENCE_IMAGES} photos. Remove one first.`
    return `You can attach up to ${MAX_EVIDENCE_IMAGES} photos — room for ${left} more.`
  }
  return null
}

/**
 * A path nothing else can occupy, inside the resident's own folder.
 *
 * The first segment must be auth.uid(): the storage policies key on it, so
 * putting a file anywhere else is refused, and should be. The report id is the
 * second segment so the bucket can be read by eye when something looks wrong.
 */
export function evidencePath(userId, reportId, file, rand = Math.random) {
  const suffix = Math.floor(rand() * 1e12).toString(36)
  const ext = EXT_BY_TYPE[file?.type] ?? 'jpg'
  return `${userId}/${reportId}/${Date.now()}-${suffix}.${ext}`
}

/**
 * Does the browser actually accept this as an image?
 *
 * Storage checks the content type the upload *declares*, so a file renamed to
 * .jpg with a crafted header can still satisfy the bucket. Asking the browser
 * to decode it closes the ordinary case: a file that will not decode is not a
 * photograph. It is a safeguard, not a guarantee -- see the note on
 * content-type spoofing in the module docs of the migration proposal.
 */
export async function decodeImageFile(file) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file)
    const ok = bitmap.width > 0 && bitmap.height > 0
    bitmap.close?.()
    return ok
  }
  // Older Safari. An <img> that fires load has decoded the bytes.
  return await new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img.naturalWidth > 0)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(false)
    }
    img.src = url
  })
}

const NOT_AN_IMAGE = 'That file could not be opened as a photo. Choose another.'

/**
 * Upload the chosen photographs and attach them to an already-filed report.
 *
 * Call this only after the report row exists: evidence rows reference it, and
 * the storage policy requires the path to sit under the uploader's own id.
 *
 * Each photograph is handled on its own, in order, so a partial result is
 * coherent -- the ones that landed are attached and readable, and the ones that
 * did not are named. Nothing here can fail the report itself.
 *
 * Returns { ok, attached: [{ name, path }], failed: [{ name, message }] }.
 * `ok` is true only when every file was attached.
 */
export async function attachEvidence({
  client,
  userId,
  reportId,
  files,
  decode = decodeImageFile,
  onProgress,
}) {
  const list = Array.from(files ?? [])
  const attached = []
  const failed = []

  if (!userId || !reportId) {
    return {
      ok: false,
      attached,
      failed: list.map((f) => ({ name: f?.name ?? 'photo', message: 'You are not signed in.' })),
    }
  }

  for (let i = 0; i < list.length; i += 1) {
    const file = list[i]
    const name = file?.name ?? `photo ${i + 1}`
    onProgress?.({ index: i, total: list.length, name, stage: 'checking' })

    const problem = validateEvidenceFile(file)
    if (problem) {
      failed.push({ name, message: problem })
      continue
    }

    let decodable = false
    try {
      decodable = await decode(file)
    } catch {
      decodable = false
    }
    if (!decodable) {
      failed.push({ name, message: NOT_AN_IMAGE })
      continue
    }

    const path = evidencePath(userId, reportId, file)

    onProgress?.({ index: i, total: list.length, name, stage: 'uploading' })
    const { error: uploadError } = await client.storage
      .from(BUCKET)
      .upload(path, file, { upsert: false, contentType: file.type })

    if (uploadError) {
      failed.push({ name, message: 'This photo could not be uploaded.' })
      continue
    }

    onProgress?.({ index: i, total: list.length, name, stage: 'attaching' })
    const { error: rowError } = await client.from('blotter_evidence').insert({
      report_id: reportId,
      storage_path: path,
      content_type: file.type,
      byte_size: file.size,
      uploaded_by: userId,
    })

    if (rowError) {
      // The file landed but nothing refers to it. Tidy it away while that is
      // still allowed: the storage policy permits deleting only objects no
      // evidence row points at, so this is the one moment it can be removed.
      // Best effort -- if it fails the file is unreferenced and unreadable by
      // anyone but its owner and staff, and no record claims it exists.
      try {
        await client.storage.from(BUCKET).remove([path])
      } catch {
        /* nothing to do, and nothing broken by it */
      }
      failed.push({ name, message: 'This photo could not be attached to the report.' })
      continue
    }

    attached.push({ name, path })
  }

  return { ok: failed.length === 0, attached, failed }
}
