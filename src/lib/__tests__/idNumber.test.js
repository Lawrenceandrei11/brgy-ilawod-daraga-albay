/**
 * ID-number comparison. Synthetic OCR payloads throughout -- no real ID, no
 * real resident, and no OCR engine is run here. The engine is injected at the
 * call site, so these tests pin the decisions rather than tesseract's output.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_MIN_CONFIDENCE,
  compareIdNumber,
  extractCandidates,
  foldConfusables,
  isPlausibleFor,
  maskIdNumber,
  normalizeIdNumber,
} from '../idNumber.js'
import { MAX_ID_BYTES, validateIdFile } from '../idFile.js'

/** A believable OCR read of a PhilSys card carrying `number`. */
const philsysText = (number) =>
  `REPUBLIKA NG PILIPINAS\nPHILIPPINE IDENTIFICATION CARD\nPCN ${number}\n` +
  `APELYIDO/Last Name\nDELA CRUZ\nMGA PANGALAN/Given Names\nJUAN MIGUEL`

const conf = (text, confidence = 92) => ({
  text,
  confidence,
  tokens: text.split(/\s+/).map((t) => ({ text: t, confidence })),
})

// ---------------------------------------------------------------- normalising

test('normalising keeps every letter and digit and drops only separators', () => {
  assert.equal(normalizeIdNumber('1234-5678-9012-3456'), '1234567890123456')
  assert.equal(normalizeIdNumber('1234 5678 9012 3456'), '1234567890123456')
  assert.equal(normalizeIdNumber('  n01-23-456789 '), 'N0123456789')
  assert.equal(normalizeIdNumber('p1234567a'), 'P1234567A')
  assert.equal(normalizeIdNumber(null), '')
})

test('spaces and hyphens are equivalent, so the same number compares equal', () => {
  const a = normalizeIdNumber('1234-5678-9012-3456')
  const b = normalizeIdNumber('1234 5678 9012 3456')
  const c = normalizeIdNumber('1234567890123456')
  assert.equal(a, b)
  assert.equal(b, c)
})

test('masking never reveals more than the last four', () => {
  assert.equal(maskIdNumber('1234-5678-9012-3456'), '••••••••3456')
  assert.equal(maskIdNumber('123'), '•••')
  assert.equal(maskIdNumber(''), '')
})

// ------------------------------------------------------------ format hinting

test('plausibility follows the ID type, not one fixed length', () => {
  assert.equal(isPlausibleFor('1234567890123456', 'Philippine National ID (PhilSys)'), true)
  assert.equal(isPlausibleFor('123456789012', 'Philippine National ID (PhilSys)'), false)
  assert.equal(isPlausibleFor('123456789012', 'PhilHealth ID'), true)
  assert.equal(isPlausibleFor('1234567890', 'UMID / SSS'), true)
  assert.equal(isPlausibleFor('123456789012', 'UMID / SSS'), true)
  assert.equal(isPlausibleFor('P1234567A', 'Passport'), true)
  // A digits-only type must not accept letters.
  assert.equal(isPlausibleFor('A234567890123456', 'Philippine National ID (PhilSys)'), false)
  // Locally issued types have no national format, so a range applies.
  assert.equal(isPlausibleFor('SC-2026-0199', 'Senior Citizen ID'), true)
  assert.equal(isPlausibleFor('ABC12', 'Student ID'), true)
})

test('candidates are found whether the card prints groups or a solid run', () => {
  const grouped = extractCandidates(philsysText('1234 5678 9012 3456'), 'Philippine National ID (PhilSys)')
  assert.ok(grouped.some((c) => c.value === '1234567890123456' && c.plausible))
  const solid = extractCandidates(philsysText('1234567890123456'), 'Philippine National ID (PhilSys)')
  assert.ok(solid.some((c) => c.value === '1234567890123456' && c.plausible))
  const hyphenated = extractCandidates(philsysText('1234-5678-9012-3456'), 'Philippine National ID (PhilSys)')
  assert.ok(hyphenated.some((c) => c.value === '1234567890123456' && c.plausible))
})

// ------------------------------------------------------------------- matching

test('an exact match lets the registration continue', () => {
  const r = compareIdNumber({
    entered: '1234-5678-9012-3456',
    ocr: conf(philsysText('1234 5678 9012 3456')),
    idType: 'Philippine National ID (PhilSys)',
  })
  assert.equal(r.outcome, 'match')
  assert.equal(r.how, 'exact')
})

test('formatting differences alone are never a mismatch', () => {
  for (const typed of ['1234567890123456', '1234 5678 9012 3456', '1234-5678-9012-3456']) {
    for (const printed of ['1234567890123456', '1234 5678 9012 3456', '1234-5678-9012-3456']) {
      const r = compareIdNumber({
        entered: typed,
        ocr: conf(philsysText(printed)),
        idType: 'Philippine National ID (PhilSys)',
      })
      assert.equal(r.outcome, 'match', `${typed} vs ${printed}`)
    }
  }
})

test('a confident, different number is a mismatch and must block', () => {
  const r = compareIdNumber({
    entered: '1234-5678-9012-3456',
    ocr: conf(philsysText('9999 8888 7777 6666')),
    idType: 'Philippine National ID (PhilSys)',
  })
  assert.equal(r.outcome, 'mismatch')
  assert.ok(r.confidence >= DEFAULT_MIN_CONFIDENCE)
  // The message may show which number was read, but only masked.
  assert.equal(r.readMasked, '••••••••6666')
  assert.ok(!/9999/.test(JSON.stringify(r)), 'the full read number must not be returned')
})

// --------------------------------------------------- OCR ambiguity: 0/O, 1/I

test('0/O and 1/I confusions are treated as the same number', () => {
  assert.equal(foldConfusables('O1I0'), '0110')
  // Typed with letters, printed as digits.
  const r = compareIdNumber({
    entered: 'PO1234I7A',
    ocr: conf('PASSPORT\nP01234 17A\nREPUBLIC OF THE PHILIPPINES'),
    idType: 'Passport',
  })
  assert.equal(r.outcome, 'match')
  assert.equal(r.how, 'lookalike')
})

test('a lookalike fold only ever softens a mismatch, never creates one', () => {
  // Genuinely different digits must still be a mismatch after folding.
  const r = compareIdNumber({
    entered: '1234-5678-9012-3456',
    ocr: conf(philsysText('1234 5678 9012 3457')),
    idType: 'Philippine National ID (PhilSys)',
  })
  assert.equal(r.outcome, 'mismatch')
})

// ------------------------------------------------------------ uncertain cases

test('a blurry, low-confidence read is uncertain, never a mismatch', () => {
  const r = compareIdNumber({
    entered: '1234-5678-9012-3456',
    ocr: conf(philsysText('9999 8888 7777 6666'), 41),
    idType: 'Philippine National ID (PhilSys)',
  })
  assert.equal(r.outcome, 'uncertain')
  assert.equal(r.reason, 'low-confidence')
})

test('unreadable output is uncertain, never a mismatch', () => {
  for (const ocr of [conf(''), conf('~~~ ... ***'), null, undefined, { text: null }]) {
    const r = compareIdNumber({
      entered: '1234-5678-9012-3456',
      ocr,
      idType: 'Philippine National ID (PhilSys)',
    })
    assert.equal(r.outcome, 'uncertain', JSON.stringify(ocr))
  }
})

test('several plausible numbers and none matching is uncertain', () => {
  const text = 'PCN 9999 8888 7777 6666\nOLD PCN 1111 2222 3333 4444'
  const r = compareIdNumber({
    entered: '1234-5678-9012-3456',
    ocr: conf(text),
    idType: 'Philippine National ID (PhilSys)',
  })
  assert.equal(r.outcome, 'uncertain')
  assert.equal(r.reason, 'multiple-candidates')
})

test('but if one of several numbers matches, that is a match', () => {
  const text = 'PCN 1234 5678 9012 3456\nSERIAL 9999 8888 7777 6666'
  const r = compareIdNumber({
    entered: '1234-5678-9012-3456',
    ocr: conf(text),
    idType: 'Philippine National ID (PhilSys)',
  })
  assert.equal(r.outcome, 'match')
})

test('a candidate that cannot be this ID type does not block', () => {
  // A 12-digit run on a card whose numbers are 16 digits: not enough to
  // contradict the resident.
  const r = compareIdNumber({
    entered: '1234-5678-9012-3456',
    ocr: conf('PHILIPPINE IDENTIFICATION CARD\nDATE 123456789012'),
    idType: 'Philippine National ID (PhilSys)',
  })
  assert.equal(r.outcome, 'uncertain')
  assert.equal(r.reason, 'no-plausible-candidate')
})

test('nothing is decided before enough has been typed', () => {
  const r = compareIdNumber({
    entered: '123',
    ocr: conf(philsysText('1234 5678 9012 3456')),
    idType: 'Philippine National ID (PhilSys)',
  })
  assert.equal(r.outcome, 'skipped')
})

// -------------------------------------------------------------- file rules

test('the upload rules accept exactly what the bucket accepts', () => {
  const ok = (type) => validateIdFile({ size: 1024, type })
  assert.equal(ok('image/png'), null)
  assert.equal(ok('image/jpeg'), null)
  assert.equal(ok('image/webp'), null)
  assert.equal(ok('application/pdf'), null)
})

test('unsupported and oversized files are refused with the existing wording', () => {
  assert.equal(
    validateIdFile({ size: 1024, type: 'image/gif' }),
    'Upload a PNG, JPEG, WEBP or PDF.',
  )
  assert.equal(
    validateIdFile({ size: 1024, type: 'application/zip' }),
    'Upload a PNG, JPEG, WEBP or PDF.',
  )
  assert.equal(
    validateIdFile({ size: MAX_ID_BYTES + 1, type: 'image/png' }),
    'That file is larger than 5 MB. Try a smaller photo.',
  )
  assert.equal(validateIdFile(null), 'A photo of your valid ID is required.')
  // Exactly at the limit is still fine.
  assert.equal(validateIdFile({ size: MAX_ID_BYTES, type: 'image/png' }), null)
})

test('size is reported before type, as it was before the refactor', () => {
  assert.equal(
    validateIdFile({ size: MAX_ID_BYTES + 1, type: 'image/gif' }),
    'That file is larger than 5 MB. Try a smaller photo.',
  )
})

// ------------------------------------------- changing the number or the file

test('re-comparing after the typed number changes flips the outcome', () => {
  const ocr = conf(philsysText('1234 5678 9012 3456'))
  const idType = 'Philippine National ID (PhilSys)'
  assert.equal(compareIdNumber({ entered: '1234-5678-9012-3456', ocr, idType }).outcome, 'match')
  // Resident edits a digit after the first successful check.
  assert.equal(compareIdNumber({ entered: '1234-5678-9012-3457', ocr, idType }).outcome, 'mismatch')
})

test('re-comparing after the file changes flips the outcome', () => {
  const entered = '1234-5678-9012-3456'
  const idType = 'Philippine National ID (PhilSys)'
  const first = conf(philsysText('1234 5678 9012 3456'))
  const replaced = conf(philsysText('9999 8888 7777 6666'))
  assert.equal(compareIdNumber({ entered, ocr: first, idType }).outcome, 'match')
  assert.equal(compareIdNumber({ entered, ocr: replaced, idType }).outcome, 'mismatch')
})

test('the decision never depends on which file format the text came from', () => {
  // A PDF rasterised to a page and a photo of the same card produce the same
  // text, so they must produce the same decision.
  const fromImage = conf(philsysText('1234 5678 9012 3456'), 88)
  const fromPdf = conf(philsysText('1234 5678 9012 3456'), 96)
  const idType = 'Philippine National ID (PhilSys)'
  assert.equal(compareIdNumber({ entered: '1234567890123456', ocr: fromImage, idType }).outcome, 'match')
  assert.equal(compareIdNumber({ entered: '1234567890123456', ocr: fromPdf, idType }).outcome, 'match')
})
