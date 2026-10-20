// ============================================================
// sms-dispatch — the only holder of the SMS API key
//
// The app is a browser-only SPA, so any key it could reach is a key the whole
// internet can read out of the JS bundle. This function is where the key
// lives, exactly as face-login is the only holder of the service role key.
//
// It is deliberately dumb. It does not decide who to text, when, or how fast:
// claim_sms() in Postgres does all of that, because pacing has to survive
// two invocations overlapping and a function dying mid-flight. This sends
// whatever it is handed and reports back.
//
// Called once every ten seconds by pg_cron, but only when there is work.
//
// ---------------------------------------------------------------------------
// One provider: Semaphore, sender name BRGYILAWOD.
//
// httpSMS used to sit beside it. It relayed through an Android handset on an
// ordinary SIM, which needed nobody's approval, and it existed only so the
// system could be demonstrated end to end while the telcos reviewed the
// barangay's Sender Name. That review finished: BRGYILAWOD is approved on
// Globe and Smart, a real text arrived on a real handset showing it as the
// sender, and the handset relay has been removed.
//
// What that removal cost, deliberately: there is no second provider to fall
// back to. If Semaphore is down, messages wait in the queue and retry. That
// is the right trade -- a fallback that shows residents a random mobile
// number instead of the barangay's name is not a fallback anyone wanted.
//
// The sender name is NOT hardcoded. It is `settings.sms_semaphore_sendername`,
// read fresh on every invocation like the rest of them, so the barangay can
// change it without a deploy.
// ---------------------------------------------------------------------------
//
// The pure decisions -- which failures to retry, how to shape the request and
// the stored response, what counts as a valid provider setting -- live in
// ./semaphore.ts so that `npm test` can cover them. BOTH FILES must be
// deployed together.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10'
import { timingSafeEqual } from 'https://deno.land/std@0.224.0/crypto/timing_safe_equal.ts'
import {
  backoffFor,
  buildSemaphoreForm,
  classifySemaphore,
  classifyTransportError,
  MAX_ATTEMPTS,
  type Outcome,
  REQUEST_TIMEOUT_MS,
  resolveProvider,
  SEMAPHORE_URL,
  shapeSemaphoreResponse,
  toE164,
} from './semaphore.ts'

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

/** Error shapes are undocumented, so keep whatever came back. */
async function readBody(res: Response): Promise<unknown> {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return { raw: text }
  }
}

/**
 * Semaphore. Form-encoded with the key as a field, which is the only way it
 * takes one, and the number with the leading + stripped.
 */
async function sendViaSemaphore(
  apiKey: string,
  destination: string,
  body: string,
  senderName: string,
): Promise<{ outcome: Outcome; response: unknown }> {
  const res = await fetch(SEMAPHORE_URL, {
    method: 'POST',
    body: buildSemaphoreForm(apiKey, destination, body, senderName),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  const parsed = await readBody(res)
  const response = shapeSemaphoreResponse(
    res.status,
    parsed,
    res.headers.get('x-ratelimit-remaining'),
  )

  // One loud row rather than six identical ones per message. Named, never
  // echoed.
  if (res.status === 401 || res.status === 403) {
    console.error('sms-dispatch: SMS_API_KEY is rejected by Semaphore.')
  }

  return { outcome: classifySemaphore(res.status, parsed, res.headers.get('retry-after')), response }
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
      ])

    const setting = (k: string) => settings?.find((s) => s.key === k)?.value?.value

    const gapMs = Number(setting('sms_min_gap_seconds') ?? 10) * 1000

    // 1 when pg_cron ticks every ten seconds, 5 when it could only be
    // scheduled once a minute. Same throughput either way; migration 16 works
    // out which and records it.
    const batch = Math.max(1, Math.min(Number(setting('sms_batch_per_invocation') ?? 1), 10))

    // Checked before anything is claimed. A provider this deployment cannot
    // honour is a configuration mistake, and refusing leaves the queue intact
    // rather than burning an attempt per message on a row that is fine.
    const providerCheck = resolveProvider(setting('sms_provider'))
    if (!providerCheck.ok) {
      console.error(`sms-dispatch: ${providerCheck.error}`)
      return json({ error: providerCheck.error }, 500)
    }

    const apiKey = Deno.env.get('SMS_API_KEY')
    if (!apiKey) {
      // Named, never echoed.
      console.error('sms-dispatch: SMS_API_KEY is not set.')
      return json({ error: 'SMS_API_KEY is not configured.' }, 500)
    }

    // The Semaphore Sender Name. Not sms_sender_label, which is the
    // "Brgy Ilawod:" prefix inside the message text. Unset means none is sent
    // and Semaphore falls back to the account default -- which an account with
    // no approved name does not have, so it would refuse the text. The
    // barangay's approved name is BRGYILAWOD and it belongs in this row, not
    // in this file.
    const senderName = String(setting('sms_semaphore_sendername') ?? '').trim()

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
        const attempt = await sendViaSemaphore(apiKey, destination, row.body, senderName)
        outcome = attempt.outcome
        // The provider's own answer, kept for the Text messages screen. The
        // key is never echoed back, so nothing secret is stored.
        outcome.response = attempt.response
      } catch (err) {
        outcome = classifyTransportError(err instanceof Error ? err.message : String(err))
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
        const wait = outcome.afterSeconds ?? backoffFor(row.attempts)
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
