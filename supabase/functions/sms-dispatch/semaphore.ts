// ============================================================
// semaphore.ts — the parts of dispatch that are pure decisions
//
// Split out of index.ts for one reason: it can be tested. index.ts imports
// `createClient` from an https URL and calls `Deno.serve`, neither of which
// Node can load, so nothing in it was ever covered by `npm test`. That is how
// a stripped backslash in a regex reached a deployed function once already.
//
// Everything here is dependency-free and side-effect-free, so Node 24 imports
// this .ts directly (it strips the types) and Deno imports it unchanged. One
// file, one behaviour, tested where it matters.
//
// DEPLOY NOTE: this is a second file in the function directory. `sms-dispatch`
// must be deployed with BOTH index.ts and semaphore.ts, or it will not boot.
// ============================================================

/** Semaphore's official API. Form-encoded, key as a field; see sendViaSemaphore. */
export const SEMAPHORE_URL = 'https://api.semaphore.co/api/v4/messages'

/**
 * Long enough for a slow network, short enough that a hung request does not
 * hold up the queue. There is no cold start to wait out on Semaphore.
 */
export const REQUEST_TIMEOUT_MS = 30_000

export const MAX_ATTEMPTS = 6

/**
 * Tens of seconds to minutes, not the 1s-to-32s the provider's docs suggest.
 * That advice assumes an in-process retry loop; with a queue, waiting is free.
 */
export const BACKOFF_SECONDS = [30, 60, 120, 240, 480, 960]

export type Outcome =
  | { kind: 'sent'; response: unknown }
  | { kind: 'failed'; error: string; response: unknown }
  | { kind: 'retry'; error: string; response: unknown; afterSeconds?: number }

export type SemaphoreMessage = { message_id?: number | string; status?: string }

/** How long to wait before attempt N+1, given the attempts already burned. */
export function backoffFor(attempts: number): number {
  const i = Math.min(Math.max(attempts, 1) - 1, BACKOFF_SECONDS.length - 1)
  return BACKOFF_SECONDS[i]
}

/**
 * The TypeScript twin of normalize_ph_mobile() in migration 16, kept in step
 * with it. It exists for one caller: sms_test_recipient, which is the only
 * number reaching this function that Postgres has not already normalised.
 */
export function toE164(mobile: string): string | null {
  const d = String(mobile).replace(/[^0-9]/g, '')
  if (/^00639[0-9]{9}$/.test(d)) return '+' + d.slice(2)
  if (/^639[0-9]{9}$/.test(d)) return '+' + d
  if (/^09[0-9]{9}$/.test(d)) return '+63' + d.slice(1)
  if (/^9[0-9]{9}$/.test(d)) return '+63' + d
  return null
}

/**
 * Semaphore documents 09XXXXXXXXX and 639XXXXXXXXX; the leading + is not
 * documented, so it is dropped. The log keeps E.164 in `sent_to`.
 */
export function toSemaphoreNumber(e164: string): string {
  return e164.replace(/^\+/, '')
}

/**
 * Which provider is configured, decided out loud.
 *
 * httpSMS was removed, so there is exactly one provider left. This used to
 * fall back to Semaphore for any unrecognised value, which was right while a
 * second provider existed and is wrong now: a value this deployment does not
 * understand means someone configured something that will not happen, and
 * sending anyway under a different provider than the one named is how a
 * barangay ends up surprised. An empty or missing setting is still Semaphore,
 * because that is the documented default and the only remaining provider.
 */
export type ProviderCheck =
  | { ok: true; provider: 'semaphore' }
  | { ok: false; error: string }

export function resolveProvider(raw: unknown): ProviderCheck {
  const value = String(raw ?? '').trim().toLowerCase()

  if (value === '' || value === 'semaphore') return { ok: true, provider: 'semaphore' }

  // Printable characters only, and short: this is echoed into an error, and it
  // comes from a settings row rather than from code.
  const shown = value.replace(/[^ -~]/g, '').slice(0, 40)

  if (value === 'httpsms') {
    return {
      ok: false,
      error:
        'sms_provider is set to "httpsms", which this deployment no longer supports. ' +
        'Semaphore is the only provider. Set sms_provider to "semaphore".',
    }
  }

  return {
    ok: false,
    error: `sms_provider is set to "${shown}", which is not a provider this deployment supports. Semaphore is the only provider.`,
  }
}

/**
 * Semaphore's error shapes are undocumented. Validation failures tend to come
 * back as an object of field -> messages, so pull out the first readable
 * string rather than showing staff raw JSON in the Text messages screen.
 */
export function providerError(body: unknown): string | null {
  if (typeof body === 'string') return body
  // Errors can also arrive wrapped in an array: [{"senderName": "..."}].
  if (Array.isArray(body)) {
    for (const item of body) {
      const found = providerError(item)
      if (found) return found
    }
    return null
  }
  if (!body || typeof body !== 'object') return null
  for (const v of Object.values(body as Record<string, unknown>)) {
    if (typeof v === 'string') return v
    if (Array.isArray(v) && typeof v[0] === 'string') return v[0]
  }
  return null
}

/**
 * The request fields Semaphore names when it refuses a message. A 5xx that
 * names one of these is a refusal about this request, not an outage.
 */
export const REQUEST_FIELDS = ['senderName', 'sendername', 'number', 'apikey']

export function fieldError(body: unknown): string | null {
  for (const item of Array.isArray(body) ? body : [body]) {
    if (!item || typeof item !== 'object') continue
    for (const f of REQUEST_FIELDS) {
      const v = (item as Record<string, unknown>)[f]
      if (typeof v === 'string') return v
      if (Array.isArray(v) && typeof v[0] === 'string') return v[0]
    }
  }
  return null
}

export function firstMessage(body: unknown): SemaphoreMessage | undefined {
  return Array.isArray(body) ? (body[0] as SemaphoreMessage | undefined) : undefined
}

/**
 * The form Semaphore is posted. Separate from the fetch so the sender-name
 * rule is testable: `sendername` is sent only when one is configured, because
 * naming a name that is not approved is refused outright, and an account with
 * no approved name has no default to fall back to either.
 */
export function buildSemaphoreForm(
  apiKey: string,
  destination: string,
  body: string,
  senderName: string,
): URLSearchParams {
  const form = new URLSearchParams({
    apikey: apiKey,
    number: toSemaphoreNumber(destination),
    message: body,
  })
  if (senderName) form.set('sendername', senderName)
  return form
}

/**
 * What gets written to sms_messages.provider_response: which provider, what it
 * returned, and the id to look the message up by on Semaphore's side. The API
 * key is never part of it, so nothing secret is stored.
 */
export function shapeSemaphoreResponse(
  httpStatus: number,
  parsed: unknown,
  rateLimitRemaining: string | null,
) {
  const first = firstMessage(parsed)
  return {
    provider: 'semaphore',
    http_status: httpStatus,
    rate_limit_remaining: rateLimitRemaining,
    message_id: first?.message_id ?? null,
    semaphore_status: first?.status ?? null,
    body: parsed,
  }
}

/**
 * Which failures are worth trying again is the whole game here. Every
 * Semaphore send costs a credit, so retrying a request that can only fail the
 * same way is paying for nothing; not retrying an outage loses a real
 * notification.
 */
export function classifySemaphore(
  status: number,
  body: unknown,
  retryAfter: string | null,
): Outcome {
  if (status >= 200 && status < 300) {
    // Success is an array with one message object per number. Anything else
    // inside a 2xx -- an object of validation errors, a bare string -- means
    // nothing was handed to the network, so it must not be logged as sent.
    const msg = firstMessage(body)
    if (!msg?.message_id) {
      return {
        kind: 'failed',
        error: `Semaphore did not accept the message: ${providerError(body) ?? 'unexpected response'}`,
        response: body,
      }
    }
    // Accepted is not delivered. Queued, Pending and Sent all mean Semaphore
    // took it; the message_id is how to look up what the network did next.
    if (msg.status === 'Failed' || msg.status === 'Refunded') {
      return { kind: 'failed', error: `Semaphore reported the message as ${msg.status}.`, response: body }
    }
    return { kind: 'sent', response: body }
  }

  if (status === 401 || status === 403) {
    return {
      kind: 'failed',
      error: `Semaphore rejected the API key (${status}). Check SMS_API_KEY.`,
      response: body,
    }
  }

  if (status === 429) {
    const after = retryAfter ? Number(retryAfter) : NaN
    return {
      kind: 'retry',
      error: 'Rate limited by Semaphore (429).',
      response: body,
      afterSeconds: Number.isFinite(after) ? after : undefined,
    }
  }

  if (status >= 500) {
    // Semaphore reports some refusals as a 500: a missing or unapproved sender
    // name comes back as 500 with [{"senderName": "..."}]. Retrying only
    // repeats the refusal, so those fail at once. A bare 5xx is a fault on
    // Semaphore's side that may clear up, and in a queue waiting is free.
    const reason = fieldError(body)
    if (reason) {
      return { kind: 'failed', error: `Semaphore refused the message: ${reason}`, response: body }
    }
    return { kind: 'retry', error: `Semaphore returned ${status}.`, response: body }
  }

  // Any other 4xx is about this request -- a bad number, sender name or no
  // credits. Sending it again would fail the same way.
  return {
    kind: 'failed',
    error: `Semaphore refused the message (${status}): ${providerError(body) ?? 'no reason given'}`,
    response: body,
  }
}

/** A network failure or timeout: waiting is free, so these are retried. */
export function classifyTransportError(message: string): Outcome {
  const timedOut = message.includes('timed out') || message.includes('abort')
  return {
    kind: 'retry',
    error: timedOut
      ? `No answer from the SMS provider within ${REQUEST_TIMEOUT_MS / 1000}s.`
      : message,
    response: null,
  }
}
