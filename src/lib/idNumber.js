/**
 * Comparing ID numbers, and showing them safely.
 *
 * This file used to do much more: pull candidate numbers out of raw OCR text,
 * score them by confidence, fold characters tesseract confuses, and decide a
 * match from the wreckage. None of that is needed now. The reader returns one
 * number, cleanly, so the only question left is whether two strings mean the
 * same number.
 *
 * What went, and why it is not missed:
 *
 *   extractCandidates   OCR text came back as a page of noise with the number
 *                       somewhere inside it. Gemini returns the field.
 *   confidenceFor       a per-token confidence score, which only existed to
 *                       decide whether a bad reading was worth blocking on.
 *   foldConfusables     folded O/0, I/1, S/5 onto each other. Removed earlier
 *                       on its own merits: it accepted genuinely different
 *                       numbers, since S1234567 and 51234567 fold alike.
 */

/**
 * Case, spaces and hyphens cannot change which number is meant, so they are
 * the only things normalised away. Nothing else: a character that differs is
 * a number that differs.
 */
export function normalizeIdNumber(value) {
  if (typeof value !== 'string') return ''
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** "••••6789" -- enough to point at a number without repeating it. */
export function maskIdNumber(value) {
  const n = normalizeIdNumber(value)
  if (!n) return ''
  if (n.length <= 4) return '•'.repeat(n.length)
  return '•'.repeat(Math.min(n.length - 4, 8)) + n.slice(-4)
}
