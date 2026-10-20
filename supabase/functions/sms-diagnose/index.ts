// ============================================================
// sms-diagnose — read-only lookup of what Semaphore did with a message
//
// Why this exists as its own function: the queue records what Semaphore said
// when it ACCEPTED a message, and that answer is frozen at send time. A
// message accepted as "Pending" may later become Sent, Failed or Refunded,
// and no webhook tells us. Without this, the only way to see the current
// state is the Semaphore dashboard by hand -- which is exactly what blocked
// the investigation into message 282834693, where Semaphore had accepted and
// billed a text it had routed to the wrong network.
//
// It replaces an httpSMS-only version. httpSMS is gone, and leaving an
// endpoint that answers questions about a provider the system no longer uses
// would be worse than having none.
//
// It is deliberately separate from sms-dispatch. Diagnosing a failure should
// not mean touching the code that sends, and NOTHING HERE CAN SEND: the only
// outbound requests it makes are GETs.
//
// The API key is read from the environment, used in one request, and never
// logged, never echoed and never returned. The URL is never logged either,
// because Semaphore takes the key as a query parameter. Responses are built
// from a fixed list of fields rather than passed through, so a future
// provider change cannot start leaking something by accident -- the account
// owner's email address is in Semaphore's reply and is deliberately dropped.
// ============================================================

import { timingSafeEqual } from 'https://deno.land/std@0.224.0/crypto/timing_safe_equal.ts'

const SEMAPHORE_MESSAGES_URL = 'https://api.semaphore.co/api/v4/messages'
const REQUEST_TIMEOUT_MS = 30_000

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function encode(s: string) {
  return new TextEncoder().encode(s)
}

/** The same shared secret sms-dispatch uses: this must not be a public URL. */
function authorised(req: Request): boolean {
  const expected = Deno.env.get('SMS_DISPATCH_SECRET') ?? ''
  const got = req.headers.get('x-sms-dispatch-secret') ?? ''
  if (!expected || got.length !== expected.length) return false
  return timingSafeEqual(encode(got), encode(expected))
}

/** Last four digits only. Staff already know whose number they looked up. */
function maskNumber(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const digits = String(value).replace(/[^0-9]/g, '')
  return digits ? '***' + digits.slice(-4) : null
}

/**
 * The fields worth seeing, and only those.
 *
 * `network` is the one that matters most and the reason this function was
 * worth writing: Semaphore reporting a network that does not match the
 * number's prefix is how a misrouted message is spotted.
 *
 * The message text is reduced to a length and a short opening. That is enough
 * to tell which notification it was without reproducing a resident's name or
 * reference number in a diagnostic response.
 */
function summarise(m: Record<string, unknown>) {
  const text = typeof m.message === 'string' ? m.message : ''
  return {
    message_id: m.message_id ?? null,
    status: m.status ?? null,
    sender_name: m.sender_name ?? null,
    network: m.network ?? null,
    type: m.type ?? null,
    source: m.source ?? null,
    recipient_masked: maskNumber(m.recipient),
    message_length: text.length || null,
    message_opening: text ? text.slice(0, 40) : null,
    created_at: m.created_at ?? null,
    updated_at: m.updated_at ?? null,
  }
}

/** Semaphore answers a single-id lookup with an object, a list with an array. */
function asList(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[]
  if (parsed && typeof parsed === 'object') return [parsed as Record<string, unknown>]
  return []
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!authorised(req)) return json({ error: 'Forbidden' }, 403)

  const apiKey = Deno.env.get('SMS_API_KEY')
  if (!apiKey) {
    // Named, never echoed.
    console.error('sms-diagnose: SMS_API_KEY is not set.')
    return json({ error: 'SMS_API_KEY is not configured.' }, 500)
  }

  let input: { message_id?: string | number; limit?: number }
  try {
    input = await req.json()
  } catch {
    return json({ error: 'Send a JSON body with message_id, or limit for recent messages.' }, 400)
  }

  // Digits only: this goes into a path segment.
  const messageId = String(input.message_id ?? '').replace(/[^0-9]/g, '')
  const limit = String(Math.min(Math.max(Number(input.limit ?? 20), 1), 100))

  // One message by id, or the account's recent messages when no id is given.
  const url = messageId
    ? new URL(`${SEMAPHORE_MESSAGES_URL}/${messageId}`)
    : new URL(SEMAPHORE_MESSAGES_URL)
  url.searchParams.set('apikey', apiKey)
  if (!messageId) url.searchParams.set('limit', limit)

  try {
    // GET, and nothing else. This function cannot send a message.
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    const text = await res.text()
    let parsed: unknown
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = null
    }

    if (!res.ok) {
      // The status, but never the request that carried the key.
      return json({ http_status: res.status, error: 'Semaphore refused the lookup.' }, 200)
    }

    const list = asList(parsed)

    return json({
      http_status: res.status,
      returned: list.length,
      // Asked for one id: the message, or null so a missing id reads as "not
      // in this account" rather than "the lookup is broken".
      message: messageId ? (list[0] ? summarise(list[0]) : null) : null,
      recent: messageId ? [] : list.slice(0, 10).map(summarise),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // The message of a fetch error does not contain the URL, but be explicit
    // about logging only what was constructed here.
    console.error('sms-diagnose failed:', message.includes('http') ? 'request failed' : message)
    return json({ error: 'The lookup failed. See the function logs.' }, 500)
  }
})
