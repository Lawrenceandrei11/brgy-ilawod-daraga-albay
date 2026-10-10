/**
 * The rules the ID upload has always applied, in one testable place.
 *
 * The limits and the wording are exactly what Register.jsx enforced inline
 * before, and they are deliberately the same as the storage bucket's own
 * `file_size_limit` (5 MB) and `allowed_mime_types`. The browser check is a
 * courtesy so the resident hears about it before the upload; the bucket is
 * what actually enforces it.
 */

export const MAX_ID_BYTES = 5 * 1024 * 1024

/** Mirrors the valid-ids bucket's allowed_mime_types, in the same order. */
export const ACCEPTED_ID_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf']

/** What the file input advertises. */
export const ID_ACCEPT_ATTR = ACCEPTED_ID_TYPES.join(',')

/**
 * null when the file is acceptable, otherwise the message to show.
 * Size is checked first, as it was before.
 */
export function validateIdFile(file) {
  if (!file) return 'A photo of your valid ID is required.'
  if (file.size > MAX_ID_BYTES) return 'That file is larger than 5 MB. Try a smaller photo.'
  if (!ACCEPTED_ID_TYPES.includes(file.type)) return 'Upload a PNG, JPEG, WEBP or PDF.'
  return null
}

/** Whether this upload needs rasterising before OCR can look at it. */
export function isPdf(file) {
  return file?.type === 'application/pdf'
}
