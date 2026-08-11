import { z } from 'zod'

/**
 * Per-service question sets.
 *
 * One <RequestForm> renders all four document types from these specs, and the
 * answers land in `document_requests.details` (jsonb). Adding a fifth service
 * means adding an entry here and a row in `services` — no schema change and
 * no new screen.
 *
 * Identity — name, address, purok — is deliberately absent. It comes from the
 * resident's profile and is shown read-only, which is the prototype's promise
 * that "your barangay record supplies the rest".
 */

const PURPOSES = [
  'Local employment',
  'Overseas employment',
  'Scholarship or school requirement',
  'Bank or loan requirement',
  'Police or NBI clearance requirement',
  'Government transaction',
  'Business permit',
  'Travel requirement',
  'Other',
]

export const SERVICE_FIELDS = {
  'barangay-clearance': {
    intro:
      'The standard clearance for employment, permits and most government transactions. Tell us what it is for so the secretary can word it correctly.',
    fields: [
      {
        name: 'purpose',
        label: 'What is the clearance for?',
        type: 'select',
        required: true,
        options: PURPOSES,
        help: 'This is printed on the clearance itself',
      },
      {
        name: 'purpose_other',
        label: 'Please describe the purpose',
        type: 'text',
        placeholder: 'e.g. Requirement for a barangay tricycle franchise',
        showWhen: (v) => v.purpose === 'Other',
        required: true,
      },
    ],
  },

  'certificate-residency': {
    intro:
      'Proof that you live in Barangay Ilawod. Your length of stay is taken from your barangay record, so check it is right before you file.',
    fields: [
      {
        name: 'purpose',
        label: 'What is the certificate for?',
        type: 'select',
        required: true,
        options: PURPOSES,
      },
      {
        name: 'purpose_other',
        label: 'Please describe the purpose',
        type: 'text',
        showWhen: (v) => v.purpose === 'Other',
        required: true,
      },
      {
        name: 'resident_since',
        label: 'Living in the barangay since (year)',
        type: 'number',
        required: true,
        placeholder: '2015',
        help: 'The year you moved into Barangay Ilawod',
        min: 1900,
        max: new Date().getFullYear(),
      },
    ],
  },

  'certificate-indigency': {
    intro:
      'For medical, educational and legal assistance. There is no fee, but the barangay council reviews every application, so it takes a little longer.',
    notice: {
      icon: 'shield',
      title: 'Why we ask about income',
      body: 'A Certificate of Indigency states that a household cannot afford a cost. The council needs the figure to make that finding. It is visible only to barangay staff.',
    },
    fields: [
      {
        name: 'reason',
        label: 'What is the assistance for?',
        type: 'select',
        required: true,
        options: [
          'Medical assistance',
          'Hospital bill',
          'Educational assistance',
          'Legal assistance',
          'Burial assistance',
          'Other',
        ],
      },
      {
        name: 'reason_other',
        label: 'Please describe',
        type: 'text',
        showWhen: (v) => v.reason === 'Other',
        required: true,
      },
      {
        name: 'beneficiary_name',
        label: 'Who is the assistance for?',
        type: 'text',
        required: true,
        placeholder: 'Leave your own name if it is for you',
        help: 'The person who will receive the assistance',
      },
      {
        name: 'beneficiary_relation',
        label: 'Their relationship to you',
        type: 'select',
        options: ['Self', 'Spouse', 'Child', 'Parent', 'Sibling', 'Grandparent', 'Other relative'],
        required: true,
      },
      {
        name: 'monthly_income',
        label: 'Total monthly household income (₱)',
        type: 'number',
        required: true,
        min: 0,
        placeholder: '0',
        help: 'Combined income of everyone in the household',
      },
    ],
  },

  'business-clearance': {
    intro:
      'Barangay endorsement for a new or renewing business inside the barangay. The business address must be within Barangay Ilawod.',
    fields: [
      {
        name: 'business_name',
        label: 'Registered business name',
        type: 'text',
        required: true,
        placeholder: 'As registered with DTI or SEC',
      },
      {
        name: 'business_type',
        label: 'Type of business',
        type: 'select',
        required: true,
        options: [
          'Sari-sari store',
          'Food stall or carinderia',
          'Retail shop',
          'Services',
          'Workshop or repair',
          'Agriculture or fishing',
          'Transport',
          'Other',
        ],
      },
      {
        name: 'business_address',
        label: 'Business address',
        type: 'text',
        required: true,
        placeholder: 'House number, street, purok',
        help: 'Must be inside Barangay Ilawod',
      },
      {
        name: 'registration_no',
        label: 'DTI or SEC registration number',
        type: 'text',
        required: true,
        placeholder: 'e.g. 0123456',
      },
      {
        name: 'application_type',
        label: 'New or renewal?',
        type: 'select',
        required: true,
        options: ['New business', 'Renewal'],
      },
    ],
  },
}

/** Builds a zod schema from a service's field spec, honouring showWhen. */
export function buildSchema(code) {
  const spec = SERVICE_FIELDS[code]
  if (!spec) return z.object({})

  const shape = {}
  for (const f of spec.fields) {
    let rule

    if (f.type === 'number') {
      rule = z.coerce.number({ invalid_type_error: 'Enter a number' })
      if (f.min != null) rule = rule.min(f.min, `Must be ${f.min} or more`)
      if (f.max != null) rule = rule.max(f.max, `Must be ${f.max} or less`)
      // Conditional and optional fields must tolerate an empty input.
      if (!f.required || f.showWhen) rule = rule.optional().or(z.literal('').transform(() => undefined))
    } else {
      rule = z.string().trim()
      rule = f.required && !f.showWhen ? rule.min(1, 'This is required') : rule.optional()
    }

    shape[f.name] = rule
  }

  return z.object(shape).superRefine((values, ctx) => {
    // A field that is only shown under a condition is only required when
    // that condition actually holds.
    for (const f of spec.fields) {
      if (!f.required || !f.showWhen) continue
      if (f.showWhen(values) && !String(values[f.name] ?? '').trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [f.name], message: 'This is required' })
      }
    }
  })
}

/**
 * The one-line summary written to document_requests.purpose, which is what
 * the admin queue and the printed document show.
 */
export function summarisePurpose(code, values) {
  switch (code) {
    case 'barangay-clearance':
    case 'certificate-residency':
      return values.purpose === 'Other' ? values.purpose_other : values.purpose
    case 'certificate-indigency':
      return `${values.reason === 'Other' ? values.reason_other : values.reason} — for ${values.beneficiary_name}`
    case 'business-clearance':
      return `${values.application_type} — ${values.business_name}`
    default:
      return 'Document request'
  }
}
