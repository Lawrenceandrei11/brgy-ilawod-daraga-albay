/**
 * Reading the printed details off an uploaded ID, minus the React.
 *
 * The decisions worth testing are all here: which files can be read at all,
 * how a model's answer is turned into values the form's own selects will
 * accept, and which fields may be written. The page stays thin.
 *
 * Two rules this file exists to enforce:
 *
 *   1. Nothing extracted is ever a verification. The number comes OUT of the
 *      photograph, so comparing it against the photograph proves nothing.
 *      Callers record it as `ai_extracted`, never `auto_verified`.
 *
 *   2. Empty fields only. A value the resident typed is theirs, and a model
 *      reading a worn card must not overwrite it.
 *
 * The transport and the downscaler are both injected, so every rule below is
 * testable without a browser, a network or an API key.
 */

/** Gemini takes images. A PDF would have to be rasterised first; see below. */
export const EXTRACTABLE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/**
 * Only fields the registration form actually has. Anything else is dropped.
 *
 * valid_id_number is deliberately NOT here, even though the reader returns
 * it. It comes back separately, as `readNumber`, because what happens to it
 * depends on something these generic helpers cannot see:
 *
 *   the field is EMPTY   it gets filled, and nothing is verified
 *   the resident TYPED   it gets compared, and a mismatch blocks
 *
 * Putting it in this list would make the first case happen always, quietly
 * destroying the second. idCheck.idVerdict decides between them.
 */
export const EXTRACTABLE_FIELDS = [
  'full_name',
  'date_of_birth',
  'sex',
  'civil_status',
  'address_line',
  'valid_id_type',
]

/** Must match the options in Register.jsx exactly, or the select rejects them. */
const SEXES = ['Female', 'Male']
const CIVIL_STATUSES = ['Single', 'Married', 'Widowed', 'Separated']
const ID_TYPES = [
  'Philippine National ID (PhilSys)',
  "Driver's License",
  'UMID / SSS',
  'PhilHealth ID',
  'Passport',
  "Voter's ID",
  'Postal ID',
  'Senior Citizen ID',
  'PWD ID',
  'Student ID',
]

/**
 * What a card calls itself, against what the form calls it.
 *
 * Order matters: the first pattern that matches wins, so the more specific
 * ones come first. "Philippine Identification Card" is a PhilID, not a
 * passport, despite both saying "Republika ng Pilipinas".
 */
const ID_TYPE_PATTERNS = [
  [/phil ?sys|philippine identification|phil ?id\b|national id/i, 'Philippine National ID (PhilSys)'],
  [/driver|licen[cs]e|lto\b/i, "Driver's License"],
  [/umid|sss\b|social security/i, 'UMID / SSS'],
  [/phil ?health/i, 'PhilHealth ID'],
  [/passport/i, 'Passport'],
  [/voter|comelec/i, "Voter's ID"],
  [/postal|phlpost/i, 'Postal ID'],
  [/senior/i, 'Senior Citizen ID'],
  [/pwd|person with disabilit|disabilit/i, 'PWD ID'],
  [/student|school/i, 'Student ID'],
]

/** Whitespace collapsed, nothing else. Length is a sanity bound, not a rule. */
function tidy(value, max = 120) {
  if (typeof value !== 'string') return null
  const out = value.replace(/\s+/g, ' ').trim()
  if (!out || out.toLowerCase() === 'null') return null
  return out.slice(0, max)
}

/**
 * The name exactly as printed.
 *
 * Deliberately NOT re-cased or re-ordered. IDs print "DELA CRUZ, JUAN M." and
 * turning that into "Juan M. Dela Cruz" means guessing which part is the
 * surname -- a guess that goes wrong on compound Filipino surnames, and goes
 * wrong silently. The form asks for the name "as printed on your ID", the
 * resident can see the field, and they can fix it.
 */
export function normaliseName(value) {
  return tidy(value, 120)
}

export function normaliseSex(value) {
  const v = tidy(value, 20)
  if (!v) return null
  const exact = SEXES.find((s) => s.toLowerCase() === v.toLowerCase())
  if (exact) return exact
  if (/^(m|male|lalaki)$/i.test(v)) return 'Male'
  if (/^(f|female|babae)$/i.test(v)) return 'Female'
  return null
}

export function normaliseCivilStatus(value) {
  const v = tidy(value, 30)
  if (!v) return null
  const exact = CIVIL_STATUSES.find((s) => s.toLowerCase() === v.toLowerCase())
  if (exact) return exact
  if (/^widow(er|ed)?$/i.test(v)) return 'Widowed'
  if (/^separat/i.test(v)) return 'Separated'
  if (/^marri/i.test(v)) return 'Married'
  if (/^single|unmarried$/i.test(v)) return 'Single'
  // Divorced and Annulled are not options on this form; dropping is correct.
  return null
}

export function normaliseIdType(value) {
  const v = tidy(value, 60)
  if (!v) return null
  const exact = ID_TYPES.find((t) => t.toLowerCase() === v.toLowerCase())
  if (exact) return exact
  for (const [pattern, option] of ID_TYPE_PATTERNS) {
    if (pattern.test(v)) return option
  }
  return null
}

/**
 * A real calendar date, in the past, written the way a date input wants it.
 *
 * Anything else is dropped rather than coerced. A birth date guessed from an
 * ambiguous "03/04/95" is worse than an empty field: the resident would have
 * to notice it was wrong, and a date looks plausible whichever way it is read.
 */
export function normaliseDateOfBirth(value, today = new Date()) {
  const v = tidy(value, 20)
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null

  const [y, m, d] = v.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  // Round-tripping catches 2026-02-31, which Date would roll into March.
  const parsed = new Date(Date.UTC(y, m - 1, d))
  if (
    parsed.getUTCFullYear() !== y ||
    parsed.getUTCMonth() !== m - 1 ||
    parsed.getUTCDate() !== d
  ) {
    return null
  }
  if (y < 1900) return null
  if (parsed.getTime() > today.getTime()) return null
  return v
}

/** Everything the model returned, reduced to values the form will accept. */
export function normaliseExtraction(raw) {
  const fields = raw && typeof raw === 'object' ? raw : {}
  const out = {}

  const name = normaliseName(fields.full_name)
  if (name) out.full_name = name

  const dob = normaliseDateOfBirth(fields.date_of_birth)
  if (dob) out.date_of_birth = dob

  const sex = normaliseSex(fields.sex)
  if (sex) out.sex = sex

  const civil = normaliseCivilStatus(fields.civil_status)
  if (civil) out.civil_status = civil

  const address = tidy(fields.address_line, 160)
  if (address) out.address_line = address

  const idType = normaliseIdType(fields.valid_id_type)
  if (idType) out.valid_id_type = idType

  // valid_id_number is intentionally absent from this object -- see
  // EXTRACTABLE_FIELDS. It travels separately, as readNumber.

  return out
}

/**
 * Which of the extracted values may actually be written.
 *
 * "Fill empty fields only": anything the resident has already typed wins,
 * including a value they typed and then cleared back to nothing on purpose --
 * blank is blank either way, and a blank field is the one case where there is
 * nothing of theirs to lose.
 */
export function fillableFrom(current, extracted) {
  const now = current && typeof current === 'object' ? current : {}
  const out = {}
  for (const key of EXTRACTABLE_FIELDS) {
    const existing = now[key]
    const isEmpty = existing === undefined || existing === null || String(existing).trim() === ''
    if (isEmpty && extracted?.[key]) out[key] = extracted[key]
  }
  return out
}

/** Why this file cannot be read, or null when it can. */
export function extractionProblem(file) {
  if (!file) return 'Upload a photo of your ID first.'
  if (file.type === 'application/pdf') {
    return 'Reading a PDF is not supported yet. Upload a photo of the ID instead, or type the details in.'
  }
  if (!EXTRACTABLE_TYPES.includes(file.type)) {
    return 'Only a JPEG, PNG or WebP photo can be read.'
  }
  return null
}

/** How wide the image is sent. Big enough to read a card, small enough to be cheap. */
export const MAX_EDGE = 1400
const JPEG_QUALITY = 0.82

/**
 * The browser's half: downscale to JPEG and hand back base64.
 *
 * Downscaling is not only about cost. It is the one piece of data
 * minimisation available on this path -- a 12-megapixel phone photo of a
 * government ID carries far more than the printed text, and none of the rest
 * needs to leave the device.
 */
export async function prepareImage(file, maxEdge = MAX_EDGE) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()

  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  return { data: dataUrl.replace(/^data:[^;,]*;base64,/, ''), mimeType: 'image/jpeg' }
}

/**
 * Read an ID and return only the values that may be written.
 *
 * `invoke` posts to the id-extract function and is injected, so this whole
 * sequence runs in tests with no network. `prepare` likewise, so it runs with
 * no canvas.
 *
 * Always resolves. A failure here is a reason to type the details in by hand,
 * never a reason to lose the upload or the form.
 */
export async function extractIdFields({ file, current, invoke, prepare = prepareImage }) {
  const problem = extractionProblem(file)
  if (problem) return { ok: false, message: problem, fields: {}, readNumber: null }

  let image
  try {
    image = await prepare(file)
  } catch {
    return {
      ok: false,
      message: 'That photo could not be opened. Try another, or type the details in.',
      fields: {},
      readNumber: null,
    }
  }

  let response
  try {
    response = await invoke({ image: image.data, mime_type: image.mimeType })
  } catch (err) {
    return {
      ok: false,
      message: 'The ID could not be read just now. Type the details in instead.',
      fields: {},
      readNumber: null,
      silentError: err,
    }
  }

  if (response?.error) {
    return {
      ok: false,
      // The function's own sentences are written for residents; show them.
      message:
        typeof response.error === 'string'
          ? response.error
          : 'The ID could not be read just now. Type the details in instead.',
      fields: {},
      readNumber: null,
    }
  }

  const normalised = normaliseExtraction(response?.fields)
  const fields = fillableFrom(current, normalised)

  // Kept out of `fields` on purpose: the caller decides whether this is a
  // value to write or a value to check against. See idCheck.idVerdict.
  const readNumber = tidy(response?.fields?.valid_id_number, 40)

  return {
    ok: true,
    fields,
    readNumber,
    // Never true, whatever came back. Stated here so a caller cannot read the
    // absence of the flag as permission.
    verified: false,
    readCount: Object.keys(normalised).length,
    filledCount: Object.keys(fields).length,
  }
}

/**
 * An `invoke` backed by supabase-js, with the function's own words preserved.
 *
 * supabase-js resolves non-2xx responses as `{ error }` and keeps the body on
 * `error.context`, which is the raw Response. Throwing that error loses the
 * sentence the Edge Function wrote -- and those sentences are the useful part:
 * "You can read an ID 5 times an hour" tells a resident what to do, while
 * "could not be read just now" tells them nothing and reads like a fault.
 *
 * So the body is read back out and returned as a normal `{ error }`, which
 * extractIdFields already knows how to show. A genuine transport failure --
 * no response at all -- still throws.
 */
export function supabaseInvoker(client, fn = 'id-extract') {
  return async function invoke(body) {
    const { data, error } = await client.functions.invoke(fn, { body })
    if (!error) return data

    const res = error?.context
    if (res && typeof res.json === 'function') {
      const parsed = await res.json().catch(() => null)
      if (parsed && typeof parsed.error === 'string') return { error: parsed.error }
    }

    throw error
  }
}
