import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill it in.'
  )
}

/**
 * The one Supabase client for the whole app.
 *
 * This uses the publishable key, which is safe in the browser: it grants
 * nothing beyond what Row Level Security permits for the `anon` and
 * `authenticated` roles. The service role key is never bundled — the only
 * thing that holds it is the face-login Edge Function.
 */
export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

/**
 * Supabase surfaces Postgres errors verbatim. RAISE EXCEPTION messages from
 * our own functions are written for residents, so they pass straight through;
 * anything else gets a plain fallback rather than leaking internals.
 */
export function friendlyError(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return null
  const msg = error.message ?? String(error)

  if (/duplicate key|already exists/i.test(msg)) return 'That record already exists.'
  if (/row-level security/i.test(msg)) return 'You do not have permission to do that.'
  if (/JWT|not authenticated|Auth session missing/i.test(msg)) {
    return 'Your session has expired. Please sign in again.'
  }
  if (/Failed to fetch|NetworkError/i.test(msg)) {
    return 'Could not reach the barangay server. Check your connection.'
  }

  // Messages we wrote ourselves in PL/pgSQL read as sentences; show them.
  if (/^[A-Z].*[.?]$/.test(msg) && msg.length < 200) return msg

  return fallback
}
