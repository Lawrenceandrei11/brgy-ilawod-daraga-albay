/**
 * Password recovery, minus the React.
 *
 * The decisions worth testing are all here: what the resident is told, what
 * counts as an acceptable new password, when a recovery link should be treated
 * as spent, and the order the password change happens in. The pages are then
 * thin enough to read at a glance.
 *
 * No custom tokens. Supabase Auth issues the recovery link and the client's
 * detectSessionInUrl turns it into a session; this file never sees a token and
 * never stores one.
 */

import { MIN_PASSWORD } from './password.js'

/**
 * The one sentence a resident sees after asking for a link -- whether or not
 * the address has an account.
 *
 * Saying "no account found" would turn this form into a way of asking the
 * barangay which of your neighbours are registered. One message, every time,
 * including when the request failed outright: a resident who mistyped their
 * address and one whose email bounced both need to look in the same place.
 */
export const RESET_SENT_MESSAGE =
  'If that email address has an account, we have sent a link to reset the password. ' +
  'Check your inbox, and the spam folder, in the next few minutes.'

/** Where the emailed link must land. Allow-listed in Supabase, not invented here. */
export function resetRedirectTo(origin) {
  return `${String(origin ?? '').replace(/\/+$/, '')}/reset-password`
}

/**
 * Ask Supabase to send a recovery link.
 *
 * Always resolves the same way. The error is swallowed on purpose -- see
 * RESET_SENT_MESSAGE -- but it is returned under `silentError` so a caller
 * could log it somewhere that is not the screen. Nothing does today.
 */
export async function requestPasswordReset({ client, email, origin }) {
  const address = String(email ?? '').trim()
  if (!address) return { ok: false, message: 'Enter your email address.' }

  let silentError = null
  try {
    const { error } = await client.auth.resetPasswordForEmail(address, {
      redirectTo: resetRedirectTo(origin),
    })
    if (error) silentError = error
  } catch (err) {
    silentError = err
  }

  // Deliberately `ok: true` even when silentError is set.
  return { ok: true, message: RESET_SENT_MESSAGE, silentError }
}

/**
 * What is wrong with the new password, or null when nothing is.
 *
 * MIN_PASSWORD is the barangay's own floor, shared with the Add Admin and
 * Change Password forms so the three cannot drift apart. It is a courtesy to
 * the resident, not an enforced rule: what actually binds is the minimum
 * length configured on the Supabase project.
 */
export function newPasswordProblem(next, confirm) {
  const a = String(next ?? '')
  const b = String(confirm ?? '')

  if (!a) return 'Enter a new password.'
  if (a.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`
  if (!b) return 'Type the new password again to confirm it.'
  if (a !== b) return 'The two passwords do not match.'
  return null
}

/**
 * Change the password, then end the recovery session.
 *
 * The ordering is the point of this function. Once updateUser has succeeded the
 * password *is* changed, so nothing afterwards may report failure: a sign-out
 * that fails comes back as `ok: true` with `signOutError` set, never as an
 * error the resident reads. Telling someone their new password did not save
 * when it did would leave them locked out of an account that was waiting for
 * them.
 *
 * Signing out is still worth doing -- it forces the new password to be used to
 * get back in, rather than letting the recovery session quietly carry on.
 *
 * Errors come back raw rather than as sentences, because turning a Supabase
 * error into something a resident should read is the page's job (friendlyError
 * lives with the client, which this file deliberately does not import).
 */
export async function applyNewPassword({ client, next, confirm }) {
  const problem = newPasswordProblem(next, confirm)
  if (problem) return { ok: false, problem, error: null, signOutError: null }

  try {
    const { error } = await client.auth.updateUser({ password: next })
    if (error) return { ok: false, problem: null, error, signOutError: null }
  } catch (err) {
    return { ok: false, problem: null, error: err, signOutError: null }
  }

  // Past this line the change has landed. Failures are recorded, not raised.
  let signOutError = null
  try {
    const result = await client.auth.signOut()
    if (result?.error) signOutError = result.error
  } catch (err) {
    signOutError = err
  }

  return { ok: true, problem: null, error: null, signOutError }
}

/**
 * Whether the reset form can be shown yet.
 *
 *   waiting  the client is still reading the link out of the URL
 *   ready    there is a recovery session, so the link was good and fresh
 *   expired  no usable recovery session once we have finished looking
 *
 * `loading` is the session check on its own (useAuth's `sessionLoading`), not
 * the composite `loading` that also waits on the profile query. Both are plain
 * booleans. The form must not accuse anyone of a stale link while the session
 * is still being resolved.
 *
 * `isRecovery` is the gate that matters. A session alone is not enough: an
 * ordinary signed-in resident who navigates here has no PASSWORD_RECOVERY
 * event behind them and is sent to ask for a link, so an unattended signed-in
 * screen cannot be used to change a password without knowing the current one.
 * A reload drops the flag and lands here too -- the safe direction to fail.
 *
 * `graceElapsed` exists because a visitor without a recovery session looks
 * identical to a bad link for the first instant, and because the recovery
 * event arrives from a setTimeout a moment after the session itself. The page
 * waits a beat before saying anything discouraging.
 */
export function recoveryState({ loading, hasSession, isRecovery, graceElapsed }) {
  if (loading) return 'waiting'
  if (hasSession && isRecovery) return 'ready'
  if (!graceElapsed) return 'waiting'
  return 'expired'
}

export const EXPIRED_MESSAGE =
  'This reset link has expired, or it has already been used. Ask for a new one and open the ' +
  'newest email.'
