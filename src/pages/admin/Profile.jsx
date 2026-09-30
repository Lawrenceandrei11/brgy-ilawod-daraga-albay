import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { supabase, friendlyError } from '../../lib/supabase'
import { MIN_PASSWORD } from '../../lib/password'
import { Button, Card, CardHeader, Field, Notice } from '../../components/ui'
import { ProfilePictureCard } from '../../components/ProfilePictureCard'
import { MainLogoCard } from '../../components/MainLogoCard'
import { useAuth } from '../../hooks/useAuth'

const ROLE_LABEL = {
  captain: 'Punong Barangay',
  secretary: 'Barangay Secretary',
  treasurer: 'Barangay Treasurer',
}

const BLANK_PASSWORD = { current: '', next: '', confirm: '' }
const BLANK_EMAIL = { next: '', password: '' }

// The same shape the Add Admin form accepts.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * The Admin portal's own profile page: who you are signed in as, your name,
 * your password and your profile picture. The same page for the captain,
 * secretary and treasurer.
 *
 * Two columns: your account on the left, your picture on the right, both
 * ending on the same edge. The position is a title you write for yourself
 * (migration 25), not the role: a barangay has Kagawads and an SK
 * Chairperson, and typing any of those grants nothing, because what an
 * account may do still comes from the role. Whose name and title may change
 * is settled in the database (migration 19): your own, never another admin's.
 * The password is settled by Supabase Auth the same way -- the call below can
 * only ever change the account that made it.
 */

/**
 * Older accounts only have full_name, so offer a sensible split to correct:
 * first word, last word, and whatever sits between them.
 */
function splitName(profile) {
  if (profile?.first_name || profile?.last_name) {
    return {
      first_name: profile.first_name ?? '',
      middle_name: profile.middle_name ?? '',
      last_name: profile.last_name ?? '',
    }
  }
  const parts = (profile?.full_name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first_name: '', middle_name: '', last_name: '' }
  if (parts.length === 1) return { first_name: parts[0], middle_name: '', last_name: '' }
  return {
    first_name: parts[0],
    middle_name: parts.slice(1, -1).join(' '),
    last_name: parts[parts.length - 1],
  }
}

/**
 * What the Edit form starts from: the name parts, plus the position. An
 * official who has never written a title sees the one their role implies, so
 * the field is edited from what the portal is already showing them.
 */
function formFor(profile, role) {
  return {
    ...splitName(profile),
    position_title: profile?.position_title ?? ROLE_LABEL[role] ?? '',
  }
}

export default function AdminProfile() {
  const { user, profile, role, refetchProfile } = useAuth()
  const queryClient = useQueryClient()

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(() => formFor(profile, role))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)

  const [changingPassword, setChangingPassword] = useState(false)
  const [pw, setPw] = useState(BLANK_PASSWORD)
  const [pwBusy, setPwBusy] = useState(false)
  const [pwError, setPwError] = useState(null)
  const [pwSaved, setPwSaved] = useState(false)

  const [changingEmail, setChangingEmail] = useState(false)
  const [emailForm, setEmailForm] = useState(BLANK_EMAIL)
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailError, setEmailError] = useState(null)
  const [emailSaved, setEmailSaved] = useState(null)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const setPwField = (k) => (e) => setPw((p) => ({ ...p, [k]: e.target.value }))
  const setEmailField = (k) => (e) => setEmailForm((f) => ({ ...f, [k]: e.target.value }))

  // Set by Supabase Auth while a change is waiting on the confirmation link.
  const awaitingEmail = user?.new_email ?? null

  function startEditing() {
    setForm(formFor(profile, role))
    setError(null)
    setSaved(false)
    setEditing(true)
  }

  async function save(e) {
    e.preventDefault()
    if (!form.first_name.trim()) return setError('Enter your first name.')
    if (!form.last_name.trim()) return setError('Enter your last name.')

    setBusy(true)
    setError(null)
    try {
      // full_name is not sent: the database composes it from these three, so
      // it can never drift from the parts. An empty position is sent as null,
      // which the portal reads as "no title of my own" and falls back to the
      // label of the role.
      const { error: saveError } = await supabase
        .from('profiles')
        .update({
          first_name: form.first_name.trim(),
          middle_name: form.middle_name.trim() || null,
          last_name: form.last_name.trim(),
          position_title: form.position_title.trim() || null,
        })
        .eq('id', profile.id)
      if (saveError) throw saveError

      await refetchProfile()
      // The Admin Management list reads names straight from the table.
      queryClient.invalidateQueries({ queryKey: ['admin-accounts'] })
      setEditing(false)
      setSaved(true)
    } catch (err) {
      setError(friendlyError(err, 'Your details could not be saved.'))
    } finally {
      setBusy(false)
    }
  }

  function startChangingPassword() {
    setPw(BLANK_PASSWORD)
    setPwError(null)
    setPwSaved(false)
    setChangingPassword(true)
  }

  function cancelPasswordChange() {
    // Nothing typed is kept once the form closes.
    setPw(BLANK_PASSWORD)
    setPwError(null)
    setChangingPassword(false)
  }

  async function changePassword(e) {
    e.preventDefault()

    // The address Supabase Auth knows, which is the one the check below has
    // to use.
    const email = user?.email ?? profile?.email
    if (!email) return setPwError('Your sign-in email is missing. Sign out, sign in again, and retry.')
    if (!pw.current) return setPwError('Enter your current password.')
    if (pw.next.length < MIN_PASSWORD) {
      return setPwError(`Your new password must be at least ${MIN_PASSWORD} characters.`)
    }
    if (pw.next !== pw.confirm) return setPwError('The new password and the confirmation do not match.')
    if (pw.next === pw.current) {
      return setPwError('Your new password must be different from your current one.')
    }

    setPwBusy(true)
    setPwError(null)
    setPwSaved(false)
    try {
      // Step 1: prove the current password. Supabase Auth checks it against
      // its own hash; this system never sees, keeps or logs either password.
      // A wrong one stops here, before anything is changed, and leaves the
      // session exactly as it was.
      const { error: wrongPassword } = await supabase.auth.signInWithPassword({
        email,
        password: pw.current,
      })
      if (wrongPassword) {
        setPwError(
          /invalid login credentials/i.test(wrongPassword.message)
            ? 'Your current password is not correct.'
            : friendlyError(wrongPassword, 'Your current password could not be checked.')
        )
        return
      }

      // Step 2: change it. updateUser acts on the account whose session made
      // the call and on no other, so another admin's password cannot be
      // reached from here -- not by editing this page, not by editing the
      // request. That is Supabase Auth's rule, not this screen's.
      const { error: updateError } = await supabase.auth.updateUser({ password: pw.next })
      if (updateError) throw updateError

      setPw(BLANK_PASSWORD)
      setChangingPassword(false)
      setPwSaved(true)
    } catch (err) {
      setPwError(friendlyError(err, 'Your password could not be changed.'))
    } finally {
      setPwBusy(false)
    }
  }

  function startChangingEmail() {
    setEmailForm(BLANK_EMAIL)
    setEmailError(null)
    setEmailSaved(null)
    setChangingEmail(true)
  }

  function cancelEmailChange() {
    setEmailForm(BLANK_EMAIL)
    setEmailError(null)
    setChangingEmail(false)
  }

  /**
   * Supabase Auth owns the email address, so this asks Auth to change it and
   * lets Auth decide when it takes effect. Nothing here writes the address
   * into profiles: the database follows auth.users on its own (migration 21),
   * which is what keeps the copy honest when the confirmation link is opened
   * an hour later in a mail app.
   */
  async function changeEmail(e) {
    e.preventDefault()

    const currentEmail = user?.email ?? profile?.email
    const next = emailForm.next.trim().toLowerCase()

    if (!currentEmail) return setEmailError('Your sign-in email is missing. Sign out, sign in again, and retry.')
    if (!EMAIL.test(next)) return setEmailError('That does not look like an email address.')
    if (next === currentEmail.toLowerCase()) return setEmailError('That is already your email address.')
    if (!emailForm.password) return setEmailError('Enter your current password.')

    setEmailBusy(true)
    setEmailError(null)
    setEmailSaved(null)
    try {
      // Auth enforces uniqueness itself, but it may answer a taken address
      // with a silent success to avoid telling strangers who has an account.
      // Staff can already see these addresses, so checking here turns that
      // silence into a plain answer.
      const { data: taken, error: lookupError } = await supabase
        .from('profiles')
        .select('id')
        .ilike('email', next)
        .neq('id', profile.id)
        .maybeSingle()
      if (lookupError) throw lookupError
      if (taken) return setEmailError('That email address is already used by another account.')

      // The same proof of identity the password change asks for: Auth checks
      // it against its own hash, and a wrong one stops here.
      const { error: wrongPassword } = await supabase.auth.signInWithPassword({
        email: currentEmail,
        password: emailForm.password,
      })
      if (wrongPassword) {
        return setEmailError(
          /invalid login credentials/i.test(wrongPassword.message)
            ? 'Your current password is not correct.'
            : friendlyError(wrongPassword, 'Your current password could not be checked.')
        )
      }

      // updateUser changes the account that made the call and no other, so
      // another official's address cannot be reached from here.
      const { data, error: changeError } = await supabase.auth.updateUser(
        { email: next },
        { emailRedirectTo: `${window.location.origin}/admin/profile` },
      )
      if (changeError) throw changeError

      setEmailForm(BLANK_EMAIL)
      setChangingEmail(false)

      if (data?.user?.new_email) {
        // Confirmation is on: the address moves only once the link is opened.
        setEmailSaved(
          `Check ${data.user.new_email} for the confirmation link. Keep signing in with ${currentEmail} until you have opened it.`
        )
      } else {
        // Confirmation is off for this project, so Auth applied it at once.
        await refetchProfile()
        queryClient.invalidateQueries({ queryKey: ['admin-accounts'] })
        setEmailSaved(`You now sign in with ${data?.user?.email ?? next}.`)
      }
    } catch (err) {
      const message = err?.message ?? ''
      setEmailError(
        /already (been )?registered|already in use|already exists/i.test(message)
          ? 'That email address is already used by another account.'
          : friendlyError(err, 'Your email address could not be changed.')
      )
    } finally {
      setEmailBusy(false)
    }
  }

  // One padding for every card body, so the two columns line up and the text
  // inside sits under the title in the header bar above it.
  const cardBody = { padding: '18px 26px 20px' }
  const formActions = {
    borderTop: '1px solid var(--ink-100)',
    marginTop: 18,
    paddingTop: 16,
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
  }
  const label = { fontSize: 12, color: 'var(--ink-400)', fontWeight: 600 }

  return (
    <div className="dash-body">
      <div>
        <span className="eyebrow">My profile</span>
        <h1 style={{ fontSize: 27, margin: '6px 0 0' }}>Your account</h1>
      </div>

      {saved && (
        <Notice icon="check" title="Profile saved">
          Your name and position have been updated everywhere they appear.
        </Notice>
      )}
      {error && (
        <Notice tone="danger" icon="alert" title="Could not save">
          {error}
        </Notice>
      )}

      {/* Your account on the left, your picture on the right; both columns
          end on the same edge. */}
      <div className="grid-2 split" style={{ gap: 20, alignItems: 'start' }}>
        <div className="stack" style={{ gap: 20 }}>
          {/* Laid out like the resident profile's Identity card. */}
          <Card flush>
            <CardHeader title="Signed in as">
              {!editing && (
                <Button size="s" auto variant="secondary" onClick={startEditing}>
                  Edit name
                </Button>
              )}
            </CardHeader>

            {editing ? (
              <form onSubmit={save} style={cardBody}>
                <div className="grid-2" style={{ gap: 16 }}>
                  <Field label="First name" required value={form.first_name} onChange={set('first_name')} />
                  <Field
                    label="Middle name"
                    hint="optional"
                    value={form.middle_name}
                    onChange={set('middle_name')}
                  />
                  <Field label="Last name" required value={form.last_name} onChange={set('last_name')} />
                  <Field
                    label="Position"
                    hint="optional"
                    help="Your title, in your own words -- Punong Barangay, Kagawad, SK Chairperson."
                    maxLength={60}
                    value={form.position_title}
                    onChange={set('position_title')}
                  />
                </div>

                <div style={formActions}>
                  <Button type="submit" size="s" auto icon="check" disabled={busy}>
                    {busy ? 'Saving…' : 'Save'}
                  </Button>
                  <Button
                    type="button"
                    size="s"
                    auto
                    variant="ghost"
                    onClick={() => setEditing(false)}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <div style={cardBody}>
                {/* Name on its own line, then the two the barangay sets. */}
                <div style={label}>Name</div>
                <div style={{ fontSize: 15.5, color: 'var(--ink-900)', overflowWrap: 'anywhere' }}>
                  {profile?.full_name || '—'}
                </div>

                <div className="grid-2" style={{ gap: 16, marginTop: 16 }}>
                  <div>
                    <div style={label}>Position</div>
                    <div style={{ fontSize: 14, color: 'var(--ink-800)', overflowWrap: 'anywhere' }}>
                      {profile?.position_title || ROLE_LABEL[role] || role || '—'}
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={label}>Email</div>
                    <div style={{ fontSize: 14, color: 'var(--ink-800)', overflowWrap: 'anywhere' }}>
                      {profile?.email || '—'}
                    </div>
                  </div>
                </div>

                <p style={{ fontSize: 12.5, color: 'var(--ink-400)', margin: '14px 0 0' }}>
                  Your position is a title only. What you can do in the Admin portal is set by
                  the barangay.
                </p>
              </div>
            )}
          </Card>

          {/* The address you sign in with. Supabase Auth owns it; this asks
              Auth to change it, and only for your own account. */}
          <Card flush>
            <CardHeader title="Sign-in email">
              {!changingEmail && (
                <Button size="s" auto variant="secondary" onClick={startChangingEmail}>
                  Change email
                </Button>
              )}
            </CardHeader>

            <div style={cardBody}>
              {awaitingEmail && (
                <Notice icon="clock" title="Waiting for confirmation">
                  A confirmation link was sent to {awaitingEmail}. Your sign-in email changes once
                  it is opened.
                </Notice>
              )}
              {emailSaved && (
                <Notice icon="check" title="Email change requested">
                  {emailSaved}
                </Notice>
              )}
              {emailError && (
                <Notice tone="danger" icon="alert" title="Could not change your email">
                  {emailError}
                </Notice>
              )}

              {changingEmail ? (
                <form onSubmit={changeEmail}>
                  <div className="grid-2" style={{ gap: 16 }}>
                    <Field
                      label="New email address"
                      required
                      type="email"
                      autoComplete="off"
                      help="You will sign in with this."
                      value={emailForm.next}
                      onChange={setEmailField('next')}
                    />
                    <Field
                      label="Current password"
                      required
                      type="password"
                      autoComplete="current-password"
                      help="To prove the account is yours."
                      value={emailForm.password}
                      onChange={setEmailField('password')}
                    />
                  </div>

                  <div style={formActions}>
                    <Button type="submit" size="s" auto icon="check" disabled={emailBusy}>
                      {emailBusy ? 'Changing…' : 'Change email'}
                    </Button>
                    <Button
                      type="button"
                      size="s"
                      auto
                      variant="ghost"
                      onClick={cancelEmailChange}
                      disabled={emailBusy}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <p style={{ fontSize: 12.5, color: 'var(--ink-400)', margin: 0 }}>
                  You change your own sign-in email here, and only your own. It is the address you
                  sign in with, so the barangay should still be able to reach you on it.
                </p>
              )}
            </div>
          </Card>

          {/* Your own password, whichever of the three positions you hold. */}
          <Card flush>
            <CardHeader title="Password">
              {!changingPassword && (
                <Button size="s" auto variant="secondary" onClick={startChangingPassword}>
                  Change password
                </Button>
              )}
            </CardHeader>

            <div style={cardBody}>
              {pwSaved && (
                <Notice icon="check" title="Password changed">
                  Use your new password the next time you sign in.
                </Notice>
              )}
              {pwError && (
                <Notice tone="danger" icon="alert" title="Could not change your password">
                  {pwError}
                </Notice>
              )}

              {changingPassword ? (
                <form onSubmit={changePassword}>
                  <div className="stack" style={{ gap: 16 }}>
                    <Field
                      label="Current password"
                      required
                      type="password"
                      autoComplete="current-password"
                      value={pw.current}
                      onChange={setPwField('current')}
                    />
                    <div className="grid-2" style={{ gap: 16 }}>
                      <Field
                        label="New password"
                        required
                        type="password"
                        autoComplete="new-password"
                        help={`At least ${MIN_PASSWORD} characters.`}
                        value={pw.next}
                        onChange={setPwField('next')}
                      />
                      <Field
                        label="Confirm new password"
                        required
                        type="password"
                        autoComplete="new-password"
                        value={pw.confirm}
                        onChange={setPwField('confirm')}
                      />
                    </div>
                  </div>

                  <div style={formActions}>
                    <Button type="submit" size="s" auto icon="check" disabled={pwBusy}>
                      {pwBusy ? 'Changing…' : 'Change password'}
                    </Button>
                    <Button
                      type="button"
                      size="s"
                      auto
                      variant="ghost"
                      onClick={cancelPasswordChange}
                      disabled={pwBusy}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <p style={{ fontSize: 12.5, color: 'var(--ink-400)', margin: 0 }}>
                  You change your own password here, and only your own. Nobody else can read it or
                  set it for you.
                </p>
              )}
            </div>
          </Card>
        </div>

        <ProfilePictureCard placeholder="official-placeholder.png" />

        {/* Renders for the captain only; the database enforces the same. */}
        <MainLogoCard />
      </div>
    </div>
  )
}
