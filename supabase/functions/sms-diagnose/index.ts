// ============================================================
// sms-diagnose — read-only lookup of what httpSMS did with a message
//
// Why this exists as its own function: the queue records what the provider
// said when it ACCEPTED a message, which for httpSMS is only "the phone has
// been given this". Whether the handset then managed to send it is decided
// minutes later and is never sent back to us, because no webhook is wired up.
// This asks httpSMS directly.
//
// It is deliberately separate from sms-dispatch. Diagnosing a failure should
// not mean touching the code that sends, and nothing here can send: the only
// request it makes is a GET.
//
// httpSMS has no "get one message by id" endpoint, so this lists the
// conversation between the two numbers and picks the message out.
//
// The API key is read from the environment, used in one request header, and
// never logged, never echoed and never returned. The response is built from a
// fixed list of fields rather than passed through, so a future provider change
// cannot start leaking something by accident.
// ============================================================

import { timingSafeEqual } from 'https://deno.land/std@0.224.0/crypto/timing_safe_equal.ts'

const HTTPSMS_MESSAGES_URL = 'https://api.httpsms.com/v1/messages'

// Whether the Android phone is actually alive and talking to httpSMS. A
// message that expires without a failure reason was handed to a phone that
// never answered, and this is the only way to tell "asleep" from "awake but
// refused".
const HTTPSMS_HEARTBEATS_URL = 'https://api.httpsms.com/v1/heartbeats'
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

/**
 * The fields worth seeing, and only those. Content is included because it is
 * the barangay's own message text and the question is often whether the body
 * is what caused the refusal; the key never appears in a message object.
 */
function summarise(m: Record<string, unknown>) {
  return {
    id: m.id,
    status: m.status,
    failure_reason: m.failure_reason ?? null,
    sim: m.sim,
    owner: m.owner,
    contact: m.contact,
    type: m.type,
    content: m.content,
    content_length: typeof m.content === 'string' ? m.content.length : null,
    send_attempt_count: m.send_attempt_count ?? null,
    max_send_attempts: m.max_send_attempts ?? null,
    created_at: m.created_at ?? null,
    last_attempted_at: m.last_attempted_at ?? null,
    sent_at: m.sent_at ?? null,
    delivered_at: m.delivered_at ?? null,
    failed_at: m.failed_at ?? null,
    expired_at: m.expired_at ?? null,
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!authorised(req)) return json({ error: 'Forbidden' }, 403)

  const apiKey = Deno.env.get('HTTPSMS_API_KEY')
  if (!apiKey) return json({ error: 'HTTPSMS_API_KEY is not configured.' }, 500)

  let input: {
    owner?: string
    contact?: string
    message_id?: string
    limit?: number
    heartbeats?: boolean
  }
  try {
    input = await req.json()
  } catch {
    return json({ error: 'Send a JSON body with owner, contact and message_id.' }, 400)
  }

  const owner = String(input.owner ?? '').trim()
  const contact = String(input.contact ?? '').trim()
  if (!owner) return json({ error: 'owner is required, in E.164.' }, 400)
  if (!input.heartbeats && !contact) {
    return json({ error: 'contact is required when looking up a message.' }, 400)
  }

  const limit = String(Math.min(Math.max(Number(input.limit ?? 20), 1), 100))

  // ---- heartbeats: is the phone online at all? ----
  if (input.heartbeats) {
    try {
      const url = new URL(HTTPSMS_HEARTBEATS_URL)
      url.searchParams.set('owner', owner)
      url.searchParams.set('limit', limit)

      const res = await fetch(url, {
        method: 'GET',
        headers: { 'x-api-key': apiKey },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const text = await res.text()
      const parsed = text ? JSON.parse(text) : null

      if (!res.ok) {
        return json({ http_status: res.status, error: 'httpSMS refused the heartbeat lookup.' }, 200)
      }

      const beats = ((parsed as { data?: unknown })?.data ?? []) as Record<string, unknown>[]
      return json({
        http_status: res.status,
        returned: beats.length,
        // Only the pulse itself: when it was and whether the phone was on
        // charge. Nothing here identifies anything but the gateway.
        heartbeats: beats.map((b) => ({
          timestamp: b.timestamp ?? null,
          charging: b.charging ?? null,
          owner: b.owner ?? null,
        })),
      })
    } catch (err) {
      console.error('sms-diagnose heartbeats failed:', err instanceof Error ? err.message : String(err))
      return json({ error: 'The heartbeat lookup failed. See the function logs.' }, 500)
    }
  }

  try {
    const url = new URL(HTTPSMS_MESSAGES_URL)
    url.searchParams.set('owner', owner)
    url.searchParams.set('contact', contact)
    url.searchParams.set('limit', limit)

    // GET, and nothing else. This function cannot send a message.
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
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
      // The provider's own words, but never the request that carried the key.
      return json({ http_status: res.status, error: 'httpSMS refused the lookup.' }, 200)
    }

    const list = ((parsed as { data?: unknown })?.data ?? []) as Record<string, unknown>[]
    const wanted = input.message_id
      ? list.find((m) => m.id === input.message_id) ?? null
      : null

    return json({
      http_status: res.status,
      returned: list.length,
      message: wanted ? summarise(wanted) : null,
      // Context, so a missing id is obviously "not in this conversation"
      // rather than "the lookup is broken".
      recent: list.slice(0, 5).map(summarise),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('sms-diagnose failed:', message)
    return json({ error: 'The lookup failed. See the function logs.' }, 500)
  }
})
