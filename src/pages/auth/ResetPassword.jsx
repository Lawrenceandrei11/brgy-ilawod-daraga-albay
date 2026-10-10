import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { supabase, friendlyError } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button, Card, Field, Notice } from '../../components/ui'
import { MainLogo } from '../../components/MainLogo'
import { MIN_PASSWORD } from '../../lib/password'
import {
  EXPIRED_MESSAGE,
  applyNewPassword,
  newPasswordProblem,
  recoveryState,
} from '../../lib/passwordReset'

/**
 * Setting a new password after following a recovery link.
 *
 * This route is deliberately NOT wrapped in RedirectIfSignedIn. The link in
 * the email carries a token that the Supabase client turns into a real session
 * before this component ever renders -- detectSessionInUrl is on -- so by the
 * time the resident arrives they are, as far as the app is concerned, signed
 * in. Guarding this route the way /login is guarded would bounce them to the
 * dashboard and they could never reach the form.
 *
 * Being signed in is therefore necessary but not sufficient. The form also
 * requires `recoveryMode`, which AuthProvider sets only on a PASSWORD_RECOVERY
 * event, so an ordinary session -- someone's own open tab, or an unattended
 * screen at the barangay hall -- cannot be used to set a new password without
 * knowing the current one. A reload drops the flag and asks for a fresh link.
 *
 * That gate is session hygiene, not a security boundary. The boundary is
 * Supabase Auth: updateUser only ever changes the password of the account
 * behind the calling session.
 *
 * There is no custom token handling here, and there should never be. The
 * session is the proof the link was genuine.
 */
export default function ResetPassword() {
  const navigate = useNavigate()
  const { sessionLoading, signedIn, recoveryMode } = useAuth()

  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [problem, setProblem] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  // A visitor who simply types this URL looks exactly like a stale link for
  // the first instant, and the recovery event itself arrives from a setTimeout
  // a moment after the session does. Wait a beat before saying anything
  // discouraging.
  const [graceElapsed, setGraceElapsed] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setGraceElapsed(true), 2500)
    return () => clearTimeout(t)
  }, [])

  const state = recoveryState({
    loading: sessionLoading,
    hasSession: signedIn,
    isRecovery: recoveryMode,
    graceElapsed,
  })

  async function onSubmit(e) {
    e.preventDefault()

    // Checked here as well as inside applyNewPassword, so a typo answers at
    // once instead of flashing 'Saving your new password…' at someone who has
    // not saved anything. Same function both times -- the rule has one home.
    const found = newPasswordProblem(next, confirm)
    if (found) {
      setProblem(found)
      return
    }

    setBusy(true)
    setProblem(null)
    const result = await applyNewPassword({ client: supabase, next, confirm })
    setBusy(false)

    if (!result.ok) {
      setProblem(
        result.problem ??
          friendlyError(result.error, 'Your password could not be changed. Try the link again.')
      )
      return
    }

    // The password changed. A failed sign-out is not the resident's problem and
    // must not be shown as one -- applyNewPassword keeps it out of the way.
    setDone(true)
  }

  // If the sign-out after the change did fail, the recovery session is still
  // live and /login would bounce straight to the dashboard. Trying once more
  // here costs nothing when it already succeeded.
  async function goToSignIn() {
    try {
      await supabase.auth.signOut()
    } catch {
      // Nothing useful to do: the password is already changed either way.
    }
    navigate('/login', { replace: true })
  }

  return (
    <>
      <nav className="site-nav">
        <Link to="/" className="lockup">
          <MainLogo className="seal" pill quiet />
          <div>
            <b>BARANGAY E-ASSIST</b>
            <span>Set a new password</span>
          </div>
        </Link>
      </nav>

      <div className="wrap" style={{ paddingTop: 48, paddingBottom: 64 }}>
        <Card padded style={{ maxWidth: 480, margin: '0 auto' }}>
          {done ? (
            <>
              <h1 style={{ fontSize: 26, marginBottom: 10 }}>Your password has been changed</h1>
              <Notice icon="check" title="All set">
                Sign in with your new password. Keep it somewhere safe — the barangay cannot read
                it back to you.
              </Notice>
              <Button block icon="lock" style={{ marginTop: 20 }} onClick={goToSignIn}>
                Go to sign in
              </Button>
            </>
          ) : state === 'waiting' ? (
            <div aria-busy="true" style={{ textAlign: 'center', padding: '28px 0' }}>
              <p style={{ fontSize: 15, color: 'var(--ink-500)' }}>Checking your reset link…</p>
            </div>
          ) : state === 'expired' ? (
            <>
              <h1 style={{ fontSize: 26, marginBottom: 10 }}>This link cannot be used</h1>
              <Notice tone="danger" icon="alert" title="Expired or already used">
                {EXPIRED_MESSAGE}
              </Notice>
              <div className="stack" style={{ gap: 12, marginTop: 20 }}>
                <Button to="/forgot-password" block icon="lock">
                  Ask for a new link
                </Button>
                <Button to="/login" variant="ghost" block>
                  Back to sign in
                </Button>
              </div>
            </>
          ) : (
            <>
              <h1 style={{ fontSize: 26, marginBottom: 8 }}>Set a new password</h1>
              <p style={{ fontSize: 15, color: 'var(--ink-500)', marginBottom: 24 }}>
                Choose a password of at least {MIN_PASSWORD} characters. You will use it the next
                time you sign in.
              </p>

              {problem && (
                <div style={{ marginBottom: 18 }}>
                  <Notice tone="danger" icon="alert" title="Check the password">
                    {problem}
                  </Notice>
                </div>
              )}

              <form onSubmit={onSubmit} className="stack" style={{ gap: 20 }} noValidate>
                <Field
                  label="New password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••••"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                />
                <Field
                  label="Confirm new password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••••"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />

                <Button type="submit" block icon="check" disabled={busy}>
                  {busy ? 'Saving your new password…' : 'Save my new password'}
                </Button>
              </form>
            </>
          )}
        </Card>
      </div>
    </>
  )
}
