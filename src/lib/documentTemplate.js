/**
 * What goes on a printed barangay document.
 *
 * Pure: given a request, a profile, a service and (optionally) the approval
 * history row, this returns the lines to print. No React, no network, no
 * dates of its own -- so the decisions can be tested without a browser.
 *
 * THE WORDING IS A DRAFT. The sentences below are plain factual statements
 * written to be unobjectionable, not the barangay's prescribed text. Until
 * Barangay Ilawod supplies and approves its own wording, every document this
 * produces is marked DRAFT and must not be presented as an official issuance.
 *
 * Three rules shape the rest of the file:
 *
 *   Nothing is invented. An approver, an approval date and a release date are
 *   printed only when the record actually holds them. There is no fallback to
 *   "today", because a document that prints today's date in the issued line
 *   looks exactly like a real one.
 *
 *   A missing optional field is omitted, never rendered as an empty label or
 *   the word undefined.
 *
 *   Only the fields a given document needs are included. A Business Clearance
 *   does not need a date of birth; an Indigency certificate does not print
 *   monthly income, which the form collects but no one needs to read off a
 *   certificate pinned to a noticeboard.
 */

/** A labelled fact, or null when there is nothing worth printing. */
function fact(label, value) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  if (text === '' || text.toLowerCase() === 'undefined' || text.toLowerCase() === 'null') return null
  return { label, value: text }
}

const facts = (...items) => items.filter(Boolean)

/** "Other" answers live in a companion field; use it when it is the one filled in. */
function chosen(primary, other) {
  const p = (primary ?? '').trim()
  const o = (other ?? '').trim()
  if (p && p.toLowerCase() !== 'other' && p.toLowerCase() !== 'others') return p
  return o || p || null
}

/** Purok 6 -> "Purok 6"; nothing at all when it is unset. */
const purok = (n) => (n === null || n === undefined || n === '' ? null : `Purok ${n}`)

/** "12 Rizal St., Purok 6, Barangay Ilawod" with any missing part dropped. */
function fullAddress(profile, barangayName) {
  return [profile?.address_line, purok(profile?.purok), barangayName].filter(Boolean).join(', ')
}

const TEMPLATES = {
  'barangay-clearance': {
    title: 'BARANGAY CLEARANCE',
    build: ({ profile, details, barangayName }) => ({
      subject: profile?.full_name ?? null,
      statement:
        `This is to certify that the person named below is listed in the records of ` +
        `${barangayName} at the address shown.`,
      facts: facts(
        fact('Name', profile?.full_name),
        fact('Address', fullAddress(profile, barangayName)),
        fact('Civil status', profile?.civil_status),
        fact('Date of birth', profile?.date_of_birth),
        fact('Resident ID', profile?.resident_id),
        fact('Purpose', chosen(details?.purpose, details?.purpose_other)),
      ),
    }),
  },

  'certificate-residency': {
    title: 'CERTIFICATE OF RESIDENCY',
    build: ({ profile, details, barangayName }) => ({
      subject: profile?.full_name ?? null,
      statement:
        `This is to certify that the person named below is recorded as a resident of ` +
        `${barangayName} at the address shown.`,
      facts: facts(
        fact('Name', profile?.full_name),
        fact('Address', fullAddress(profile, barangayName)),
        fact('Resident since', details?.resident_since),
        fact(
          'Years of residency',
          profile?.years_of_residency === null || profile?.years_of_residency === undefined
            ? null
            : String(profile.years_of_residency),
        ),
        fact('Civil status', profile?.civil_status),
        fact('Resident ID', profile?.resident_id),
        fact('Purpose', chosen(details?.purpose, details?.purpose_other)),
      ),
    }),
  },

  'certificate-indigency': {
    title: 'CERTIFICATE OF INDIGENCY',
    build: ({ profile, details, barangayName }) => ({
      subject: profile?.full_name ?? null,
      statement:
        `This is to certify that the person named below is recorded as a resident of ` +
        `${barangayName} and has applied for assistance for the reason stated.`,
      // monthly_income is deliberately NOT printed. The form collects it so
      // staff can assess the application; a certificate that travels with the
      // resident does not need to carry their income.
      facts: facts(
        fact('Name', profile?.full_name),
        fact('Address', fullAddress(profile, barangayName)),
        fact('Resident ID', profile?.resident_id),
        fact('Reason', chosen(details?.reason, details?.reason_other)),
        fact('Beneficiary', details?.beneficiary_name),
        fact('Relationship to beneficiary', details?.beneficiary_relation),
      ),
    }),
  },

  'business-clearance': {
    title: 'BARANGAY BUSINESS CLEARANCE',
    build: ({ profile, details, barangayName }) => ({
      // The business is the subject here, not the person.
      subject: details?.business_name ?? null,
      statement:
        `This is to certify that the business named below is recorded in ${barangayName} ` +
        `at the address shown, as declared by the applicant.`,
      facts: facts(
        fact('Business name', details?.business_name),
        fact('Type of business', details?.business_type),
        fact('Business address', details?.business_address),
        fact('Registration number', details?.registration_no),
        fact('Application type', details?.application_type),
        fact('Owner / applicant', profile?.full_name),
        fact('Owner address', fullAddress(profile, barangayName)),
      ),
    }),
  },
}

export const PRINTABLE_SERVICE_CODES = Object.keys(TEMPLATES)

/** Statuses at which a document may be printed at all. */
export const PRINTABLE_STATUSES = ['approved', 'scheduled', 'ready', 'released']

export function canPrint(request) {
  return (
    !!request &&
    PRINTABLE_SERVICE_CODES.includes(request.service_code) &&
    PRINTABLE_STATUSES.includes(request.status)
  )
}

/**
 * Build everything a print view needs, or null when this is not a document
 * that can be printed.
 *
 * `approval` is the request_status_history row for processing -> approved,
 * or null if there is not one. It is never substituted for.
 */
export function buildDocument({ request, profile, service, approval, barangay, official } = {}) {
  const template = TEMPLATES[request?.service_code]
  if (!template) return null

  const barangayName = barangay?.name ?? 'the barangay'
  const details = request?.details ?? {}
  const built = template.build({ profile, details, barangayName })

  // Released only when the record says so. No substitution with today.
  const releasedAt = request?.released_at ?? null

  // Approval only from the real history row.
  const approvedBy = approval?.changed_by_name?.trim() || null
  const approvedAt = approval?.created_at ?? null

  return {
    title: template.title,
    // A draft until the barangay's own wording is approved AND the request
    // has actually been released. Either alone keeps the mark on.
    draft: true,
    released: Boolean(releasedAt),
    subject: built.subject,
    statement: built.statement,
    facts: built.facts,
    reference: facts(
      fact('Reference number', request?.ref_no),
      fact('Document', service?.name),
      fact('Filed on', request?.filed_at),
      fact('Released on', releasedAt),
      fact('Approved by', approvedBy),
      fact('Approved on', approvedAt),
      fact(
        'Fee',
        request?.fee === null || request?.fee === undefined
          ? null
          : `${request.fee}${request.fee_paid ? ' (paid)' : ' (unpaid)'}`,
      ),
    ),
    signatory: official?.name
      ? { name: official.name, position: official.position ?? null }
      : null,
    barangayName,
  }
}
