// ============================================================
// sms-dispatch — the only holder of the SMS API keys
//
// The app is a browser-only SPA, so any key it could reach is a key the whole
// internet can read out of the JS bundle. This function is where the key
// lives, exactly as face-login is where the service role key lives.
//
// It is deliberately dumb. It does not decide who to text, when, or how fast:
// claim_sms() in Postgres does all of that, because pacing has to survive
// two invocations overlapping and a function dying mid-flight. This sends
// whatever it is handed and reports back.
//
// Called once every ten seconds by pg_cron, but only when there is work.
//
// ---------------------------------------------------------------------------
// Two providers, one at a time.
//
// Semaphore is the barangay's real provider, but it refuses to send until the
// telcos approve the Sender Name BRGYILAWOD, and that queue is outside anyone
// here's control. httpSMS sends through an Android handset on an ordinary SIM
// instead, which needs nobody's approval, so the system can be demonstrated
// end to end while the real sender name is waiting.
//
// Which one is used is the `sms_provider` setting, read fresh on every
// invocation like the rest of them, so switching back to Semaphore the day
// BRGYILAWOD is approved is one row in `settings` and no deploy.
//
// The difference between them is confined to the two send functions below.
// Everything else -- the queue, the pacing, the retry policy, the daily cap,
// the test redirect and the log -- is provider-neutral and untouched.
//
// Honest limitation of httpSMS: the message leaves a real SIM, so residents
// see that handset's mobile number, not "BRGYILAWOD". No app on a phone can
// set an alphanumeric sender; only the telco can.
// ---------------------------------------------------------------------------
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10'
import { timingSafeEqual } from 'https://deno.land/std@0.224.0/crypto/timing_safe_equal.ts'

// Semaphore's official API. This used to point at a free third-party relay
// (smsapiph.onrender.com) that issued its own keys, capped itself at 30 texts
// a day and answered "sent" with no way to confirm delivery. A Semaphore key
// sent there is rejected as "Invalid API key format".
const SEMAPHORE_URL = 'https://api.semaphore.co/api/v4/messages'

// httpSMS relays through an Android phone that is signed in to the account.
// It takes JSON and full E.164 numbers, which is already how recipients are
// stored, so unlike Semaphore nothing has to be reshaped.
const HTTPSMS_URL = 'https://api.httpsms.com/v1/messages/send'

// Semaphore is not on a sleeping free tier, so there is no cold start to wait
// out. Long enough for a slow network, short enough that a hung request does
// not hold up the queue.
const REQUEST_TIMEOUT_MS = 30_000

const MAX_ATTEMPTS = 6

// Tens of seconds to minutes, not the 1s-to-32s the provider's docs suggest.
// That advice assumes an in-process retry loop; with a queue, waiting is free.
const BACKOFF_SECONDS = [30, 60, 120, 240, 480, 960]

// Deliberately no CORS headers, unlike face-login. This is a server-to-server
// endpoint. Without an Access-Control-Allow-Origin a browser cannot read the
// response even if someone learned the secret.
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function encode(s: string) {
  return new TextEncoder().encode(s)
}

/**
 * The TypeScript twin of normalize_ph_mobile() in migration 16, kept in step
 * with it. It exists for one caller: sms_test_recipient, which is the only
 * number reaching this function that Postgres has not already normalised.
 */
function toE164(mobile: string): string | null {
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
function toSemaphoreNumber(e164: string): string {
  return e164.replace(/^\+/, '')
}

/**
 * Semaphore's error shapes are undocumented. Validation failures tend to come
 * back as an object of field -> messages, so pull out the first readable
 * string rather than showing staff raw JSON in the Text messages screen.
 */
function providerError(body: unknown): string | null {
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

// The request fields Semaphore names when it refuses a message. A 5xx that
// names one of these is a refusal about this request, not an outage.
const REQUEST_FIELDS = ['senderName', 'sendername', 'number', 'apikey']

function fieldError(body: unknown): string | null {
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

/**
 * verify_jwt would not help here: every signed-in resident holds a JWT signed
 * by this project, so it would authenticate them and then happily let them
 * drain the queue. A dedicated secret's blast radius is "can send the texts
 * that were already queued"; the service role key's is the whole database.
 */
function authorised(req: Request): boolean {
  const expected = Deno.env.get('SMS_DISPATCH_SECRET') ?? ''
  const got = req.headers.get('x-sms-dispatch-secret') ?? ''
  if (!expected || got.length !== expected.length) return false
  return timingSafeEqual(encode(got), encode(expected))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Outcome =
  | { kind: 'sent'; response: unknown }
  | { kind: 'failed'; error: string; response: unknown }
  | { kind: 'retry'; error: string; response: unknown; afterSeconds?: number }

type SemaphoreMessage = { message_id?: number | string; status?: string }

function firstMessage(body: unknown): SemaphoreMessage | undefined {
  return Array.isArray(body) ? (body[0] as SemaphoreMessage | undefined) : undefined
}

/**
 * Which failures are worth trying again is the whole game here. Every
 * Semaphore send costs a credit, so retrying a request that can only fail the
 * same way is paying for nothing; not retrying an outage loses a real
 * notification.
 */
function classifySemaphore(status: number, body: unknown, retryAfter: string | null): Outcome {
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
    // One loud row rather than six identical ones per message.
    console.error('sms-dispatch: SMS_API_KEY is rejected by Semaphore.')
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
    // Semaphore reports some refusals as a 500: a missing sender name comes
    // back as 500 with [{"senderName": "..."}]. Retrying only repeats the
    // refusal, so those fail at once. A bare 5xx is a fault on Semaphore's
    // side that may clear up, and in a queue waiting is free.
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

/**
 * Semaphore. Form-encoded with the key as a field, which is the only way it
 * takes one, and the number with the leading + stripped. Unchanged from when
 * it was the only provider: this is the path the barangay goes back to once
 * BRGYILAWOD is approved.
 */
async function sendViaSemaphore(
  apiKey: string,
  destination: string,
  body: string,
  senderName: string,
): Promise<{ outcome: Outcome; response: unknown }> {
  const form = new URLSearchParams({
    apikey: apiKey,
    number: toSemaphoreNumber(destination),
    message: body,
  })
  // sendername only when configured; naming one that is not yet approved is
  // refused outright.
  if (senderName) form.set('sendername', senderName)

  const res = await fetch(SEMAPHORE_URL, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  const parsed = await readBody(res)
  const first = firstMessage(parsed)
  const response = {
    provider: 'semaphore',
    http_status: res.status,
    rate_limit_remaining: res.headers.get('x-ratelimit-remaining'),
    message_id: first?.message_id ?? null,
    semaphore_status: first?.status ?? null,
    body: parsed,
  }

  return { outcome: classifySemaphore(res.status, parsed, res.headers.get('retry-after')), response }
}

/**
 * httpSMS. JSON, the key in a header, and both numbers in full E.164.
 *
 * `from` is not a choice: it must be the number of the Android phone signed
 * in to the account, because that handset is what actually sends the message.
 */
async function sendViaHttpSms(
  apiKey: string,
  destination: string,
  body: string,
  from: string,
): Promise<{ outcome: Outcome; response: unknown }> {
  const res = await fetch(HTTPSMS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ from, to: destination, content: body }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  const parsed = await readBody(res)
  const data = (parsed as { data?: { id?: string; status?: string } } | null)?.data
  const response = {
    provider: 'httpsms',
    http_status: res.status,
    // Same field name Semaphore's branch writes, so the Text messages screen
    // and anything reading the log do not have to know which provider sent it.
    message_id: data?.id ?? null,
    httpsms_status: data?.status ?? null,
    body: parsed,
  }

  return { outcome: classifyHttpSms(res.status, parsed, res.headers.get('retry-after')), response }
}

/**
 * The same judgement as Semaphore's, against httpSMS's own answers.
 *
 * The phone is the part that breaks here, not the API: a handset that is off,
 * out of signal or out of load is a reason to wait, not to give up, so those
 * are retried rather than failed.
 */
function classifyHttpSms(status: number, body: unknown, retryAfter: string | null): Outcome {
  if (status >= 200 && status < 300) {
    const data = (body as { data?: { id?: string } } | null)?.data
    // Accepted means httpSMS has it, not that the handset has sent it. Without
    // an id nothing was queued, so it must not be logged as sent.
    if (!data?.id) {
      return {
        kind: 'failed',
        error: `httpSMS did not accept the message: ${providerError(body) ?? 'no message id returned'}`,
        response: body,
      }
    }
    return { kind: 'sent', response: body }
  }

  if (status === 401 || status === 403) {
    // One loud row rather than six identical ones per message.
    console.error('sms-dispatch: HTTPSMS_API_KEY is rejected by httpSMS.')
    return {
      kind: 'failed',
      error: `httpSMS rejected the API key (${status}). Check HTTPSMS_API_KEY.`,
      response: body,
    }
  }

  if (status === 429) {
    const after = retryAfter ? Number(retryAfter) : NaN
    return {
      kind: 'retry',
      error: 'Rate limited by httpSMS (429).',
      response: body,
      afterSeconds: Number.isFinite(after) ? after : undefined,
    }
  }

  // 402 is out of credit and 404 is usually a `from` number that no phone is
  // signed in with. Both are settings problems that another attempt repeats.
  if (status === 402 || status === 404 || status === 422) {
    return {
      kind: 'failed',
      error: `httpSMS refused the message (${status}): ${providerError(body) ?? 'no reason given'}`,
      response: body,
    }
  }

  if (status >= 500) {
    return { kind: 'retry', error: `httpSMS returned ${status}.`, response: body }
  }

  return {
    kind: 'failed',
    error: `httpSMS refused the message (${status}): ${providerError(body) ?? 'no reason given'}`,
    response: body,
  }
}

/** Error shapes are undocumented on both sides, so keep whatever came back. */
async function readBody(res: Response): Promise<unknown> {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return { raw: text }
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!authorised(req)) return json({ error: 'Forbidden' }, 403)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  try {
    const { data: settings } = await admin
      .from('settings')
      .select('key, value')
      .in('key', [
        'sms_min_gap_seconds',
        'sms_batch_per_invocation',
        'sms_test_recipient',
        'sms_semaphore_sendername',
        'sms_provider',
        'httpsms_from',
      ])

    const setting = (k: string) => settings?.find((s) => s.key === k)?.value?.value

    const gapMs = Number(setting('sms_min_gap_seconds') ?? 10) * 1000

    // 1 when pg_cron ticks every ten seconds, 5 when it could only be
    // scheduled once a minute. Same throughput either way; migration 16 works
    // out which and records it.
    const batch = Math.max(1, Math.min(Number(setting('sms_batch_per_invocation') ?? 1), 10))

    // The Semaphore Sender Name, if one is set. Not sms_sender_label, which is
    // the "Brgy Ilawod:" prefix inside the message. Unset means none is sent
    // and Semaphore falls back to the account default -- which an account
    // with no approved name does not have, so set "SEMAPHORE" until the
    // barangay's own name is approved, then switch to that.
    const senderName = String(setting('sms_semaphore_sendername') ?? '').trim()

    // Which provider sends. Defaults to semaphore, so an unset or misspelled
    // value falls back to the barangay's real provider rather than silently
    // routing through a handset.
    const provider = String(setting('sms_provider') ?? 'semaphore').trim().toLowerCase() === 'httpsms'
      ? 'httpsms'
      : 'semaphore'

    // Each provider has its own key, so switching back does not mean putting
    // the other one's secret back.
    const apiKey = provider === 'httpsms'
      ? Deno.env.get('HTTPSMS_API_KEY')
      : Deno.env.get('SMS_API_KEY')
    if (!apiKey) {
      const name = provider === 'httpsms' ? 'HTTPSMS_API_KEY' : 'SMS_API_KEY'
      console.error(`sms-dispatch: ${name} is not set.`)
      return json({ error: `${name} is not configured.` }, 500)
    }

    // The handset that sends, when httpSMS is the provider. Checked before a
    // message is claimed: without it every send would fail at the provider and
    // burn an attempt on a row that is fine.
    const httpSmsFrom = toE164(String(setting('httpsms_from') ?? '').trim()) ?? null
    if (provider === 'httpsms' && !httpSmsFrom) {
      console.error('sms-dispatch: httpsms_from is missing or not a valid PH mobile.')
      return json({ error: 'httpsms_from is not configured.' }, 500)
    }

    // The mechanism that makes this testable without texting the barangay.
    //
    // Normalised, unlike the raw setting. `recipient` was written by
    // normalize_ph_mobile at queue time and is therefore E.164, but this value
    // is typed by hand into `settings` and the README asks for 09XXXXXXXXX.
    // Redirecting to the unnormalised form would send the test in a different
    // shape from every real message, so a passing test would prove nothing
    // about production -- and a failing one would look like a broken key.
    const rawTestRecipient = setting('sms_test_recipient') || null
    const testRecipient = rawTestRecipient ? toE164(rawTestRecipient) : null

    // Falling back to the real recipients here would text actual residents
    // while staff believed they were testing. Refuse instead.
    if (rawTestRecipient && !testRecipient) {
      console.error('sms-dispatch: sms_test_recipient is not a valid PH mobile.')
      return json(
        { error: 'sms_test_recipient is not a valid Philippine mobile number.' },
        500,
      )
    }

    let sent = 0
    let failed = 0
    let requeued = 0

    for (let i = 0; i < batch; i++) {
      const { data: claimed, error: claimError } = await admin.rpc('claim_sms', {
        p_stale_seconds: 180,
      })
      if (claimError) throw claimError

      const row = claimed?.[0]
      if (!row) break // nothing due, or the pacing gates said not yet

      // Belt and braces: queue_sms writes these as `skipped`, so a claimed row
      // should always have somewhere to go.
      if (!row.recipient) {
        await admin.from('sms_messages').update({
          status: 'failed',
          last_error: 'No recipient number on the queued message.',
        }).eq('id', row.id)
        failed++
        continue
      }

      const destination = testRecipient ?? row.recipient

      let outcome: Outcome
      try {
        // Not named `sent`: that is the counter in this scope.
        const attempt = provider === 'httpsms'
          ? await sendViaHttpSms(apiKey, destination, row.body, httpSmsFrom!)
          : await sendViaSemaphore(apiKey, destination, row.body, senderName)

        outcome = attempt.outcome
        // The provider's own answer, kept for the Text messages screen: which
        // provider, what it returned, and the id to look the message up by on
        // their side. The key is never echoed back, so nothing secret is
        // stored.
        outcome.response = attempt.response
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        outcome = {
          kind: 'retry',
          error: message.includes('timed out') || message.includes('abort')
            ? `No answer from the SMS provider within ${REQUEST_TIMEOUT_MS / 1000}s.`
            : message,
          response: null,
        }
      }

      if (outcome.kind === 'sent') {
        await admin.from('sms_messages').update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          sent_to: destination,
          provider_response: outcome.response,
          last_error: null,
        }).eq('id', row.id)
        sent++
      } else if (outcome.kind === 'failed' || row.attempts >= MAX_ATTEMPTS) {
        await admin.from('sms_messages').update({
          status: 'failed',
          sent_to: destination,
          provider_response: outcome.response,
          last_error: outcome.kind === 'failed'
            ? outcome.error
            : `${outcome.error} Given up after ${MAX_ATTEMPTS} attempts.`,
        }).eq('id', row.id)
        failed++
      } else {
        const wait = outcome.afterSeconds
          ?? BACKOFF_SECONDS[Math.min(row.attempts - 1, BACKOFF_SECONDS.length - 1)]
        await admin.from('sms_messages').update({
          status: 'queued',
          next_attempt_at: new Date(Date.now() + wait * 1000).toISOString(),
          provider_response: outcome.response,
          last_error: outcome.error,
        }).eq('id', row.id)
        requeued++
      }

      // Only relevant on the once-a-minute fallback schedule; on the ten
      // second tick the loop has already ended.
      if (i < batch - 1) await sleep(gapMs)
    }

    return json({ sent, failed, requeued })
  } catch (err) {
    console.error('sms-dispatch failed:', err)
    return json({ error: 'The SMS dispatcher failed. See the function logs.' }, 500)
  }
})
