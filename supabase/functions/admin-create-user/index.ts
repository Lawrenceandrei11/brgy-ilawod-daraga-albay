// ============================================================
// admin-create-user — creates another Admin portal account
//
// Creating a login needs the service role key, which cannot go anywhere near
// the browser, so it lives here, exactly as it does in face-login. Signing
// the new account up from the browser instead would replace the creator's
// own session with the new one.
//
// No new role and no second auth system: this creates an ordinary Supabase
// Auth user plus a profiles row whose role is one the portal already knows
// (captain, secretary, treasurer).
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// The roles the Admin portal runs on, and the only ones this can create. An
// allow-list, so "resident" or anything invented cannot come through here.
const ADMIN_ROLES = ['captain', 'secretary', 'treasurer']

// ...but only the captain may create them. The secretary and treasurer keep
// every other admin screen; this one door is the Punong Barangay's.
const MAY_CREATE = 'captain'

// Supabase's own floor is 6. Ten is the barangay's, applied in the form too.
const MIN_PASSWORD = 10

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

  // 1. Who is calling? The token is verified by Supabase Auth itself, not
  //    decoded here, so a forged one cannot get past.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'Sign in first.' }, 401)

  const { data: caller, error: callerError } = await admin.auth.getUser(token)
  if (callerError || !caller?.user) return json({ error: 'Sign in first.' }, 401)

  // 2. Is the caller the captain? Their own profile row decides, never the
  //    request body.
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', caller.user.id)
    .maybeSingle()
  if (profileError) return json({ error: 'Could not check your account.' }, 500)
  if (!profile || profile.role !== MAY_CREATE) {
    return json({ error: 'Only the Punong Barangay can add an Admin portal account.' }, 403)
  }

  // 3. What are we being asked to create?
  let body: { full_name?: string; email?: string; role?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Nothing to create.' }, 400)
  }

  const fullName = (body.full_name ?? '').trim()
  const email = (body.email ?? '').trim().toLowerCase()
  const role = (body.role ?? '').trim()
  const password = body.password ?? ''

  if (fullName.length < 4) return json({ error: 'Enter the full name of the account holder.' }, 400)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: 'That does not look like an email address.' }, 400)
  if (!ADMIN_ROLES.includes(role)) return json({ error: 'Choose Captain, Secretary or Treasurer.' }, 400)
  if (password.length < MIN_PASSWORD) {
    return json({ error: `The password must be at least ${MIN_PASSWORD} characters.` }, 400)
  }

  // 4. Create the login. email_confirm: true because this project has email
  //    confirmation switched off; the account is usable straight away.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (createError || !created?.user) {
    const message = createError?.message ?? ''
    if (/already/i.test(message) || /registered/i.test(message)) {
      return json({ error: 'An account with that email address already exists.' }, 409)
    }
    console.error('admin-create-user: createUser failed:', message)
    return json({ error: 'The account could not be created.' }, 500)
  }

  // 5. Give it its barangay record.
  //
  //    The row already exists: creating the login fires handle_new_user(),
  //    which files every new sign-up as a pending resident. So this is an
  //    update, not an insert -- and it runs as the captain who asked for it,
  //    not as the service role.
  //
  //    That is deliberate. profiles_guard_columns() lets only barangay staff
  //    change a role or status, and it reads auth.uid() to decide. The
  //    service role has no auth.uid(), so it is nobody, and the guard refuses
  //    it. The captain is somebody, and is allowed. Promoting the account in
  //    their name keeps the guard doing its job instead of carving a hole in
  //    it for the server.
  const asCaller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY') ?? token,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  )

  // Approved on the spot: a staff account is made by staff, so there is
  // nothing left to verify. .select() so that zero rows updated is an error
  // here rather than a login with a resident's record behind it.
  const { error: rowError } = await asCaller
    .from('profiles')
    .update({
      role,
      status: 'approved',
      full_name: fullName,
      email,
      approved_by: caller.user.id,
      approved_at: new Date().toISOString(),
    })
    .eq('id', created.user.id)
    .select('id')
    .single()

  if (rowError) {
    // Leave nothing half-made: a login with no barangay record can sign in
    // and see an empty portal.
    await admin.auth.admin.deleteUser(created.user.id)
    console.error('admin-create-user: profile update failed:', rowError.message)
    // The database's own messages are written for staff, so they are worth
    // showing -- a silent "could not be created" cost a day of guessing.
    return json({ error: `The account could not be created: ${rowError.message}` }, 500)
  }

  // The password is never echoed back, logged, or stored anywhere by us.
  return json({ id: created.user.id, full_name: fullName, email, role })
})
