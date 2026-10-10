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
 *
 * ---------------------------------------------------------------------------
 * What may continue, and why
 *
 * Exactly one outcome continues: an EXACT match of the typed number against a
 * number read from the document, after normalisation that cannot change which
 * number is meant -- case, spaces and hyphens.
 *
 * Everything else holds the resident on step 1. "We could not tell" is not
 * permission, and neither is "we could not look". That includes the two cases
 * that used to pass as unverified:
 *
 *   failed      the OCR engine could not run here, or the read timed out
 *   pdf-manual  the PDF could not be rendered, so there was no image to read
 *
 * Both mean the number was never checked against anything, so under a strict
 * gate neither may proceed. The limitation is real and is stated on screen: a
 * resident whose device cannot run the engine, or whose only document is a PDF
 * this flow cannot render, must upload a PHOTOGRAPH of the ID instead. There
 * is no other supported path on this step.
 *
 * The secretary is still the final authority -- registration lands as
 * `pending`, and only staff-only approve_resident() changes that -- but this
 * step no longer leans on that to excuse an unchecked number.
 * ---------------------------------------------------------------------------
 */

import { compareIdNumber } from './idNumber.js'

/** No file chosen yet. The form's own "ID is required" rule covers this. */
export const ID_CHECK_IDLE = { status: 'idle', blocking: false, ready: true }

/**
 * status is one of:
 *   idle         no file yet
 *   reading      OCR is working on the current file
 *   too-short    a file is present but the typed number is too short to compare
 *   unsupported  the file failed the upload rules
 *   failed       the engine could not run here, or the read timed out
 *   pdf-manual   the PDF could not be rendered
 *   match        the number on the document is the number typed
 *   mismatch     a number was read confidently and it is not the one typed
 *   uncertain    unreadable, faint, or several candidates and none match
 *
 * `blocking` is true for every outcome that did not establish an exact match.
 *
 * `ready` is false only while a read is in flight, and it is a different idea
 * from `blocking`: it does not mean "refuse", it means "no answer yet". The
 * two have to be separate, because treating "no answer yet" as permission to
 * continue is a hole -- the resident presses Continue during the read and the
 * mismatch verdict arrives after they have already left the step. A read can
 * take twenty seconds on a scanned PDF, so this is not a narrow race.
 */
export function idCheckState({ file, entered, idType, read, minConfidence } = {}) {
  if (!file) return ID_CHECK_IDLE

  // A read from a previous file tells us nothing about this one.
  if (!read || read.file !== file) return { status: 'reading', blocking: false, ready: false }
  if (read.status === 'reading') return { status: 'reading', blocking: false, ready: false }

  const result = read.result
  if (!result) return { status: 'reading', blocking: false, ready: false }

  if (result.ok === false) {
    // The file itself was refused. Nothing was read, so nothing is verified.
    if (result.reason === 'unsupported') {
      return { status: 'unsupported', blocking: true, ready: true, message: result.message }
    }
    if (result.reason === 'aborted') return { status: 'reading', blocking: false, ready: false }
    // A PDF that could not be rendered gets its own state, so the resident is
    // told what actually happened rather than a generic "could not check".
    if (result.reason === 'pdf-unreadable') {
      return { status: 'pdf-manual', blocking: true, ready: true }
    }
    return { status: 'failed', blocking: true, ready: true, message: result.message }
  }

  const decision = compareIdNumber({ entered, ocr: result, idType, minConfidence })

  // A number too short to compare once punctuation is stripped. The form asks
  // for five characters AFTER trimming, but the comparison needs five after
  // normalising, and normalising removes every non-alphanumeric -- so "12-34"
  // satisfied the form and was never checked against anything. It used to fall
  // through to the idle state, which looks exactly like "no file yet" and let
  // the resident continue with no verification at all.
  if (decision.outcome === 'skipped') {
    return { status: 'too-short', blocking: true, ready: true }
  }

  if (decision.outcome === 'match') {
    return {
      status: 'match',
      blocking: false,
      ready: true,
      how: decision.how,
      confidence: decision.confidence,
    }
  }

  if (decision.outcome === 'mismatch') {
    return {
      status: 'mismatch',
      blocking: true,
      ready: true,
      confidence: decision.confidence,
      readMasked: decision.readMasked,
    }
  }

  // Unreadable, faint, or several plausible candidates and none of them the
  // typed number. The document was legible enough to attempt, so a sharper
  // photograph is a real remedy -- unlike `failed` and `pdf-manual`, where
  // there was nothing to read in the first place.
  return { status: 'uncertain', blocking: true, ready: true, reason: decision.reason }
}

/**
 * A two-or-three word verdict, shown in front of the sentence below.
 *
 * The sentence alone was doing too much work: "we could not read this" and
 * "this matches" are different colours and different icons, but a resident
 * skimming a form reads neither. Only `match` is allowed to say anything that
 * sounds like a pass, and every outcome that did not establish a match says so
 * in the same two words, so an uncertain result cannot be mistaken for a
 * verified one.
 */
export function idCheckLabel(state) {
  switch (state?.status) {
    // No tag while reading: the sentence beside it already says "Checking the
    // number against your uploaded ID", and "Checking · Checking..." is the
    // kind of thing that survives review by being too small to notice.
    case 'reading':
      return ''
    case 'match':
      return 'Matches your ID'
    case 'mismatch':
      return 'Does not match'
    case 'uncertain':
      return 'Could not read'
    case 'too-short':
      return 'Incomplete'
    case 'unsupported':
      return 'Cannot be used'
    // Neither of these proceeds any more. The number was never read, so there
    // is nothing to say about it except that it could not be checked.
    case 'failed':
    case 'pdf-manual':
      return 'Could not check'
    default:
      return ''
  }
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
      return 'We could not read the number on your uploaded ID clearly enough to check it. Upload a sharper, well-lit photo with the whole ID in frame, or check the number you typed.'
    case 'too-short':
      return 'Type the ID number in full, as printed on the ID, so it can be checked against the photo you uploaded.'
    case 'unsupported':
      return state.message ?? 'Upload a PNG, JPEG, WEBP or PDF of your ID.'
    case 'pdf-manual':
      return 'We could not open this PDF to read the number, so it has not been checked. Upload a clear photo of the ID instead — a photograph is the only format this step can check.'
    case 'failed':
      return 'The ID check could not finish on this device, so your number has not been checked. Try again, or open this page in another browser or on another phone — the number has to be checked here before the next step.'
    default:
      return ''
  }
}
