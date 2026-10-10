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

test('low confidence is uncertain and lets the resident through', () => {
  const s = idCheckState({
    file: fileA,
    entered: PCN,
    idType,
    read: doneWith(fileA, ocrOf('9999 8888 7777 6666', 38)),
  })
  assert.equal(s.status, 'uncertain')
  assert.equal(s.blocking, false)
})

test('an engine that cannot run is not a verdict on the resident', () => {
  const s = idCheckState({
    file: fileA,
    entered: PCN,
    idType,
    read: doneWith(fileA, { ok: false, reason: 'engine-failed', message: 'no' }),
  })
  assert.equal(s.status, 'failed')
  assert.equal(s.blocking, false)
})

test('a PDF that could not be rendered goes to manual review, not a verdict', () => {
  const s = idCheckState({
    file: pdfFile,
    entered: PCN,
    idType,
    read: doneWith(pdfFile, { ok: false, reason: 'pdf-unreadable' }),
  })
  assert.equal(s.status, 'pdf-manual')
  assert.equal(s.blocking, false)
  const msg = idCheckMessage(s)
  // It must say the check did not happen, and must not imply a match.
  assert.match(msg, /not been checked/)
  assert.match(msg, /secretary/)
  assert.ok(!/match/i.test(msg), 'must never suggest the number matched')
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

test('an unsupported file reports the existing upload wording and does not block', () => {
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
  assert.equal(s.blocking, false)
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

test('clearing the number returns the check to idle, not to the old match', () => {
  const read = doneWith(fileA, ocrOf('1234 5678 9012 3456'))
  assert.equal(idCheckState({ file: fileA, entered: PCN, idType, read }).status, 'match')
  assert.deepEqual(idCheckState({ file: fileA, entered: '', idType, read }), ID_CHECK_IDLE)
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
  assert.equal(asPhilSys.blocking, false)
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

test('the uncertain message offers manual review rather than a refusal', () => {
  const msg = idCheckMessage({ status: 'uncertain' })
  assert.match(msg, /secretary/)
  assert.match(msg, /carry on/)
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
  // Only a confident mismatch refuses.
  assert.deepEqual(
    settled.filter((s) => s.blocking).map((s) => s.status),
    ['mismatch'],
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

test('an uncertain result is labelled "Not checked", never as a match', () => {
  const uncertain = idCheckState({
    file: fileA,
    entered: PCN,
    idType,
    read: doneWith(fileA, ocrOf('9999 8888 7777 6666', 30)),
  })
  assert.equal(uncertain.status, 'uncertain')
  assert.equal(idCheckLabel(uncertain), 'Not checked')
  // The three outcomes that establish nothing must all say the same thing.
  assert.equal(idCheckLabel({ status: 'failed' }), 'Not checked')
  assert.equal(idCheckLabel({ status: 'pdf-manual' }), 'Not checked')
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
