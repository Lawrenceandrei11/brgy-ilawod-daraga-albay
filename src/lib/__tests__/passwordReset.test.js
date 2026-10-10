/**
 * Password recovery decisions.
 *
 * The Supabase client is mocked. No email is sent, no network is touched, no
 * password is really changed, and every address below is invented.
 *
 * Two tests matter more than the rest, and both are boring on purpose:
 *
 *   - a registered and an unregistered address produce byte-identical output,
 *     because a difference of one character would turn the request form into a
 *     way of discovering which residents have accounts;
 *   - a sign-out that fails after the password has already changed is still
 *     reported as success, because telling someone their new password did not
 *     save when it did would lock them out of a working account.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { MIN_PASSWORD } from '../password.js'
import {
  EXPIRED_MESSAGE,
  RESET_SENT_MESSAGE,
  applyNewPassword,
  newPasswordProblem,
  recoveryState,
  requestPasswordReset,
  resetRedirectTo,
} from '../passwordReset.js'

const ORIGIN = 'https://brgy-ilawod-daraga-albay.vercel.app'

/** A password that clears every rule, so tests fail for the reason they name. */
const GOOD = 'bagong-password-2026'

/** A stand-in for supabase.auth. `behaviour` decides what the call does. */
function fakeClient(behaviour = () => ({ error: null })) {
  const calls = []
  return {
    calls,
    auth: {
      async resetPasswordForEmail(email, options) {
        calls.push({ email, options })
        return behaviour(email)
      },
    },
  }
}

/** A stand-in for the two calls applyNewPassword makes, in order. */
function fakeAccount({ update = () => ({ error: null }), signOut = () => ({ error: null }) } = {}) {
  const calls = { update: [], signOut: 0 }
  return {
    calls,
    auth: {
      async updateUser(attributes) {
        calls.update.push(attributes)
        return update(attributes)
      },
      async signOut() {
        calls.signOut += 1
        return signOut()
      },
    },
  }
}

// ------------------------------------------------------------ redirect URL

test('the redirect lands on /reset-password and never doubles the slash', () => {
  assert.equal(resetRedirectTo(ORIGIN), `${ORIGIN}/reset-password`)
  assert.equal(resetRedirectTo(`${ORIGIN}/`), `${ORIGIN}/reset-password`)
  assert.equal(resetRedirectTo('http://localhost:5173'), 'http://localhost:5173/reset-password')
})

// ------------------------------------------------- no account enumeration

test('a registered and an unregistered address give identical answers', async () => {
  const registered = fakeClient(() => ({ error: null }))
  const unknown = fakeClient(() => ({ error: { message: 'User not found', status: 400 } }))

  const a = await requestPasswordReset({ client: registered, email: 'known@example.test', origin: ORIGIN })
  const b = await requestPasswordReset({ client: unknown, email: 'nobody@example.test', origin: ORIGIN })

  assert.equal(a.ok, b.ok)
  assert.equal(a.message, b.message)
  assert.equal(a.message, RESET_SENT_MESSAGE)
  // Nothing about the failure may reach the message the resident reads.
  assert.ok(!/not found/i.test(b.message))
  assert.ok(!/user/i.test(b.message))
})

test('a thrown network error still gives the same answer', async () => {
  const dead = {
    auth: {
      async resetPasswordForEmail() {
        throw new Error('Failed to fetch')
      },
    },
  }
  const r = await requestPasswordReset({ client: dead, email: 'x@example.test', origin: ORIGIN })
  assert.equal(r.ok, true)
  assert.equal(r.message, RESET_SENT_MESSAGE)
  assert.ok(!/fetch/i.test(r.message))
})

test('rate limiting is not leaked either', async () => {
  const limited = fakeClient(() => ({ error: { message: 'Email rate limit exceeded', status: 429 } }))
  const r = await requestPasswordReset({ client: limited, email: 'x@example.test', origin: ORIGIN })
  assert.equal(r.message, RESET_SENT_MESSAGE)
  assert.ok(!/rate|429|limit/i.test(r.message))
})

test('the underlying error is kept for the caller, just never shown', async () => {
  const unknown = fakeClient(() => ({ error: { message: 'User not found' } }))
  const r = await requestPasswordReset({ client: unknown, email: 'nobody@example.test', origin: ORIGIN })
  assert.ok(r.silentError, 'available to a logger')
  assert.equal(r.silentError.message, 'User not found')
})

test('an empty address is a form error, not a sent-link claim', async () => {
  const c = fakeClient()
  for (const email of ['', '   ', null, undefined]) {
    const r = await requestPasswordReset({ client: c, email, origin: ORIGIN })
    assert.equal(r.ok, false, JSON.stringify(email))
    assert.notEqual(r.message, RESET_SENT_MESSAGE)
  }
  assert.equal(c.calls.length, 0, 'nothing is sent for a blank address')
})

test('the address is trimmed and the redirect passed through', async () => {
  const c = fakeClient()
  await requestPasswordReset({ client: c, email: '  juan@example.test  ', origin: ORIGIN })
  assert.equal(c.calls[0].email, 'juan@example.test')
  assert.equal(c.calls[0].options.redirectTo, `${ORIGIN}/reset-password`)
})

// ---------------------------------------------------- new password rules

test('the new password honours the barangay minimum, not Supabase floor of 6', () => {
  assert.equal(MIN_PASSWORD, 10)
  const short = 'a'.repeat(MIN_PASSWORD - 1)
  const ok = 'a'.repeat(MIN_PASSWORD)
  assert.match(newPasswordProblem(short, short), /at least 10/)
  assert.equal(newPasswordProblem(ok, ok), null, 'exactly the minimum is allowed')
  assert.equal(newPasswordProblem('a'.repeat(40), 'a'.repeat(40)), null)
})

test('a mismatch is caught, and reported as a mismatch', () => {
  assert.match(newPasswordProblem('correct-horse', 'correct-hors'), /do not match/)
})

test('empty inputs are named individually', () => {
  assert.match(newPasswordProblem('', ''), /Enter a new password/)
  assert.match(newPasswordProblem('long-enough-password', ''), /confirm/)
})

test('the length rule is checked before the match rule', () => {
  // Otherwise "abc"/"abd" would complain about matching rather than length.
  assert.match(newPasswordProblem('abc', 'abd'), /at least 10/)
})

// ------------------------------------------------ applying the new password

test('a valid password is sent to updateUser, then the session is ended', async () => {
  const c = fakeAccount()
  const r = await applyNewPassword({ client: c, next: GOOD, confirm: GOOD })

  assert.equal(r.ok, true)
  assert.equal(r.problem, null)
  assert.equal(r.error, null)
  assert.equal(r.signOutError, null)
  assert.deepEqual(c.calls.update, [{ password: GOOD }])
  assert.equal(c.calls.signOut, 1, 'the recovery session must not carry on')
})

test('an unacceptable password never reaches the account at all', async () => {
  for (const [next, confirm, expected] of [
    ['', '', /Enter a new password/],
    ['short', 'short', /at least 10/],
    [GOOD, '', /confirm/],
    [GOOD, `${GOOD}x`, /do not match/],
  ]) {
    const c = fakeAccount()
    const r = await applyNewPassword({ client: c, next, confirm })

    assert.equal(r.ok, false, `${next}/${confirm}`)
    assert.match(r.problem, expected)
    assert.equal(r.error, null)
    assert.equal(c.calls.update.length, 0, 'no password change was attempted')
    assert.equal(c.calls.signOut, 0, 'and no session was ended')
  }
})

test('a refused password change is a failure, and the session is left alone', async () => {
  const c = fakeAccount({ update: () => ({ error: { message: 'New password should be different' } }) })
  const r = await applyNewPassword({ client: c, next: GOOD, confirm: GOOD })

  assert.equal(r.ok, false)
  assert.equal(r.problem, null, 'a Supabase error, for the page to phrase')
  assert.equal(r.error.message, 'New password should be different')
  assert.equal(c.calls.signOut, 0, 'nothing changed, so nothing to sign out of')
})

test('a thrown password change is a failure too', async () => {
  const c = fakeAccount({
    update: () => {
      throw new Error('Failed to fetch')
    },
  })
  const r = await applyNewPassword({ client: c, next: GOOD, confirm: GOOD })

  assert.equal(r.ok, false)
  assert.equal(r.error.message, 'Failed to fetch')
  assert.equal(c.calls.signOut, 0)
})

test('a sign-out that returns an error does NOT undo the success', async () => {
  // The password has already changed by this point. Reporting failure here
  // would tell the resident to try again with a password that already works.
  const c = fakeAccount({ signOut: () => ({ error: { message: 'Session not found' } }) })
  const r = await applyNewPassword({ client: c, next: GOOD, confirm: GOOD })

  assert.equal(r.ok, true, 'the password changed, so the answer is success')
  assert.equal(r.problem, null)
  assert.equal(r.error, null, 'nothing for the page to show as an error')
  assert.equal(r.signOutError.message, 'Session not found', 'recorded, not raised')
  assert.deepEqual(c.calls.update, [{ password: GOOD }])
})

test('a sign-out that throws does NOT undo the success either', async () => {
  const c = fakeAccount({
    signOut: () => {
      throw new Error('Network request failed')
    },
  })
  const r = await applyNewPassword({ client: c, next: GOOD, confirm: GOOD })

  assert.equal(r.ok, true)
  assert.equal(r.error, null)
  assert.equal(r.signOutError.message, 'Network request failed')
})

test('a client whose signOut returns nothing is still a success', async () => {
  // Older clients and hand-rolled mocks resolve undefined rather than { error }.
  const c = {
    auth: {
      async updateUser() {
        return { error: null }
      },
      async signOut() {},
    },
  }
  const r = await applyNewPassword({ client: c, next: GOOD, confirm: GOOD })
  assert.equal(r.ok, true)
  assert.equal(r.signOutError, null)
})

// ------------------------------------------------- recovery link states

test('nothing is said while the session is still being resolved', () => {
  for (const isRecovery of [true, false]) {
    for (const graceElapsed of [true, false]) {
      for (const hasSession of [true, false]) {
        assert.equal(
          recoveryState({ loading: true, hasSession, isRecovery, graceElapsed }),
          'waiting'
        )
      }
    }
  }
})

test('a recovery session means the link was good', () => {
  assert.equal(
    recoveryState({ loading: false, hasSession: true, isRecovery: true, graceElapsed: false }),
    'ready'
  )
  assert.equal(
    recoveryState({ loading: false, hasSession: true, isRecovery: true, graceElapsed: true }),
    'ready'
  )
})

test('an ordinary signed-in session can NEVER reach the form', () => {
  // The point of the gate: someone already signed in -- their own open tab, or
  // an unattended screen at the barangay hall -- must not be able to set a new
  // password here without knowing the current one.
  assert.equal(
    recoveryState({ loading: false, hasSession: true, isRecovery: false, graceElapsed: true }),
    'expired'
  )
  // Nor during the grace period: 'waiting' shows a spinner, never the form.
  assert.notEqual(
    recoveryState({ loading: false, hasSession: true, isRecovery: false, graceElapsed: false }),
    'ready'
  )
})

test('a reload, which loses the in-memory flag, fails safely', () => {
  // After a refresh the session is still in storage but the PASSWORD_RECOVERY
  // event is long gone, so the resident is sent to ask for a new link rather
  // than handed the form.
  assert.equal(
    recoveryState({ loading: false, hasSession: true, isRecovery: false, graceElapsed: true }),
    'expired'
  )
})

test('no session is only called expired once the grace period has passed', () => {
  // The moment of arrival must not accuse a good link of being stale -- the
  // recovery event lands a tick after the session does.
  assert.equal(
    recoveryState({ loading: false, hasSession: false, isRecovery: false, graceElapsed: false }),
    'waiting'
  )
  assert.equal(
    recoveryState({ loading: false, hasSession: false, isRecovery: false, graceElapsed: true }),
    'expired'
  )
})

test('a recovery flag with no session is not enough on its own', () => {
  assert.equal(
    recoveryState({ loading: false, hasSession: false, isRecovery: true, graceElapsed: true }),
    'expired'
  )
})

test('the form is shown only for a resolved recovery session', () => {
  // Exhaustive: 'ready' appears for exactly one combination.
  const ready = []
  for (const loading of [true, false]) {
    for (const hasSession of [true, false]) {
      for (const isRecovery of [true, false]) {
        for (const graceElapsed of [true, false]) {
          const s = recoveryState({ loading, hasSession, isRecovery, graceElapsed })
          if (s === 'ready') ready.push({ loading, hasSession, isRecovery, graceElapsed })
        }
      }
    }
  }
  assert.equal(ready.length, 2, 'both grace values, nothing else')
  for (const r of ready) {
    assert.equal(r.loading, false)
    assert.equal(r.hasSession, true)
    assert.equal(r.isRecovery, true)
  }
})

test('the expired message tells the resident what to do next', () => {
  assert.match(EXPIRED_MESSAGE, /expired|used/i)
  assert.match(EXPIRED_MESSAGE, /new one/i)
})

test('no message mentions tokens, links being invalid, or accounts existing', () => {
  for (const msg of [RESET_SENT_MESSAGE, EXPIRED_MESSAGE]) {
    assert.ok(!/token/i.test(msg), msg)
    assert.ok(!/no account|not registered|does not exist/i.test(msg), msg)
  }
})
