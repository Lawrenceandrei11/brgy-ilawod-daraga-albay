// ============================================================
// sms-dispatch — the only holder of the SMS API key
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
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10'
import { timingSafeEqual } from 'https://deno.land/std@0.224.0/crypto/timing_safe_equal.ts'

const PROVIDER_URL = 'https://smsapiph.onrender.com/api/v1/send/sms'

// The provider runs on Render's free tier, which spins down when idle. A cold
// start is 30-60 seconds, so a short timeout would fail every first message of
// the day and retry it forever.
const REQUEST_TIMEOUT_MS = 90_000

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

/**
 * Which failures are worth trying again is the whole game here. Retrying a
 * mistyped mobile number six times wastes six of the day's messages and still
 * fails; not retrying a cold start loses a real notification.
 */
function classify(status: number, body: unknown, retryAfter: string | null): Outcome {
  const code = (body as { code?: number })?.code

  if (status >= 200 && status < 300) {
    // 4004 means every channel failed, reported inside a 2xx.
    if (code === 4004) {
      return { kind: 'failed', error: 'All delivery channels failed (4004).', response: body }
    }
    return { kind: 'sent', response: body }
  }

  // Already accepted. Treating this as a failure would queue a duplicate.
  if (status === 409) return { kind: 'sent', response: body }

  if (status === 400 || status === 422 || code === 4004) {
    return {
      kind: 'failed',
      error: `The provider rejected this message (${status}). The number is probably not a valid Philippine mobile.`,
      response: body,
    }
  }

  if (status === 401 || status === 403) {
    // One loud row rather than six identical ones per message.
    console.error('sms-dispatch: SMS_API_KEY is rejected by the provider.')
    return {
      kind: 'failed',
      error: `The SMS API key was rejected (${status}). Check SMS_API_KEY.`,
      response: body,
    }
  }

  if (status === 429) {
    const after = retryAfter ? Number(retryAfter) : NaN
    return {
      kind: 'retry',
      error: 'Rate limited by the provider (429).',
      response: body,
      afterSeconds: Number.isFinite(after) ? after : undefined,
    }
  }

  return { kind: 'retry', error: `Provider returned ${status}.`, response: body }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!authorised(req)) return json({ error: 'Forbidden' }, 403)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const apiKey = Deno.env.get('SMS_API_KEY')
  if (!apiKey) {
    console.error('sms-dispatch: SMS_API_KEY is not set.')
    return json({ error: 'SMS_API_KEY is not configured.' }, 500)
  }

  try {
    const { data: settings } = await admin
      .from('settings')
      .select('key, value')
      .in('key', ['sms_min_gap_seconds', 'sms_batch_per_invocation', 'sms_test_recipient'])

    const setting = (k: string) => settings?.find((s) => s.key === k)?.value?.value

    const gapMs = Number(setting('sms_min_gap_seconds') ?? 10) * 1000

    // 1 when pg_cron ticks every ten seconds, 5 when it could only be
    // scheduled once a minute. Same throughput either way; migration 16 works
    // out which and records it.
    const batch = Math.max(1, Math.min(Number(setting('sms_batch_per_invocation') ?? 1), 10))

    // The mechanism that makes this testable without texting the barangay.
    const testRecipient = setting('sms_test_recipient') || null

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
        const res = await fetch(PROVIDER_URL, {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient: destination, message: row.body }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })

        const text = await res.text()
        let parsed: unknown
        try {
          parsed = text ? JSON.parse(text) : null
        } catch {
          // The success shape is undocumented, so keep whatever came back.
          parsed = { raw: text }
        }

        // Worth recording: if the real allowance is tighter than the docs say,
        // this is where it will show up rather than as mystery 429s.
        const remaining = res.headers.get('x-ratelimit-remaining')
        const response = { http_status: res.status, rate_limit_remaining: remaining, body: parsed }

        outcome = classify(res.status, parsed, res.headers.get('retry-after'))
        outcome.response = response
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        outcome = {
          kind: 'retry',
          error: message.includes('timed out') || message.includes('abort')
            ? `No answer within ${REQUEST_TIMEOUT_MS / 1000}s (the provider was probably cold).`
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
