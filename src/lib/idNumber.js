/**
 * Comparing the ID number a resident typed with the one printed on the ID
 * they uploaded.
 *
 * WHAT THIS IS NOT. It does not check that the ID is genuine, that it has not
 * expired, or that the person uploading it is the person on it. It reads the
 * characters it can see and compares them with what was typed. A forged ID
 * carrying a consistent number passes; a real ID photographed badly fails.
 * The barangay secretary remains the actual check, which is why an uncertain
 * result sends the registration on to manual review instead of blocking it.
 *
 * Nothing here logs. The number is personal data, and OCR text off an ID
 * usually carries a name and address with it, so neither is ever written to
 * the console. maskIdNumber() covers the one case where a number has to be
 * shown back to the resident.
 */

/**
 * Plausibility hints per accepted ID type -- NOT authoritative validation.
 *
 * `lengths` counts letters and digits once separators are stripped. Where a
 * national format has a well-known fixed length it is listed; where the card
 * is issued by an LGU or a school and has no national format, a permissive
 * range stands in.
 *
 * These are used for exactly two things: picking likely numbers out of noisy
 * OCR text, and refusing to call something a mismatch on the strength of a
 * candidate that could not be an ID number at all. An unlisted length never
 * rejects what the resident typed -- it only makes a candidate read off the
 * card weaker, which pushes the result towards manual review, not a block.
 */
export const ID_FORMATS = {
  'Philippine National ID (PhilSys)': { lengths: [16], digitsOnly: true, label: '16 digits' },
  "Driver's License": { lengths: [11, 12, 13], digitsOnly: false, label: 'a letter followed by digits' },
  'UMID / SSS': { lengths: [10, 12], digitsOnly: true, label: '10 or 12 digits' },
  'PhilHealth ID': { lengths: [12], digitsOnly: true, label: '12 digits' },
  Passport: { lengths: [8, 9], digitsOnly: false, label: 'a letter, 7 digits, sometimes a final letter' },
  "Voter's ID": { lengths: [22], digitsOnly: true, label: '22 digits' },
  'Postal ID': { lengths: [12, 13], digitsOnly: false, label: '12 or 13 characters' },
  // Issued locally, with no national format to lean on.
  'Senior Citizen ID': { min: 5, max: 20, digitsOnly: false, label: 'a local reference' },
  'PWD ID': { min: 5, max: 20, digitsOnly: false, label: 'a local reference' },
  'Student ID': { min: 5, max: 20, digitsOnly: false, label: 'a school reference' },
}

/** Shorter than this is too short to be an ID number; longer is a sentence. */
const MIN_CANDIDATE = 5
const MAX_CANDIDATE = 24

/** Floor for OCR confidence, on tesseract's 0-100 scale. */
export const DEFAULT_MIN_CONFIDENCE = 70

/**
 * Letters and digits only, upper-cased. Separators carry no meaning on a card
 * -- "1234-5678" and "1234 5678" are the same number -- so they go. No letter
 * or digit is ever dropped, which is the difference between tolerating
 * formatting and quietly altering the number.
 */
export function normalizeIdNumber(value) {
  if (typeof value !== 'string') return ''
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Characters OCR habitually confuses, folded onto one representative each.
 *
 * This is only ever a second opinion, after an exact comparison has already
 * failed. Folding makes the comparison more forgiving and never less: its
 * only possible effect is to turn a would-be mismatch into a match. That is
 * the right way to err -- a wrong "match" leaves the secretary to catch it,
 * while a wrong "mismatch" turns a real resident away at the door.
 */
const CONFUSABLE = { O: '0', Q: '0', D: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6' }

export function foldConfusables(normalized) {
  let out = ''
  for (const ch of normalized) out += CONFUSABLE[ch] ?? ch
  return out
}

/** "••••6789" -- enough to point at a number without repeating it. */
export function maskIdNumber(value) {
  const n = normalizeIdNumber(value)
  if (!n) return ''
  if (n.length <= 4) return '•'.repeat(n.length)
  return '•'.repeat(Math.min(n.length - 4, 8)) + n.slice(-4)
}

function formatFor(idType) {
  return ID_FORMATS[idType] ?? { min: MIN_CANDIDATE, max: MAX_CANDIDATE, digitsOnly: false, label: '' }
}

/** Could `normalized` be a number of this type, by length and character mix? */
export function isPlausibleFor(normalized, idType) {
  const f = formatFor(idType)
  const n = normalized.length
  if (n < MIN_CANDIDATE || n > MAX_CANDIDATE) return false
  if (f.digitsOnly && /[A-Z]/.test(normalized)) return false
  if (f.lengths) return f.lengths.includes(n)
  return n >= (f.min ?? MIN_CANDIDATE) && n <= (f.max ?? MAX_CANDIDATE)
}

/**
 * Pull every run that could be an ID number out of OCR text.
 *
 * Runs of letters and digits are joined across the separators a card prints
 * them with -- spaces, hyphens, en dashes -- so "1234 5678 9012" is seen as
 * one twelve-character number rather than three short ones. Both readings are
 * kept, because OCR sometimes drops a separator and sometimes invents one,
 * and the caller only needs any single candidate to match.
 */
export function extractCandidates(text, idType) {
  if (typeof text !== 'string' || !text) return []

  const seen = new Map()
  const add = (raw) => {
    const norm = normalizeIdNumber(raw)
    if (norm.length < MIN_CANDIDATE || norm.length > MAX_CANDIDATE) return
    const plausible = isPlausibleFor(norm, idType)
    const prev = seen.get(norm)
    if (!prev || (plausible && !prev.plausible)) seen.set(norm, { value: norm, plausible })
  }

  // Line by line, so a number is never stitched together out of two lines.
  for (const line of text.split(/[\r\n]+/)) {
    const runs = [...line.matchAll(/[A-Za-z0-9]+/g)].map((m) => ({
      text: m[0],
      start: m.index,
      end: m.index + m[0].length,
    }))

    // Each run alone, then each run joined with the ones that follow it, so
    // "PCN 1234 5678 9012 3456" yields the sixteen digits as well as the four
    // groups. The join stops as soon as the gap is something other than
    // spaces or a dash, which is what keeps neighbouring words out of it.
    for (let i = 0; i < runs.length; i++) {
      let joined = ''
      for (let j = i; j < runs.length && j - i < 6; j++) {
        if (j > i && !/^[ \t‐-―-]+$/.test(line.slice(runs[j - 1].end, runs[j].start))) break
        joined += runs[j].text
        add(joined)
      }
    }
  }

  return [...seen.values()]
}

/** Lowest confidence among the tokens that look like they built `candidate`. */
function confidenceFor(candidate, tokens, fallback) {
  if (!Array.isArray(tokens) || tokens.length === 0) return fallback
  const contributing = tokens.filter((t) => {
    const n = normalizeIdNumber(t?.text)
    return n.length >= 2 && candidate.includes(n)
  })
  if (contributing.length === 0) return fallback
  return Math.min(
    ...contributing.map((t) => (typeof t.confidence === 'number' ? t.confidence : fallback)),
  )
}

/**
 * Decide what the uploaded document says about the number that was typed.
 *
 * Outcomes:
 *   skipped    nothing to compare yet (too little typed)
 *   match      a number on the card equals what was typed
 *   mismatch   a number was read confidently and none of them is the typed one
 *   uncertain  unreadable, too faint, or several possible numbers and none match
 *
 * Only `mismatch` may stop a registration. Everything else belongs in front
 * of the secretary.
 */
export function compareIdNumber({
  entered,
  ocr,
  idType,
  minConfidence = DEFAULT_MIN_CONFIDENCE,
} = {}) {
  const typed = normalizeIdNumber(entered)
  if (typed.length < MIN_CANDIDATE) return { outcome: 'skipped', reason: 'nothing-entered' }

  if (!ocr || typeof ocr.text !== 'string' || normalizeIdNumber(ocr.text).length === 0) {
    return { outcome: 'uncertain', reason: 'no-text' }
  }

  const overall = typeof ocr.confidence === 'number' ? ocr.confidence : 0
  const tokens = ocr.tokens
  const candidates = extractCandidates(ocr.text, idType)
  if (candidates.length === 0) return { outcome: 'uncertain', reason: 'no-candidate' }

  // An exact reading of the typed number settles it.
  const exact = candidates.find((c) => c.value === typed)
  if (exact) {
    return { outcome: 'match', how: 'exact', confidence: confidenceFor(exact.value, tokens, overall) }
  }

  // Then the same number, allowing for characters OCR confuses.
  const typedFolded = foldConfusables(typed)
  const lookalike = candidates.find((c) => foldConfusables(c.value) === typedFolded)
  if (lookalike) {
    return {
      outcome: 'match',
      how: 'lookalike',
      confidence: confidenceFor(lookalike.value, tokens, overall),
    }
  }

  // Nothing matched. Only a confident, plausible, unambiguous reading may block.
  const plausible = candidates.filter((c) => c.plausible)
  if (plausible.length === 0) return { outcome: 'uncertain', reason: 'no-plausible-candidate' }

  const best = Math.max(...plausible.map((c) => confidenceFor(c.value, tokens, overall)))
  if (best < minConfidence) return { outcome: 'uncertain', reason: 'low-confidence', confidence: best }

  const distinct = new Set(plausible.map((c) => foldConfusables(c.value)))
  if (distinct.size > 1) {
    return { outcome: 'uncertain', reason: 'multiple-candidates', candidateCount: distinct.size }
  }

  return {
    outcome: 'mismatch',
    confidence: best,
    // Masked: enough for the resident to see which number was read, without
    // the value itself travelling anywhere whole.
    readMasked: maskIdNumber(plausible[0].value),
  }
}
