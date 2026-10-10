/**
 * What the ID check should be showing, given the current inputs and whatever
 * OCR has managed so far.
 *
 * Pure, so the invalidation rules can be tested without a browser or a
 * renderer. The hook in hooks/useIdNumberCheck.js is a thin wrapper and the
 * React effect only ever does one thing: run OCR when the FILE changes.
 *
 * The rule that matters: a result belongs to the file it was read from. When
 * the resident swaps the file, `read.file` no longer matches and the previous
 * outcome is discarded rather than carried over. When they edit the number or
 * the ID type instead, the read still stands but the comparison is redone, so
 * an earlier match cannot survive a changed number.
 */

import { compareIdNumber } from './idNumber.js'

export const ID_CHECK_IDLE = { status: 'idle' }

/**
 * status is one of:
 *   idle         no file yet, or too little typed to compare
 *   reading      OCR is working on the current file
 *   unsupported  the file failed the upload rules
 *   failed       the engine could not run here
 *   match        the number on the document is the number typed
 *   mismatch     a number was read confidently and it is not the one typed
 *   uncertain    unreadable, faint, or several candidates and none match
 *
 * `blocking` is true only for `mismatch`. Nothing else may stop a registration.
 */
export function idCheckState({ file, entered, idType, read, minConfidence } = {}) {
  if (!file) return ID_CHECK_IDLE

  // A read from a previous file tells us nothing about this one.
  if (!read || read.file !== file) return { status: 'reading', blocking: false }
  if (read.status === 'reading') return { status: 'reading', blocking: false }

  const result = read.result
  if (!result) return { status: 'reading', blocking: false }

  if (result.ok === false) {
    if (result.reason === 'unsupported') {
      return { status: 'unsupported', blocking: false, message: result.message }
    }
    if (result.reason === 'aborted') return { status: 'reading', blocking: false }
    // A PDF that could not be rendered gets its own state, so the resident is
    // told what actually happened rather than a generic "could not check".
    if (result.reason === 'pdf-unreadable') {
      return { status: 'pdf-manual', blocking: false }
    }
    return { status: 'failed', blocking: false, message: result.message }
  }

  const decision = compareIdNumber({ entered, ocr: result, idType, minConfidence })

  if (decision.outcome === 'skipped') return ID_CHECK_IDLE
  if (decision.outcome === 'match') {
    return { status: 'match', blocking: false, how: decision.how, confidence: decision.confidence }
  }
  if (decision.outcome === 'mismatch') {
    return {
      status: 'mismatch',
      blocking: true,
      confidence: decision.confidence,
      readMasked: decision.readMasked,
    }
  }
  return { status: 'uncertain', blocking: false, reason: decision.reason }
}

/** The sentence shown under the ID number field for each state. */
export function idCheckMessage(state) {
  switch (state?.status) {
    case 'reading':
      return 'Checking the number against your uploaded ID…'
    case 'match':
      return state.how === 'lookalike'
        ? 'This matches the number on your uploaded ID.'
        : 'This matches the number printed on your uploaded ID.'
    case 'mismatch':
      return `The number on the ID you uploaded ends ${state.readMasked}, which is not the number you typed. Correct the number, or upload the ID it belongs to.`
    case 'uncertain':
      return 'We could not read the number on your ID clearly. You can carry on — the barangay secretary will check it by hand — or upload a sharper photo.'
    case 'pdf-manual':
      return 'We could not read this PDF automatically, so the number has not been checked against it. Your registration can continue — the barangay secretary will open the file and check the number by hand. Uploading a photo of the ID instead lets us check it here.'
    case 'failed':
      return 'We could not check the ID on this device. You can carry on; the barangay secretary will check it by hand.'
    case 'unsupported':
      return state.message ?? 'Upload a PNG, JPEG, WEBP or PDF.'
    default:
      return ''
  }
}
