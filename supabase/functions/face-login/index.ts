// ============================================================
// face-login — server-side facial verification
//
// The browser sends 128 numbers. This function is the only place that can
// read enrolled descriptors, because it is the only holder of the service
// role key. Matching itself happens in Postgres via pgvector.
//
// Why not match in the browser? Because doing so would require sending every
// resident's biometric template to anyone who opened the sign-in page.
//
// The auth chicken-and-egg — verifying someone who is not yet signed in —
// is solved by minting a single-use magic-link token for the matched
// resident and letting the client exchange it for a normal session.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  // A failed attempt has no identity by definition, so the lock is keyed on
  // the caller's address.
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('cf-connecting-ip') ??
    null
  const userAgent = req.headers.get('user-agent') ?? null

  const logAttempt = async (
    outcome: string,
    profileId: string | null,
    distance: number | null,
  ) => {
    await admin.from('auth_attempts').insert({
      profile_id: profileId,
      outcome,
      distance,
      ip,
      user_agent: userAgent,
    })
  }

  try {
    const { descriptor } = await req.json()

    if (!Array.isArray(descriptor) || descriptor.length !== 128) {
      return json({ error: 'A face descriptor of exactly 128 numbers is required.' }, 400)
    }
    if (!descriptor.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      return json({ error: 'The face descriptor contains invalid values.' }, 400)
    }

    // ---------- lockout ----------
    const [{ data: attempts }, { data: settings }] = await Promise.all([
      admin.rpc('face_attempts_recent', { p_ip: ip }),
      admin.from('settings').select('key, value').in('key', [
        'face_lockout_attempts',
        'face_lockout_minutes',
        'face_match_threshold',
      ]),
    ])

    const setting = (k: string, fallback: number) =>
      Number(settings?.find((s) => s.key === k)?.value?.value ?? fallback)

    const maxAttempts = setting('face_lockout_attempts', 5)
    const lockMinutes = setting('face_lockout_minutes', 15)
    const threshold = setting('face_match_threshold', 0.5)
    const recent = Number(attempts ?? 0)

    if (recent >= maxAttempts) {
      await logAttempt('locked', null, null)
      return json(
        {
          error: `Face sign-in is locked for ${lockMinutes} minutes after ${maxAttempts} failed attempts. Use your password instead — nothing has happened to your account.`,
          locked: true,
          attempts: recent,
          maxAttempts,
        },
        429,
      )
    }

    // ---------- match ----------
    const { data: matches, error: matchError } = await admin.rpc('match_face', {
      p_descriptor: `[${descriptor.join(',')}]`,
      p_threshold: threshold,
    })
    if (matchError) throw matchError

    const match = matches?.[0]

    if (!match) {
      await logAttempt('below_threshold', null, null)
      return json(
        {
          matched: false,
          error: 'That face does not match any enrolled resident.',
          attempts: recent + 1,
          maxAttempts,
        },
        200,
      )
    }

    // ---------- mint a session ----------
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: match.email,
    })
    if (linkError) throw linkError

    const tokenHash = link?.properties?.hashed_token
    if (!tokenHash) throw new Error('Could not issue a sign-in token.')

    await logAttempt('matched', match.profile_id, match.distance)

    return json({
      matched: true,
      token_hash: tokenHash,
      distance: match.distance,
      // A percentage is what the prototype shows and what a resident
      // understands; the raw L2 distance stays available for the audit log.
      confidence: Math.max(0, Math.round((1 - match.distance / threshold) * 100)),
      resident: {
        full_name: match.full_name,
        resident_id: match.resident_id,
      },
    })
  } catch (err) {
    console.error('face-login failed:', err)
    await logAttempt('error', null, null)
    return json({ error: 'Face sign-in is unavailable right now. Please use your password.' }, 500)
  }
})
