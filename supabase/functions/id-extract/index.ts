// ============================================================
// id-extract — reads the printed details off an uploaded ID
//
// The browser sends one downscaled image. This function is the only holder of
// GEMINI_API_KEY, exactly as face-login is the only holder of the service role
// key and sms-dispatch the only holder of the SMS keys.
//
// What it is NOT
// --------------
// This does not verify anything. It transcribes what is printed on a
// photograph. A convincing forgery transcribes exactly as cleanly as a real
// card, so a number that came from here is recorded as `ai_extracted`, never
// as verified, and the barangay secretary still checks the document by hand
// before approving the resident.
//
// Privacy
// -------
// Registration is the one place in this system where a resident's government
// ID leaves their device for a third party, so:
//
//   - it happens only when the resident has ticked the consent box, which is
//     off by default, and pressed the button;
//   - the image is held in memory for one request and never written anywhere;
//   - nothing extracted is logged. The rate-limit table records an address and
//     a timestamp, and nothing else.
//
// Abuse
// -----
// Registration happens before the account exists, so there is no JWT to check
// (see config.toml). A public endpoint that spends money needs its own limit,
// so every call is counted per IP in `ai_extraction_attempts`. If that table
// or the settings row is missing the function REFUSES rather than running
// unprotected -- the same choice dispatch_sms_tick makes when its secret is
// not configured yet.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// Gemini's own list. HEIC and HEIF are left out: the browser downscales to
// JPEG before sending, so anything else here would mean the client changed
// without this function being told.
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp']

// The client sends a downscaled image. This is a backstop against a caller
// that is not the client -- Gemini's own ceiling is 20MB for the whole
// request, which is far more than a readable ID crop needs.
const MAX_IMAGE_BYTES = 1_500_000

// Falls back only if the settings row is absent; the row is what should
// normally decide, so the model can be changed without a redeploy.
const DEFAULT_MODEL = 'gemini-3.1-flash-lite'
const DEFAULT_PER_HOUR = 5

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions'
const REQUEST_TIMEOUT_MS = 30_000

/**
 * Only what the registration form has a field for. Nothing else is asked for.
 *
 * valid_id_number is asked for, and this is a reversal. It was left out while
 * a second reader -- in-browser OCR -- also read the number, because a
 * cross-check is only worth something between independent readings. That
 * reader is gone, so this one both fills the field and checks it:
 *
 *   field EMPTY when read   the number is filled in. Nothing is verified.
 *   field TYPED when read   the typed number is compared to this one, and a
 *                           disagreement stops the registration.
 *
 * The number is returned to the browser that sent the photo, nowhere else. It
 * is never logged here, and a match is never recorded as proof of anything --
 * see src/lib/idCheck.js for why the server will not accept that claim.
 */
const SCHEMA = {
  type: 'object',
  properties: {
    full_name: { type: 'string' },
    date_of_birth: { type: 'string', description: 'YYYY-MM-DD, or null if not printed' },
    sex: { type: 'string', description: 'Male or Female, or null' },
    civil_status: { type: 'string' },
    address_line: { type: 'string', description: 'House number and street only' },
    valid_id_type: { type: 'string' },
    valid_id_number: { type: 'string', description: 'The ID or card number as printed' },
  },
}

const PROMPT = [
  'You are transcribing a photograph of a Philippine government ID for a',
  'barangay registration form. Return ONLY what is actually printed on the',
  'card and legible in this image.',
  '',
  'Rules:',
  '- If a field is not printed on the card, or you cannot read it clearly,',
  '  return null for that field. Never guess and never infer.',
  '- date_of_birth must be YYYY-MM-DD. If the printed date is ambiguous,',
  '  return null rather than choosing an interpretation.',
  '- sex must be exactly "Male" or "Female", or null.',
  '- address_line is the house number and street only, without the barangay,',
  '  city or province.',
  '- valid_id_number is the card number exactly as printed. Keep its letters,',
  '  digits and separators as they appear; do not reformat it. Return null if',
  '  you cannot read every character of it with certainty -- a half-read',
  '  number is worse than none, because it is checked against what the',
  '  resident typed.',
  '- Do not describe the image, the person, or anything not on this list.',
].join('\n')

/**
 * The raw base64, whatever shape the client sent it in.
 *
 * A canvas gives `data:image/jpeg;base64,...` and it is an easy mistake to
 * post that whole string. Gemini wants the payload alone, so the prefix and
 * any line breaks come off here rather than failing at the provider.
 */
function rawBase64(value: string): string {
  return value.replace(/^data:[^;,]*;base64,/, '').replace(/\s+/g, '')
}

/** Base64 length -> decoded byte count, without decoding it. */
function base64Bytes(b64: string): number {
  const clean = b64.replace(/=+$/, '')
  return Math.floor((clean.length * 3) / 4)
}

/**
 * The generated text, wherever the Interactions API puts it.
 *
 * The response is { steps: [{ type, content: [{ type: 'text', text }] }] }.
 * Read backwards and take the last model output, so a thought step ahead of
 * the answer cannot be mistaken for it.
 */
function textFromInteraction(body: unknown): string | null {
  const steps = (body as { steps?: unknown[] } | null)?.steps
  if (!Array.isArray(steps)) return null

  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i] as { type?: string; content?: unknown[] }
    if (step?.type === 'thought') continue
    const blocks = Array.isArray(step?.content) ? step.content : []
    const text = blocks
      .filter((b) => (b as { type?: string })?.type === 'text')
      .map((b) => (b as { text?: string }).text ?? '')
      .join('')
      .trim()
    if (text) return text
  }
  return null
}

/** The model is asked for JSON; a fence or a stray sentence must not break it. */
function parseExtraction(text: string): Record<string, unknown> | null {
  const direct = (() => {
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  })()
  if (direct && typeof direct === 'object') return direct as Record<string, unknown>

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const found = JSON.parse(text.slice(start, end + 1))
    return found && typeof found === 'object' ? (found as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Trim, drop empties and anything the form has no field for. */
function cleanFields(raw: Record<string, unknown>) {
  const out: Record<string, string> = {}
  for (const key of Object.keys(SCHEMA.properties)) {
    const value = raw[key]
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed || trimmed.toLowerCase() === 'null') continue
    // A field longer than this is not a transcription of a line on a card.
    out[key] = trimmed.slice(0, 120)
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) {
    // Named, never echoed.
    console.error('id-extract: GEMINI_API_KEY is not set.')
    return json({ error: 'ID reading is not configured.' }, 500)
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  // There is no identity yet, so the limit is keyed on the caller's address.
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('cf-connecting-ip') ??
    null

  if (!ip) {
    return json({ error: 'ID reading is unavailable from this connection.' }, 400)
  }

  // ---------- what the caller sent ----------
  let image: unknown
  let mimeType: unknown
  try {
    const body = await req.json()
    image = body?.image
    mimeType = body?.mime_type ?? body?.mimeType
  } catch {
    return json({ error: 'Send a JSON body with image and mime_type.' }, 400)
  }

  if (typeof image !== 'string' || !image) {
    return json({ error: 'An image is required.' }, 400)
  }
  if (typeof mimeType !== 'string' || !ALLOWED_MIME.includes(mimeType)) {
    return json({ error: 'Send a JPEG, PNG or WebP image.' }, 400)
  }

  const imageData = rawBase64(image)
  if (!imageData) {
    return json({ error: 'An image is required.' }, 400)
  }
  if (base64Bytes(imageData) > MAX_IMAGE_BYTES) {
    return json({ error: 'That image is too large. Send a smaller one.' }, 413)
  }

  // ---------- settings ----------
  // Read first, because a missing settings table means this deployment is
  // ahead of its migration and must not run unprotected.
  const { data: settings, error: settingsError } = await admin
    .from('settings')
    .select('key, value')
    .in('key', ['gemini_model', 'gemini_extractions_per_hour'])

  if (settingsError) {
    console.error('id-extract: settings unreadable:', settingsError.message)
    return json({ error: 'ID reading is not configured yet.' }, 503)
  }

  const setting = (k: string) => settings?.find((s) => s.key === k)?.value?.value
  const model = String(setting('gemini_model') ?? DEFAULT_MODEL)
  const perHour = Number(setting('gemini_extractions_per_hour') ?? DEFAULT_PER_HOUR)

  // ---------- rate limit ----------
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count, error: countError } = await admin
    .from('ai_extraction_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip', ip)
    .gte('created_at', since)

  if (countError) {
    // Fails CLOSED: without the table there is no limit, and an unlimited
    // public endpoint that spends money is worse than an unavailable one.
    console.error('id-extract: rate-limit table unavailable:', countError.message)
    return json({ error: 'ID reading is not configured yet.' }, 503)
  }

  if ((count ?? 0) >= perHour) {
    return json(
      { error: `You can read an ID ${perHour} times an hour. Type the details in instead.` },
      429,
    )
  }

  // Counted before the call, so a failed or slow attempt still spends its
  // place in the hour. Otherwise an error loop would be free.
  await admin.from('ai_extraction_attempts').insert({ ip })

  // ---------- the call ----------
  let res: Response
  try {
    res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Header, not a query parameter: a key in a URL ends up in logs.
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        model,
        input: [
          { type: 'text', text: PROMPT },
          { type: 'image', data: imageData, mime_type: mimeType },
        ],
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: SCHEMA,
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('id-extract: request failed:', message)
    return json({ error: 'The ID could not be read just now. Type the details in instead.' }, 502)
  }

  if (!res.ok) {
    // Status only. The body can quote the request, and the request is an ID.
    console.error(`id-extract: provider returned ${res.status}`)
    if (res.status === 401 || res.status === 403) {
      console.error('id-extract: GEMINI_API_KEY was rejected.')
    }
    return json({ error: 'The ID could not be read just now. Type the details in instead.' }, 502)
  }

  const text = textFromInteraction(await res.json().catch(() => null))
  if (!text) {
    return json({ error: 'The ID could not be read. Type the details in instead.' }, 502)
  }

  const parsed = parseExtraction(text)
  if (!parsed) {
    return json({ error: 'The ID could not be read. Type the details in instead.' }, 502)
  }

  const fields = cleanFields(parsed)

  // Nothing extracted is logged, here or anywhere else in this function.
  //
  // `verified: false` is not decoration, and it holds even when the number
  // agrees with what the resident typed. A match says the person typed what
  // is printed on the card they uploaded; it says nothing about whether the
  // card is real, and this function cannot tell a good forgery from a good
  // ID. So the client records `ai_extracted` at best, a disagreement stops
  // the registration, and the secretary still checks the card by hand.
  return json({
    fields,
    verified: false,
    read_count: Object.keys(fields).length,
  })
})
