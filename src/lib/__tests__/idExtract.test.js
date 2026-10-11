/**
 * Turning a model's answer into values this form will accept.
 *
 * No network, no canvas, no API key: both the transport and the downscaler are
 * injected. Every ID number, name and address below is invented.
 *
 * Two tests matter more than the rest:
 *
 *   - nothing already typed is ever overwritten, because a model reading a
 *     worn card must not quietly replace what the resident entered;
 *   - the result never claims verification, because the number was read OUT
 *     of the photograph it would be checked against.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  EXTRACTABLE_FIELDS,
  extractIdFields,
  extractionProblem,
  fillableFrom,
  normaliseCivilStatus,
  normaliseDateOfBirth,
  normaliseExtraction,
  normaliseIdType,
  normaliseName,
  normaliseSex,
  supabaseInvoker,
} from '../idExtract.js'

const jpeg = { name: 'id.jpg', type: 'image/jpeg', size: 90_000 }
const pdf = { name: 'id.pdf', type: 'application/pdf', size: 90_000 }

/** Stands in for the Edge Function. `reply` decides what comes back. */
function fakeInvoke(reply) {
  const calls = []
  const fn = async (body) => {
    calls.push(body)
    return typeof reply === 'function' ? reply(body) : reply
  }
  fn.calls = calls
  return fn
}

const prepare = async () => ({ data: 'QkFTRTY0', mimeType: 'image/jpeg' })

// ------------------------------------------------------- which files at all

test('a PDF is refused with a reason, and never sent', async () => {
  assert.match(extractionProblem(pdf), /PDF is not supported/i)
  const invoke = fakeInvoke({ fields: {} })
  const r = await extractIdFields({ file: pdf, current: {}, invoke, prepare })
  assert.equal(r.ok, false)
  assert.equal(invoke.calls.length, 0, 'nothing left the device')
})

test('only the three image types are accepted', () => {
  assert.equal(extractionProblem(jpeg), null)
  assert.equal(extractionProblem({ type: 'image/png' }), null)
  assert.equal(extractionProblem({ type: 'image/webp' }), null)
  assert.match(extractionProblem({ type: 'image/gif' }), /JPEG, PNG or WebP/)
  assert.match(extractionProblem(null), /Upload a photo/)
})

// ------------------------------------------------------------ normalising

test('sex is mapped onto the two options the select has', () => {
  for (const v of ['Male', 'male', 'M', 'lalaki']) assert.equal(normaliseSex(v), 'Male')
  for (const v of ['Female', 'female', 'F', 'babae']) assert.equal(normaliseSex(v), 'Female')
  for (const v of ['', 'null', 'unknown', 'X', null]) assert.equal(normaliseSex(v), null)
})

test('civil status drops anything the form does not offer', () => {
  assert.equal(normaliseCivilStatus('married'), 'Married')
  assert.equal(normaliseCivilStatus('WIDOWER'), 'Widowed')
  assert.equal(normaliseCivilStatus('Separated'), 'Separated')
  assert.equal(normaliseCivilStatus('single'), 'Single')
  // Not options on this form: better blank than a value the select refuses.
  assert.equal(normaliseCivilStatus('Divorced'), null)
  assert.equal(normaliseCivilStatus('Annulled'), null)
})

test('ID types are mapped onto the exact option strings', () => {
  assert.equal(normaliseIdType('PhilSys'), 'Philippine National ID (PhilSys)')
  assert.equal(normaliseIdType('Philippine Identification Card'), 'Philippine National ID (PhilSys)')
  assert.equal(normaliseIdType('National ID'), 'Philippine National ID (PhilSys)')
  assert.equal(normaliseIdType("Driver's Licence"), "Driver's License")
  assert.equal(normaliseIdType('LTO'), "Driver's License")
  assert.equal(normaliseIdType('UMID'), 'UMID / SSS')
  assert.equal(normaliseIdType('PhilHealth'), 'PhilHealth ID')
  assert.equal(normaliseIdType('Passport'), 'Passport')
  assert.equal(normaliseIdType('COMELEC'), "Voter's ID")
  assert.equal(normaliseIdType('Postal ID'), 'Postal ID')
  assert.equal(normaliseIdType('Senior Citizen'), 'Senior Citizen ID')
  assert.equal(normaliseIdType('Person with Disability'), 'PWD ID')
  assert.equal(normaliseIdType('School ID'), 'Student ID')
  assert.equal(normaliseIdType('Barangay Clearance'), null, 'not an accepted ID here')
})

test('a PhilID is not mistaken for a passport', () => {
  // Both cards say "Republika ng Pilipinas"; the specific pattern must win.
  assert.equal(
    normaliseIdType('Republika ng Pilipinas Philippine Identification Card'),
    'Philippine National ID (PhilSys)',
  )
})

test('the name is kept exactly as printed, not re-ordered', () => {
  // Reordering "SURNAME, FIRST" means guessing which part is the surname, and
  // that guess goes wrong silently on compound Filipino surnames.
  assert.equal(normaliseName('DELA CRUZ, JUAN M.'), 'DELA CRUZ, JUAN M.')
  assert.equal(normaliseName('  Juan   Dela  Cruz '), 'Juan Dela Cruz')
  assert.equal(normaliseName('null'), null)
})

// -------------------------------------------------------- dates, strictly

test('a birth date is accepted only when it is unambiguous and real', () => {
  const today = new Date('2026-10-11T00:00:00Z')
  assert.equal(normaliseDateOfBirth('1990-04-03', today), '1990-04-03')

  // A date that does not exist must not roll into the next month.
  assert.equal(normaliseDateOfBirth('2026-02-31', today), null)
  assert.equal(normaliseDateOfBirth('1990-13-01', today), null)
  assert.equal(normaliseDateOfBirth('1990-00-10', today), null)

  // Anything not already YYYY-MM-DD is dropped rather than guessed: "03/04/95"
  // is two different birthdays depending on where the card was printed.
  for (const v of ['03/04/95', '4 March 1990', '1990/04/03', '19900403', '']) {
    assert.equal(normaliseDateOfBirth(v, today), null, v)
  }

  assert.equal(normaliseDateOfBirth('2030-01-01', today), null, 'the future is not a birth date')
  assert.equal(normaliseDateOfBirth('1823-01-01', today), null, 'nor is 1823')
})

// ------------------------------------------------- fill empty fields only

test('THE POINT: nothing already typed is overwritten', () => {
  const current = {
    full_name: 'Juan Dela Cruz',
    date_of_birth: '',
    sex: 'Male',
    valid_id_number: '   ',
  }
  const extracted = {
    full_name: 'JUAN M DELA CRUZ',
    date_of_birth: '1990-04-03',
    sex: 'Female',
    valid_id_number: '1234-5678-9012-3456',
    valid_id_type: 'Philippine National ID (PhilSys)',
  }

  const fill = fillableFrom(current, extracted)
  assert.deepEqual(Object.keys(fill).sort(), [
    'date_of_birth',
    'valid_id_type',
  ])
  assert.ok(!('full_name' in fill), 'a typed name is the resident\u2019s')
  assert.ok(!('sex' in fill), 'and so is a chosen sex')
  // The field was blank and the model read a number, and it is STILL not
  // filled: that one field is what the OCR check cross-examines.
  assert.ok(!('valid_id_number' in fill), 'the number is never filled from the photo')
})

test('only fields the form has are ever filled', () => {
  const fill = fillableFrom({}, {
    full_name: 'Juan Dela Cruz',
    blood_type: 'O+',
    nationality: 'Filipino',
    height: '170cm',
  })
  assert.deepEqual(Object.keys(fill), ['full_name'])
  for (const key of Object.keys(fill)) {
    assert.ok(EXTRACTABLE_FIELDS.includes(key))
  }
})

// --------------------------------------------------- the whole sequence

test('a good read fills the blanks and never claims verification', async () => {
  const invoke = fakeInvoke({
    fields: {
      full_name: 'JUAN DELA CRUZ',
      date_of_birth: '1990-04-03',
      sex: 'M',
      civil_status: 'single',
      address_line: '12 Rizal Street',
      valid_id_type: 'PhilSys',
      valid_id_number: '1234 5678 9012 3456',
    },
  })

  const r = await extractIdFields({ file: jpeg, current: {}, invoke, prepare })

  assert.equal(r.ok, true)
  assert.equal(r.verified, false, 'an extraction is never a verification')
  assert.equal(r.fields.sex, 'Male')
  assert.equal(r.fields.civil_status, 'Single')
  assert.equal(r.fields.valid_id_type, 'Philippine National ID (PhilSys)')
  assert.equal(r.fields.date_of_birth, '1990-04-03')
  // Six, not seven: the card had a number on it and it was dropped before it
  // could reach the form.
  assert.equal(r.fields.valid_id_number, undefined)
  assert.equal(r.readCount, 6)
  assert.equal(r.filledCount, 6)
  assert.deepEqual(invoke.calls[0], { image: 'QkFTRTY0', mime_type: 'image/jpeg' })
})

test('unreadable fields are simply absent, not guessed', async () => {
  const invoke = fakeInvoke({
    fields: {
      full_name: 'JUAN DELA CRUZ',
      date_of_birth: null,
      sex: 'unknown',
      civil_status: 'Divorced',
      valid_id_type: 'Barangay Clearance',
      valid_id_number: '',
    },
  })
  const r = await extractIdFields({ file: jpeg, current: {}, invoke, prepare })
  assert.equal(r.ok, true)
  assert.deepEqual(Object.keys(r.fields), ['full_name'])
})

test('the endpoint\u2019s own refusal is shown to the resident', async () => {
  const invoke = fakeInvoke({ error: 'You can read an ID 5 times an hour. Type the details in instead.' })
  const r = await extractIdFields({ file: jpeg, current: {}, invoke, prepare })
  assert.equal(r.ok, false)
  assert.match(r.message, /5 times an hour/)
  assert.deepEqual(r.fields, {})
})

test('a thrown transport error is reported, never raised', async () => {
  const invoke = async () => {
    throw new Error('Failed to fetch')
  }
  const r = await extractIdFields({ file: jpeg, current: {}, invoke, prepare })
  assert.equal(r.ok, false)
  assert.match(r.message, /could not be read just now/)
  assert.ok(!/fetch/i.test(r.message), 'the raw error is not shown to the resident')
  assert.ok(r.silentError, 'but it is available to a logger')
})

test('a photo the browser cannot open fails without calling out', async () => {
  const invoke = fakeInvoke({ fields: {} })
  const r = await extractIdFields({
    file: jpeg,
    current: {},
    invoke,
    prepare: async () => {
      throw new Error('decode failed')
    },
  })
  assert.equal(r.ok, false)
  assert.match(r.message, /could not be opened/)
  assert.equal(invoke.calls.length, 0, 'nothing was sent')
})

test('an empty or malformed answer is handled, not spread into the form', async () => {
  for (const reply of [{}, { fields: null }, { fields: 'nope' }, null]) {
    const r = await extractIdFields({ file: jpeg, current: {}, invoke: fakeInvoke(reply), prepare })
    assert.equal(r.ok, true)
    assert.deepEqual(r.fields, {})
    assert.equal(r.verified, false)
  }
})

// ---------------------------------------------------------------------------
// Why the number is left alone
//
// The form cross-checks the number the resident types against the number OCR
// reads off the photo. That is only worth something because they are two
// independent readings. Filling the field FROM the photo collapses them into
// one and the check compares the image with itself.
//
// In practice it also deadlocked: AI filled the number, OCR could not read
// the card, and the strict gate blocked a resident whose form was complete.
// ---------------------------------------------------------------------------

test('REGRESSION: the ID number is never filled, however clearly it is read', async () => {
  const invoke = fakeInvoke({
    fields: {
      full_name: 'MARIA ELENA SANTOS',
      valid_id_type: 'PhilSys',
      valid_id_number: '7712 4455 9087 3321',
    },
  })

  const r = await extractIdFields({ file: jpeg, current: {}, invoke, prepare })

  assert.equal(r.ok, true)
  assert.ok(!('valid_id_number' in r.fields), 'the one field the gate checks stays the resident\u2019s')
  assert.deepEqual(Object.keys(r.fields).sort(), ['full_name', 'valid_id_type'])
})

test('REGRESSION: it is not in the fillable list at all', () => {
  assert.ok(!EXTRACTABLE_FIELDS.includes('valid_id_number'))
  // And the merge cannot be talked into it either.
  const fill = fillableFrom({}, { valid_id_number: '7712 4455 9087 3321' })
  assert.deepEqual(fill, {})
})

// ---------------------------------------------------------------------------
// Keeping the function's own words
//
// Reported as "the AI is not working". It was working: the endpoint returned
// 429 with "You can read an ID 5 times an hour", and supabase-js hid that
// behind a generic error object, so the resident saw "could not be read just
// now" and had no idea they had simply run out of attempts.
// ---------------------------------------------------------------------------

/** Mimics supabase-js: non-2xx resolves as { error } with the Response kept. */
function fakeFunctionsClient({ status, body, throwRaw }) {
  return {
    functions: {
      invoke: async () => {
        if (throwRaw) return { data: null, error: throwRaw }
        if (status >= 200 && status < 300) return { data: body, error: null }
        const error = new Error('Edge Function returned a non-2xx status code')
        error.context = { status, json: async () => body }
        return { data: null, error }
      },
    },
  }
}

test('REGRESSION: a rate limit reaches the resident in words', async () => {
  const message = 'You can read an ID 5 times an hour. Type the details in instead.'
  const invoke = supabaseInvoker(fakeFunctionsClient({ status: 429, body: { error: message } }))

  const r = await extractIdFields({ file: jpeg, current: {}, invoke, prepare })

  assert.equal(r.ok, false)
  assert.equal(r.message, message, 'the endpoint wrote this sentence for the resident')
  assert.ok(!/could not be read just now/.test(r.message), 'not the generic fallback')
})

test('the not-configured and provider messages come through too', async () => {
  for (const [status, message] of [
    [503, 'ID reading is not configured yet.'],
    [502, 'The ID could not be read just now. Type the details in instead.'],
    [413, 'That image is too large. Send a smaller one.'],
  ]) {
    const invoke = supabaseInvoker(fakeFunctionsClient({ status, body: { error: message } }))
    const r = await extractIdFields({ file: jpeg, current: {}, invoke, prepare })
    assert.equal(r.ok, false)
    assert.equal(r.message, message, `status ${status}`)
  }
})

test('a success still passes the payload straight through', async () => {
  const invoke = supabaseInvoker(
    fakeFunctionsClient({ status: 200, body: { fields: { full_name: 'MARIA ELENA SANTOS' } } }),
  )
  const r = await extractIdFields({ file: jpeg, current: {}, invoke, prepare })
  assert.equal(r.ok, true)
  assert.equal(r.fields.full_name, 'MARIA ELENA SANTOS')
})

test('a transport failure with no response still throws, and is reported', async () => {
  // No `context` to read: there was no reply at all.
  const invoke = supabaseInvoker(fakeFunctionsClient({ throwRaw: new Error('Failed to fetch') }))
  const r = await extractIdFields({ file: jpeg, current: {}, invoke, prepare })
  assert.equal(r.ok, false)
  assert.match(r.message, /could not be read just now/)
  assert.ok(r.silentError, 'kept for a logger, not shown')
})

test('a non-JSON body falls back rather than crashing', async () => {
  const client = {
    functions: {
      invoke: async () => {
        const error = new Error('non-2xx')
        error.context = { status: 500, json: async () => { throw new Error('not json') } }
        return { data: null, error }
      },
    },
  }
  const r = await extractIdFields({ file: jpeg, current: {}, invoke: supabaseInvoker(client), prepare })
  assert.equal(r.ok, false)
  assert.match(r.message, /could not be read just now/)
})

// ---------------------------------------------------------------------------
// The number travels separately
//
// It must never land in `fields`, because `fields` is written into the form
// unconditionally. It must still be returned, because the caller needs it to
// either fill an empty box or check a typed one.
// ---------------------------------------------------------------------------

test('the read number is returned, but never as a fillable field', async () => {
  const invoke = fakeInvoke({
    fields: { full_name: 'MARIA ELENA SANTOS', valid_id_number: '7712 4455 9087 3321' },
  })
  const r = await extractIdFields({ file: jpeg, current: {}, invoke, prepare })

  assert.equal(r.readNumber, '7712 4455 9087 3321', 'the caller needs it to compare')
  assert.ok(!('valid_id_number' in r.fields), 'but it is not written into the form here')
})

test('every failure path reports no number at all', async () => {
  const failures = [
    await extractIdFields({ file: pdf, current: {}, invoke: fakeInvoke({}), prepare }),
    await extractIdFields({ file: jpeg, current: {}, invoke: fakeInvoke({ error: 'nope' }), prepare }),
    await extractIdFields({
      file: jpeg, current: {}, prepare,
      invoke: async () => { throw new Error('Failed to fetch') },
    }),
    await extractIdFields({
      file: jpeg, current: {}, invoke: fakeInvoke({}),
      prepare: async () => { throw new Error('decode failed') },
    }),
  ]
  for (const r of failures) {
    assert.equal(r.ok, false)
    assert.equal(r.readNumber, null, 'a failure must not look like a reading')
  }
})

test('a card with no readable number gives null, not an empty string', async () => {
  const r = await extractIdFields({
    file: jpeg, current: {}, prepare,
    invoke: fakeInvoke({ fields: { full_name: 'MARIA ELENA SANTOS' } }),
  })
  assert.equal(r.ok, true)
  assert.equal(r.readNumber, null)
})
