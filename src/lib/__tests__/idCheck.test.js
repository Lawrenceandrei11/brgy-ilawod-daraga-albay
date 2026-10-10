/**
 * The state the ID check shows, and -- the part that matters -- when a
 * previous result stops counting.
 *
 * Synthetic throughout. No OCR engine runs here and no real ID is used; the
 * engine's output is supplied directly, which is the whole point of keeping
 * idCheckState() pure.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { ID_CHECK_IDLE, idCheckLabel, idCheckMessage, idCheckState } from '../idCheck.js'
import { MAX_ID_BYTES } from '../idFile.js'

const PCN = '1234567890123456'
const idType = 'Philippine National ID (PhilSys)'

/** Two distinct file objects, as a resident swapping uploads would produce. */
const fileA = { name: 'id-a.png', type: 'image/png', size: 2048 }
const fileB = { name: 'id-b.jpg', type: 'image/jpeg', size: 4096 }
const pdfFile = { name: 'id.pdf', type: 'application/pdf', size: 8192 }

const ocrOf = (number, confidence = 93) => {
  const text = `PHILIPPINE IDENTIFICATION CARD\nPCN ${number}\nDELA CRUZ, JUAN`
  return {
    ok: true,
    text,
    confidence,
    tokens: text.split(/\s+/).map((t) => ({ text: t, confidence })),
  }
}
const doneWith = (file, result) => ({ file, status: 'done', result })

// ------------------------------------------------------------------- basics

test('no file means nothing to say', () => {
  assert.deepEqual(idCheckState({ file: null, entered: PCN, idType }), ID_CHECK_IDLE)
})

test('a file with no read yet is reading, and never blocking', () => {
  const s = idCheckState({ file: fileA, entered: PCN, idType, read: null })
  assert.equal(s.status, 'reading')
  assert.equal(s.blocking, false)
})

test('an exact match reports a match and does not block', () => {
  const s = idCheckState({ file: fileA, entered: PCN, idType, read: doneWith(fileA, ocrOf('1234 5678 9012 3456')) })
  assert.equal(s.status, 'match')
  assert.equal(s.blocking, false)
})

test('a confident mismatch is the only state that blocks', () => {
  const s = idCheckState({
    file: fileA,
    entered: PCN,
    idType,
    read: doneWith(fileA, ocrOf('9999 8888 7777 6666')),
  })
  assert.equal(s.status, 'mismatch')
  assert.equal(s.blocking, true)
  assert.equal(s.readMasked, '••••••••6666')
})

test('low confidence is uncertain and now BLOCKS', () => {
  const s = idCheckState({
    file: fileA,
    entered: PCN,
    idType,
    read: doneWith(fileA, ocrOf('9999 8888 7777 6666', 38)),
  })
  assert.equal(s.status, 'uncertain')
  assert.equal(s.blocking, true, 'a number we could not read is not a number we checked')
})

test('an engine that cannot run BLOCKS: nothing was checked', () => {
  const s = idCheckState({
    file: fileA,
    entered: PCN,
    idType,
    read: doneWith(fileA, { ok: false, reason: 'engine-failed', message: 'no' }),
  })
  assert.equal(s.status, 'failed')
  assert.equal(s.blocking, true, 'no read happened, so there is nothing to proceed on')
  assert.equal(s.ready, true, 'but it is a settled answer, not a wait')
  assert.equal(s.unverified, undefined, 'nothing proceeds as unverified any more')
})

test('a PDF that could not be rendered BLOCKS, and asks for a photo instead', () => {
  const s = idCheckState({
    file: pdfFile,
    entered: PCN,
    idType,
    read: doneWith(pdfFile, { ok: false, reason: 'pdf-unreadable' }),
  })
  assert.equal(s.status, 'pdf-manual')
  assert.equal(s.blocking, true, 'an unreadable PDF must not bypass the gate')
  assert.equal(s.unverified, undefined)
  const msg = idCheckMessage(s)
  // It must say the check did not happen, and must not imply a match.
  assert.match(msg, /not been checked/i)
  assert.match(msg, /photo/i, 'must name the one supported way forward')
  assert.ok(!/match/i.test(msg), 'must never suggest the number matched')
  assert.ok(!/carry on|you can continue|secretary/i.test(msg), 'must not offer a way past')
})

test('an aborted read is still just reading', () => {
  const s = idCheckState({
    file: fileA,
    entered: PCN,
    idType,
    read: doneWith(fileA, { ok: false, reason: 'aborted' }),
  })
  assert.equal(s.status, 'reading')
  assert.equal(s.blocking, false)
})

test('an unsupported file reports the existing upload wording and BLOCKS', () => {
  // One object, not two look-alikes: the read is tied to the file by identity.
  const gif = { name: 'x.gif', type: 'image/gif', size: 10 }
  const s = idCheckState({
    file: gif,
    entered: PCN,
    idType,
    read: doneWith(gif, {
      ok: false,
      reason: 'unsupported',
      message: 'Upload a PNG, JPEG, WEBP or PDF.',
    }),
  })
  assert.equal(s.status, 'unsupported')
  assert.equal(s.blocking, true, 'a refused file verifies nothing')
  assert.equal(s.message, 'Upload a PNG, JPEG, WEBP or PDF.')
})

test('an oversized file reports the size message', () => {
  const big = { name: 'huge.png', type: 'image/png', size: MAX_ID_BYTES + 1 }
  const s = idCheckState({
    file: big,
    entered: PCN,
    idType,
    read: doneWith(big, {
      ok: false,
      reason: 'unsupported',
      message: 'That file is larger than 5 MB. Try a smaller photo.',
    }),
  })
  assert.equal(s.status, 'unsupported')
  assert.match(s.message, /larger than 5 MB/)
})

// ------------------------------------------------- invalidation: the key rule

test('a read belongs to its file: swapping the file discards the old match', () => {
  const read = doneWith(fileA, ocrOf('1234 5678 9012 3456'))
  // Same read object, but the form now holds a different file.
  assert.equal(idCheckState({ file: fileA, entered: PCN, idType, read }).status, 'match')
  const after = idCheckState({ file: fileB, entered: PCN, idType, read })
  assert.equal(after.status, 'reading', 'the previous match must not carry over')
  assert.equal(after.blocking, false)
})

test('swapping the file cannot carry a block over either', () => {
  const read = doneWith(fileA, ocrOf('9999 8888 7777 6666'))
  assert.equal(idCheckState({ file: fileA, entered: PCN, idType, read }).blocking, true)
  assert.equal(idCheckState({ file: fileB, entered: PCN, idType, read }).blocking, false)
})

test('editing the number re-decides against the same read', () => {
  const read = doneWith(fileA, ocrOf('1234 5678 9012 3456'))
  assert.equal(idCheckState({ file: fileA, entered: PCN, idType, read }).status, 'match')
  // One digit changed after the match.
  const edited = idCheckState({ file: fileA, entered: '1234567890123457', idType, read })
  assert.equal(edited.status, 'mismatch')
  assert.equal(edited.blocking, true)
})

test('clearing the number drops the old match and blocks, rather than going idle', () => {
  // It used to return ID_CHECK_IDLE here, which is the same shape as "no file
  // chosen yet" -- not blocking. With a document on file and nothing typed,
  // there is nothing to compare, and that must not read as permission.
  const read = doneWith(fileA, ocrOf('1234 5678 9012 3456'))
  assert.equal(idCheckState({ file: fileA, entered: PCN, idType, read }).status, 'match')
  const cleared = idCheckState({ file: fileA, entered: '', idType, read })
  assert.equal(cleared.status, 'too-short')
  assert.equal(cleared.blocking, true)
  assert.equal(cleared.ready, true)
})

test('changing the ID type re-decides, because plausibility depends on it', () => {
  // 12 digits: right for PhilHealth, impossible for a 16-digit PhilSys.
  const read = doneWith(fileA, ocrOf('9999 8888 7777'))
  const asPhilHealth = idCheckState({
    file: fileA,
    entered: '123456789012',
    idType: 'PhilHealth ID',
    read,
  })
  assert.equal(asPhilHealth.status, 'mismatch')
  const asPhilSys = idCheckState({ file: fileA, entered: PCN, idType, read })
  assert.equal(asPhilSys.status, 'uncertain')
  assert.equal(asPhilSys.blocking, true)
})

// --------------------------------------------------------------- PDF vs image

test('a PDF read decides exactly as the same text from an image would', () => {
  const text = ocrOf('1234 5678 9012 3456')
  const fromPdf = idCheckState({ file: pdfFile, entered: PCN, idType, read: doneWith(pdfFile, text) })
  const fromImg = idCheckState({ file: fileA, entered: PCN, idType, read: doneWith(fileA, text) })
  assert.equal(fromPdf.status, 'match')
  assert.equal(fromImg.status, 'match')
})

test('a PDF mismatch blocks the same way an image mismatch does', () => {
  const s = idCheckState({
    file: pdfFile,
    entered: PCN,
    idType,
    read: doneWith(pdfFile, ocrOf('9999 8888 7777 6666')),
  })
  assert.equal(s.status, 'mismatch')
  assert.equal(s.blocking, true)
})

// ------------------------------------------------- what the resident is told

test('only the mismatch message is an alert, and it never quotes the number whole', () => {
  const mismatch = idCheckState({
    file: fileA,
    entered: PCN,
    idType,
    read: doneWith(fileA, ocrOf('9999 8888 7777 6666')),
  })
  const msg = idCheckMessage(mismatch)
  assert.match(msg, /not the number you typed/)
  assert.match(msg, /••••/)
  assert.ok(!/9999/.test(msg), 'the read number must not appear in full')
})

test('every state has something to say except idle', () => {
  assert.equal(idCheckMessage(ID_CHECK_IDLE), '')
  for (const status of ['reading', 'match', 'uncertain', 'failed']) {
    assert.ok(idCheckMessage({ status }).length > 0, status)
  }
})

test('the uncertain message is a refusal, and says how to resolve it', () => {
  const msg = idCheckMessage({ status: 'uncertain' })
  // It must offer the two real remedies and must NOT invite them onward.
  assert.match(msg, /sharper/i)
  assert.match(msg, /check the number you typed/i)
  assert.ok(!/carry on|you can continue/i.test(msg), 'must not invite the resident past it')
  assert.ok(!/secretary/i.test(msg), 'this one is fixable here, not by the secretary')
})

// ---------------------------------------------------------- regression: the
// "no answer yet" hole
//
// Reported defect: typing a wrong number, uploading a document showing a
// clearly different one, and pressing Continue advanced to step 2 anyway. The
// cause was not the comparison -- that correctly said mismatch, confidence 95
// -- but that the step did not wait for it. `blocking` was false during the
// read, and false was being read as "fine to proceed".

test('a read in flight is NOT ready, so the step cannot be stepped past', () => {
  // No read yet at all.
  const fresh = idCheckState({ file: fileA, entered: PCN, idType, read: null })
  assert.equal(fresh.status, 'reading')
  assert.equal(fresh.ready, false)
  assert.equal(fresh.blocking, false, 'reading is not a refusal')

  // A read that has started but not finished.
  const started = idCheckState({
    file: fileA,
    entered: PCN,
    idType,
    read: { file: fileA, status: 'reading', result: null },
  })
  assert.equal(started.ready, false)

  // A read belonging to the PREVIOUS file, which is the reported scenario:
  // the resident swapped the document and pressed on immediately.
  const stale = idCheckState({
    file: fileB,
    entered: PCN,
    idType,
    read: doneWith(fileA, ocrOf('1234 5678 9012 3456')),
  })
  assert.equal(stale.status, 'reading')
  assert.equal(stale.ready, false, 'a stale read must not let the step through')
})

test('every settled outcome is ready, so the resident is never stuck', () => {
  const settled = [
    ID_CHECK_IDLE,
    idCheckState({ file: fileA, entered: PCN, idType, read: doneWith(fileA, ocrOf('1234 5678 9012 3456')) }),
    idCheckState({ file: fileA, entered: PCN, idType, read: doneWith(fileA, ocrOf('9999 8888 7777 6666')) }),
    idCheckState({ file: fileA, entered: PCN, idType, read: doneWith(fileA, ocrOf('9999 8888 7777 6666', 30)) }),
    idCheckState({ file: fileA, entered: PCN, idType, read: doneWith(fileA, { ok: false, reason: 'engine-failed' }) }),
    idCheckState({ file: pdfFile, entered: PCN, idType, read: doneWith(pdfFile, { ok: false, reason: 'pdf-unreadable' }) }),
  ]
  for (const s of settled) {
    assert.equal(s.ready, true, `${s.status} must be ready`)
  }
  // Everything that did not establish a match refuses, except the two where
  // no read was possible at all.
  assert.deepEqual(
    settled.filter((s) => s.blocking).map((s) => s.status),
    ['mismatch', 'uncertain', 'failed', 'pdf-manual'],
  )
  assert.deepEqual(
    settled.filter((s) => s.unverified).map((s) => s.status),
    [],
    'nothing proceeds as unverified any more',
  )
})

test('the exact reported case: wrong number, readable document, mismatch that blocks', () => {
  // The document says ...9012; the resident typed ...4444.
  const read = doneWith(fileA, ocrOf('5555 1234 5678 9012'))
  const s = idCheckState({ file: fileA, entered: '1111-2222-3333-4444', idType, read })
  assert.equal(s.status, 'mismatch')
  assert.equal(s.blocking, true)
  assert.equal(s.ready, true)
  assert.equal(s.readMasked, '••••••••9012')
})

test('no outcome but a match is ever labelled as one', () => {
  const uncertain = idCheckState({
    file: fileA,
    entered: PCN,
    idType,
    read: doneWith(fileA, ocrOf('9999 8888 7777 6666', 30)),
  })
  assert.equal(uncertain.status, 'uncertain')
  assert.equal(idCheckLabel(uncertain), 'Could not read')
  // The two that proceed say plainly that nothing was verified, so neither can
  // be skimmed as a pass.
  assert.equal(idCheckLabel({ status: 'failed' }), 'Could not check')
  assert.equal(idCheckLabel({ status: 'pdf-manual' }), 'Could not check')
  assert.equal(idCheckLabel({ status: 'too-short' }), 'Incomplete')
  assert.equal(idCheckLabel({ status: 'unsupported' }), 'Cannot be used')
  // And only a real match may say so.
  assert.equal(idCheckLabel({ status: 'match' }), 'Matches your ID')
  assert.equal(idCheckLabel({ status: 'mismatch' }), 'Does not match')
  for (const status of ['uncertain', 'failed', 'pdf-manual', 'mismatch', 'reading']) {
    assert.ok(
      !/^Matches/.test(idCheckLabel({ status })),
      `${status} must not read as a pass`,
    )
  }
})

// ---------------------------------------------------------------------------
// Regression: the reported bypass
//
// "A user can proceed with registration even when the entered ID number is
// incorrect, as long as they upload a valid ID photo."
//
// The comparison was never at fault. The policy was: only a CONFIDENT mismatch
// blocked, so a wrong number plus a photograph OCR could not read clearly came
// out as `uncertain`, which let the resident through with the number never
// checked against anything. These tests pin the new policy down.
// ---------------------------------------------------------------------------

test('BYPASS: a wrong number with an unreadable photo no longer proceeds', () => {
  // The document is legible enough to attempt but too faint to be confident.
  const s = idCheckState({
    file: fileA,
    entered: PCN,
    idType,
    read: doneWith(fileA, ocrOf('9999 8888 7777 6666', 20)),
  })
  assert.equal(s.status, 'uncertain')
  assert.equal(s.blocking, true, 'this is the exact hole that was reported')
  assert.equal(s.ready, true, 'and it is a verdict, not a wait')
})

test('BYPASS: a wrong number with nothing readable at all no longer proceeds', () => {
  for (const text of ['', '   ', 'no digits here at all']) {
    const s = idCheckState({ file: fileA, entered: PCN, idType, read: doneWith(fileA, ocrOf(text)) })
    assert.equal(s.blocking, true, `"${text}" must not let a wrong number through`)
  }
})

test('every uncertain reason blocks, not just the faint ones', () => {
  const reads = {
    'no-text': ocrOf(''),
    'no-candidate': ocrOf('NAME ONLY, NO NUMBERS'),
    'low-confidence': ocrOf('9999 8888 7777 6666', 20),
  }
  for (const [reason, read] of Object.entries(reads)) {
    const s = idCheckState({ file: fileA, entered: PCN, idType, read: doneWith(fileA, read) })
    assert.equal(s.blocking, true, `${reason} must block`)
    assert.notEqual(s.status, 'match', `${reason} must never report a match`)
  }
})

// ------------------------------------------------- matches still get through

test('a correct number proceeds, but ONLY on an exact match', () => {
  const exact = idCheckState({
    file: fileA,
    entered: PCN,
    idType,
    read: doneWith(fileA, ocrOf('1234 5678 9012 3456')),
  })
  assert.equal(exact.status, 'match')
  assert.equal(exact.blocking, false)

  // Formatting differences are harmless and still match: the number means
  // the same thing with or without spaces, hyphens and case.
  for (const typed of ['1234-5678-9012-3456', '1234 5678 9012 3456', '1234567890123456']) {
    const s = idCheckState({
      file: fileA,
      entered: typed,
      idType,
      read: doneWith(fileA, ocrOf('1234 5678 9012 3456')),
    })
    assert.equal(s.status, 'match', typed + ' is the same number, formatted differently')
  }

  // Confusable characters are NOT formatting. A document read as "I234..."
  // is not proof that the resident's "1234..." is the number printed on it,
  // so this must no longer pass.
  const lookalike = idCheckState({
    file: fileA,
    entered: PCN,
    idType,
    read: doneWith(fileA, ocrOf('I234 S678 9O12 3456')),
  })
  assert.notEqual(lookalike.status, 'match', 'a folded near-match is not a match')
  assert.equal(lookalike.blocking, true)
})

// --------------------------------------- no read was possible: manual review

test('both no-read outcomes BLOCK, and neither claims a match', () => {
  const failed = idCheckState({
    file: fileA,
    entered: PCN,
    idType,
    read: doneWith(fileA, { ok: false, reason: 'engine-failed' }),
  })
  const pdf = idCheckState({
    file: pdfFile,
    entered: PCN,
    idType,
    read: doneWith(pdfFile, { ok: false, reason: 'pdf-unreadable' }),
  })

  for (const s of [failed, pdf]) {
    assert.equal(s.blocking, true, s.status + ' must not bypass the gate')
    assert.equal(s.ready, true, s.status + ' is a settled answer')
    assert.equal(s.unverified, undefined)
    assert.equal(idCheckLabel(s), 'Could not check')
    const msg = idCheckMessage(s)
    assert.match(msg, /not been checked/i)
    assert.ok(!/matches/i.test(msg), 'must never read as a pass')
    assert.ok(!/carry on|you can continue/i.test(msg), 'must not invite them onward')
  }

  // The PDF case has to name the one supported alternative.
  assert.match(idCheckMessage(pdf), /photo/i)
})

// ------------------------------------------- the normalised short-number gap

test('GAP: a number that passes the form but normalises too short is refused', () => {
  // step1Schema requires five characters after TRIMMING; the comparison needs
  // five after NORMALISING, and normalising strips every non-alphanumeric. So
  // "12-34" satisfied the form, compared as nothing, and fell through to the
  // idle state -- which is the same shape as "no file yet", and not blocking.
  const read = doneWith(fileA, ocrOf('1234 5678 9012 3456'))
  for (const entered of ['1234-', '12-34', 'AB-12', '1-2-3-4', '  12 ']) {
    const s = idCheckState({ file: fileA, entered, idType, read })
    assert.equal(s.status, 'too-short', `${entered} must not skip the check`)
    assert.equal(s.blocking, true, `${entered} must not proceed`)
    assert.equal(s.ready, true, 'it is a verdict, not a wait')
    assert.match(idCheckMessage(s), /in full/i)
  }
})

test('with no file at all the check stays idle, so the form owns that error', () => {
  // Unchanged on purpose: "upload an ID" is the file field's message, not this
  // one's, and Register refuses an empty file before consulting the check.
  assert.deepEqual(idCheckState({ entered: '12', idType }), ID_CHECK_IDLE)
  assert.equal(ID_CHECK_IDLE.blocking, false)
})

// ----------------------------------- pressing Continue before the read lands

test('a read still in flight is never ready, whatever the typed number', () => {
  for (const entered of ['', PCN, '9999999999999999', '12-34']) {
    const noRead = idCheckState({ file: fileA, entered, idType })
    assert.equal(noRead.ready, false, 'no read yet')
    assert.equal(noRead.status, 'reading')

    const inFlight = idCheckState({ file: fileA, entered, idType, read: { file: fileA, status: 'reading' } })
    assert.equal(inFlight.ready, false, 'read in progress')

    const stale = idCheckState({ file: fileA, entered, idType, read: doneWith(fileB, ocrOf('1234 5678 9012 3456')) })
    assert.equal(stale.ready, false, 'a read of a different file is no answer at all')
  }
})

test('the policy, as one table', () => {
  // Exactly one status proceeds. Everything else holds the resident here.
  const proceeds = ['match']
  const blocks = [
    'mismatch',
    'uncertain',
    'too-short',
    'unsupported',
    'failed',
    'pdf-manual',
  ]

  const PASS = idCheckLabel({ status: 'match' })

  for (const status of blocks) {
    const label = idCheckLabel({ status })
    // Only a real match may wear the match label, or open with "Matches".
    // "Does not match" is fine -- it contains the word and denies it.
    assert.notEqual(label, PASS, status + ' must not wear the match label')
    assert.ok(!/^matches/i.test(label), status + ' must not read as a pass')

    const msg = idCheckMessage({ status, readMasked: '••3456' })
    assert.ok(msg.length > 20, status + ' needs a usable message')
    assert.ok(
      !/carry on|you can continue/i.test(msg),
      status + ' blocks, so it must not invite the resident onward',
    )
  }

  assert.equal(proceeds.length, 1)
  assert.equal(idCheckLabel({ status: 'match' }), 'Matches your ID')
})

// ---------------------------------------------------------------------------
// Strict gate: regressions for every way the step could be reached without a
// verified number. Each of these proceeded at some point in this feature's
// history; none may proceed now.
// ---------------------------------------------------------------------------

test('STRICT: an OCR timeout blocks', () => {
  // A timeout is not its own reason -- readIdDocument catches the rejection
  // from withTimeout() and reports engine-failed, so this is the shape a
  // timed-out read actually arrives in.
  const s = idCheckState({
    file: fileA,
    entered: PCN,
    idType,
    read: doneWith(fileA, { ok: false, reason: 'engine-failed', message: 'OCR startup timed out' }),
  })
  assert.equal(s.status, 'failed')
  assert.equal(s.blocking, true)
  assert.equal(s.ready, true)
})

test('STRICT: nothing but an exact match clears the step', () => {
  const read = doneWith(fileA, ocrOf('1234 5678 9012 3456'))
  const outcomes = [
    // right number, right document
    [idCheckState({ file: fileA, entered: PCN, idType, read }), false],
    // wrong number, same document
    [idCheckState({ file: fileA, entered: '9999888877776666', idType, read }), true],
    // right number, unreadable document
    [idCheckState({ file: fileA, entered: PCN, idType, read: doneWith(fileA, ocrOf('')) }), true],
    // right number, engine down
    [idCheckState({ file: fileA, entered: PCN, idType, read: doneWith(fileA, { ok: false, reason: 'engine-failed' }) }), true],
    // right number, PDF that would not render
    [idCheckState({ file: pdfFile, entered: PCN, idType, read: doneWith(pdfFile, { ok: false, reason: 'pdf-unreadable' }) }), true],
    // right number, file type refused
    [idCheckState({ file: fileA, entered: PCN, idType, read: doneWith(fileA, { ok: false, reason: 'unsupported', message: 'no' }) }), true],
    // number too short once punctuation is stripped
    [idCheckState({ file: fileA, entered: '12-34', idType, read }), true],
  ]
  for (const [state, shouldBlock] of outcomes) {
    assert.equal(state.blocking, shouldBlock, `${state.status} blocking should be ${shouldBlock}`)
  }
  // Exactly one of them is a match.
  assert.equal(outcomes.filter(([s]) => s.status === 'match').length, 1)
})

test('STRICT: a lookalike-but-different number is refused, not matched', () => {
  // The document says S1234567; the resident typed 51234567. These fold to the
  // same value and are different passport numbers. Before this change the fold
  // returned a match.
  const s = idCheckState({
    file: fileA,
    entered: '51234567',
    idType: 'Passport',
    read: doneWith(fileA, ocrOf('PASSPORT\nS1234567\nREPUBLIC OF THE PHILIPPINES')),
  })
  assert.notEqual(s.status, 'match')
  assert.equal(s.blocking, true)
})

test('STRICT: harmless formatting is still normalised away', () => {
  // The guarantee that survives: spacing, hyphens and case cannot change which
  // number is meant, so they must not turn a real match into a refusal.
  const read = doneWith(fileA, ocrOf('1234 5678 9012 3456'))
  for (const typed of [
    '1234567890123456',
    '1234-5678-9012-3456',
    '1234 5678 9012 3456',
    '  1234567890123456  ',
  ]) {
    const s = idCheckState({ file: fileA, entered: typed, idType, read })
    assert.equal(s.status, 'match', `${typed} must still match`)
    assert.equal(s.blocking, false)
  }
})
