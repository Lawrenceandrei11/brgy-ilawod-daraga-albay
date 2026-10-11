/**
 * What the ID check should be showing, now that the reader is Gemini.
 *
 * The in-browser OCR this file used to drive is gone -- with it went
 * tesseract, 25.7 MB of language data and the second reader that fought with
 * the first. One reader now, and it runs only when the resident asks for it.
 *
 * ---------------------------------------------------------------------------
 * What is actually being verified
 *
 * It depends entirely on who typed the number, and that distinction is the
 * whole point of this file:
 *
 *   the field was EMPTY     the reader fills it. Nothing is verified -- the
 *                           number came out of the photograph, so comparing
 *                           it to the photograph proves nothing.
 *
 *   the resident TYPED it   the reader does not overwrite it. It compares.
 *                           Two independent readings of one card -- a person
 *                           and a model -- so a match means something and a
 *                           mismatch is evidence.
 *
 * Only a mismatch stops anyone. Everything else goes through to the barangay
 * secretary, flagged, because there is no offline reader left: blocking on
 * "could not read" would mean a flat signal or an outage at Google stops a
 * resident registering at all.
 * ---------------------------------------------------------------------------
 */

import { maskIdNumber, normalizeIdNumber } from './idNumber.js'

/** No reading has been attempted. The resident may simply be typing. */
export const ID_CHECK_IDLE = { status: 'idle', blocking: false, provenance: 'pending_manual' }

/**
 * status is one of:
 *   idle         no read attempted -- the reader is opt-in and manual
 *   reading      a read is in flight
 *   filled       the field was empty and the reader filled it (NOT verified)
 *   match        the resident typed it and the reader agrees
 *   mismatch     the resident typed it and the reader disagrees  -> blocks
 *   unread       the reader ran but found no number on the card
 *   unavailable  the reader could not run at all
 *
 * `provenance` is what gets written to profiles.id_verification.
 *
 * Note what is NOT here: `auto_verified`. A match is decided in the browser,
 * and the server cannot tell a real match from a crafted request claiming one
 * -- guard_profile_columns refuses it from a resident for exactly that
 * reason. So a match is reported to the resident as good news and recorded as
 * still needing a human. Being honest about that is cheap; pretending
 * otherwise would put a "verified" badge in front of the secretary that no
 * one had earned.
 */
export function idVerdict({ typed, read, status } = {}) {
  if (status === 'reading') return { status: 'reading', blocking: false, provenance: 'pending_manual' }
  if (status === 'unavailable') {
    return { status: 'unavailable', blocking: false, provenance: 'pending_manual' }
  }
  if (status === 'idle' || !status) return ID_CHECK_IDLE

  const theirs = normalizeIdNumber(typed)
  const seen = normalizeIdNumber(read)

  // The reader ran and found nothing to compare or to fill.
  if (!seen) return { status: 'unread', blocking: false, provenance: 'pending_manual' }

  // The field was empty when the reader ran, so this number IS the reading.
  if (!theirs) return { status: 'filled', blocking: false, provenance: 'ai_extracted' }

  if (theirs === seen) {
    return { status: 'match', blocking: false, provenance: 'pending_manual' }
  }

  return {
    status: 'mismatch',
    blocking: true,
    provenance: 'pending_manual',
    readMasked: maskIdNumber(seen),
  }
}

/** A two-or-three word verdict, shown in front of the sentence below. */
export function idCheckLabel(state) {
  switch (state?.status) {
    case 'reading':
      return ''
    case 'match':
      return 'Matches your ID'
    case 'mismatch':
      return 'Does not match'
    case 'filled':
      return 'Read from your ID'
    case 'unread':
      return 'Number not read'
    case 'unavailable':
      return 'Could not check'
    default:
      return ''
  }
}

/** The sentence shown under the ID number field for each state. */
export function idCheckMessage(state) {
  switch (state?.status) {
    case 'reading':
      return 'Reading your ID…'
    case 'match':
      return 'This matches the number on the ID you uploaded. The barangay secretary will still check the document itself.'
    case 'mismatch':
      return `The ID you uploaded shows a number ending ${state.readMasked}, which is not the number you typed. Correct the number, or upload the ID it belongs to.`
    case 'filled':
      return 'This number was read off your uploaded ID, so it has not been checked against anything. Compare it with your card — the barangay secretary will check it too.'
    case 'unread':
      return 'No number could be read on your uploaded ID, so the one you typed has not been checked. The barangay secretary will check it by hand.'
    case 'unavailable':
      return 'The ID could not be read just now, so your number has not been checked. You can carry on — the barangay secretary will check it by hand.'
    default:
      return ''
  }
}
