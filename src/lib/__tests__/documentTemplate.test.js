/**
 * What a printed barangay document contains -- and, more importantly, what it
 * must never contain: an invented approver, a substituted release date, or a
 * label with nothing after it.
 *
 * Synthetic fixtures only. No real resident, no production data.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PRINTABLE_SERVICE_CODES,
  PRINTABLE_STATUSES,
  buildDocument,
  canPrint,
} from '../documentTemplate.js'

const barangay = { name: 'Barangay Ilawod', puroks: 7 }
const official = { name: 'Randy Velasco', position: 'Punong Barangay' }

const profile = {
  full_name: 'Juana T. Dela Cruz',
  date_of_birth: '1990-04-12',
  civil_status: 'Married',
  address_line: '12 Rizal St.',
  purok: 6,
  years_of_residency: 20,
  resident_id: 'ILW-2026-0001',
}

const req = (over = {}) => ({
  ref_no: 'REQ-2026-0001',
  service_code: 'barangay-clearance',
  status: 'released',
  details: { purpose: 'Employment' },
  fee: 50,
  fee_paid: true,
  filed_at: '2026-10-01T02:00:00Z',
  released_at: '2026-10-05T02:00:00Z',
  ...over,
})

const approval = {
  from_status: 'processing',
  to_status: 'approved',
  changed_by_name: 'BRGY. ILAWOD',
  created_at: '2026-10-03T02:00:00Z',
}

const build = (over = {}, extra = {}) =>
  buildDocument({
    request: req(over),
    profile,
    service: { name: 'Barangay Clearance' },
    barangay,
    official,
    ...extra,
  })

const labels = (doc) => doc.facts.map((f) => f.label)
const valueOf = (list, label) => list.find((f) => f.label === label)?.value

// ------------------------------------------------------------ the four types

test('all four document types build a title and a non-empty body', () => {
  assert.deepEqual(PRINTABLE_SERVICE_CODES.sort(), [
    'barangay-clearance',
    'business-clearance',
    'certificate-indigency',
    'certificate-residency',
  ])
  for (const code of PRINTABLE_SERVICE_CODES) {
    const doc = build({ service_code: code, details: { business_name: 'Aling Nena Sari-Sari' } })
    assert.ok(doc, code)
    assert.ok(doc.title.length > 0, `${code} title`)
    assert.ok(doc.statement.length > 0, `${code} statement`)
    assert.ok(doc.facts.length > 0, `${code} facts`)
  }
})

test('an unknown service code returns null rather than throwing', () => {
  assert.equal(build({ service_code: 'blotter' }), null)
  assert.equal(build({ service_code: 'anonymous' }), null)
  assert.equal(buildDocument({}), null)
  assert.equal(buildDocument(), null)
})

// ------------------------------------------- business clearance (item 11)

test('a Business Clearance prints the registered business name', () => {
  const doc = build({
    service_code: 'business-clearance',
    details: {
      business_name: 'Aling Nena Sari-Sari Store',
      business_type: 'Retail',
      business_address: '14 Mabini St., Purok 3',
      registration_no: 'DTI-123456',
      application_type: 'Renewal',
    },
  })
  assert.equal(doc.subject, 'Aling Nena Sari-Sari Store', 'the business is the subject')
  assert.equal(valueOf(doc.facts, 'Business name'), 'Aling Nena Sari-Sari Store')
  assert.equal(valueOf(doc.facts, 'Type of business'), 'Retail')
  assert.equal(valueOf(doc.facts, 'Registration number'), 'DTI-123456')
  assert.equal(valueOf(doc.facts, 'Application type'), 'Renewal')
  // The owner is still named, but is not the subject.
  assert.equal(valueOf(doc.facts, 'Owner / applicant'), 'Juana T. Dela Cruz')
})

test('a Business Clearance omits an absent registration number entirely', () => {
  const doc = build({
    service_code: 'business-clearance',
    details: { business_name: 'Nena Store', business_type: 'Retail' },
  })
  assert.ok(!labels(doc).includes('Registration number'))
  assert.ok(!JSON.stringify(doc).includes('undefined'))
})

// ----------------------------------------------------- indigency: no income

test('the Indigency certificate never prints monthly income', () => {
  const doc = build({
    service_code: 'certificate-indigency',
    details: {
      reason: 'Medical assistance',
      beneficiary_name: 'Pedro Dela Cruz',
      beneficiary_relation: 'Son',
      monthly_income: '8000',
    },
  })
  assert.ok(!labels(doc).some((l) => /income/i.test(l)), 'no income label')
  assert.ok(!JSON.stringify(doc).includes('8000'), 'the figure must not appear anywhere')
  assert.equal(valueOf(doc.facts, 'Beneficiary'), 'Pedro Dela Cruz')
})

// --------------------------------------------------------- "Other" answers

test('an "Other" answer falls through to the free-text companion field', () => {
  const a = build({ details: { purpose: 'Other', purpose_other: 'Scholarship application' } })
  assert.equal(valueOf(a.facts, 'Purpose'), 'Scholarship application')

  const b = build({ details: { purpose: 'Employment', purpose_other: '' } })
  assert.equal(valueOf(b.facts, 'Purpose'), 'Employment')

  const c = build({
    service_code: 'certificate-indigency',
    details: { reason: 'Others', reason_other: 'Burial assistance' },
  })
  assert.equal(valueOf(c.facts, 'Reason'), 'Burial assistance')
})

// ------------------------------------------- never invent approval or release

test('approval is shown only when the history row exists', () => {
  const withApproval = build({}, { approval })
  assert.equal(valueOf(withApproval.reference, 'Approved by'), 'BRGY. ILAWOD')
  assert.equal(valueOf(withApproval.reference, 'Approved on'), '2026-10-03T02:00:00Z')

  const without = build({}, { approval: null })
  assert.equal(valueOf(without.reference, 'Approved by'), undefined)
  assert.equal(valueOf(without.reference, 'Approved on'), undefined)
  assert.ok(!JSON.stringify(without.reference).includes('Approved'))
})

test('a blank approver name is treated as no approver, not as a blank line', () => {
  for (const name of ['', '   ', null, undefined]) {
    const doc = build({}, { approval: { ...approval, changed_by_name: name } })
    assert.equal(valueOf(doc.reference, 'Approved by'), undefined, JSON.stringify(name))
  }
})

test('a missing release date is never replaced with today', () => {
  const doc = build({ released_at: null, status: 'approved' })
  assert.equal(doc.released, false)
  assert.equal(valueOf(doc.reference, 'Released on'), undefined)
  // Today's date specifically must not have been substituted in. (A blanket
  // "no 2026-" check would be wrong: filed_at legitimately carries a date.)
  const today = new Date().toISOString().slice(0, 10)
  assert.ok(
    !JSON.stringify(doc.reference).includes(today),
    `today (${today}) must not appear as a substituted date`,
  )
})

test('a released document reports the date the record actually holds', () => {
  const doc = build({ released_at: '2026-10-05T02:00:00Z' })
  assert.equal(doc.released, true)
  assert.equal(valueOf(doc.reference, 'Released on'), '2026-10-05T02:00:00Z')
})

test('every document is marked draft until the barangay approves its wording', () => {
  for (const code of PRINTABLE_SERVICE_CODES) {
    const doc = build({ service_code: code, details: { business_name: 'X Store' } })
    assert.equal(doc.draft, true, code)
  }
})

// ------------------------------------------------------ signatory and seal

test('the signatory is the real official record, or nothing at all', () => {
  const doc = build()
  assert.deepEqual(doc.signatory, { name: 'Randy Velasco', position: 'Punong Barangay' })

  const none = buildDocument({ request: req(), profile, barangay, official: null })
  assert.equal(none.signatory, null, 'no official means no signatory block')

  const blank = buildDocument({ request: req(), profile, barangay, official: { name: '' } })
  assert.equal(blank.signatory, null)
})

// ------------------------------------------------- omissions, not undefined

test('missing optional profile fields are omitted, not printed empty', () => {
  const doc = buildDocument({
    request: req(),
    profile: { full_name: 'Solo Name' },
    service: { name: 'Barangay Clearance' },
    barangay,
    official,
  })
  assert.equal(valueOf(doc.facts, 'Name'), 'Solo Name')
  for (const absent of ['Civil status', 'Date of birth', 'Resident ID']) {
    assert.ok(!labels(doc).includes(absent), absent)
  }
  assert.ok(!JSON.stringify(doc).includes('undefined'))
  assert.ok(!JSON.stringify(doc).includes('null,'))
})

test('the literal strings "undefined" and "null" are treated as missing', () => {
  const doc = build({ details: { purpose: 'undefined', purpose_other: 'null' } })
  assert.ok(!labels(doc).includes('Purpose'))
})

test('the address drops the parts that are missing', () => {
  const noPurok = buildDocument({
    request: req(),
    profile: { full_name: 'A', address_line: '12 Rizal St.' },
    barangay,
    official,
  })
  assert.equal(valueOf(noPurok.facts, 'Address'), '12 Rizal St., Barangay Ilawod')

  const nothing = buildDocument({ request: req(), profile: { full_name: 'A' }, barangay, official })
  assert.equal(valueOf(nothing.facts, 'Address'), 'Barangay Ilawod')
})

// --------------------------------------------------------------- canPrint

test('only document types at a printable status may be printed', () => {
  assert.deepEqual(PRINTABLE_STATUSES, ['approved', 'scheduled', 'ready', 'released'])
  for (const status of PRINTABLE_STATUSES) {
    assert.equal(canPrint({ service_code: 'barangay-clearance', status }), true, status)
  }
  for (const status of ['pending', 'processing', 'rejected']) {
    assert.equal(canPrint({ service_code: 'barangay-clearance', status }), false, status)
  }
  // Not a document at all.
  assert.equal(canPrint({ service_code: 'blotter', status: 'released' }), false)
  assert.equal(canPrint(null), false)
})

test('a fee of zero is still printed, because free is a fact', () => {
  const doc = build({ fee: 0, fee_paid: false })
  assert.equal(valueOf(doc.reference, 'Fee'), '0 (unpaid)')
})
