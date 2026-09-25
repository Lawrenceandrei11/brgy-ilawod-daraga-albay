import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase, friendlyError } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Badge, Button, Card, CardHeader, Field, Notice } from '../../components/ui'
import { EmptyState, ErrorState, LoadingRows } from '../../components/ui/States'
import { shortDate } from '../../lib/formatters'
import { MIN_PASSWORD } from '../../lib/password'

/**
 * Admin Management: who can use the Admin portal, and adding another one.
 *
 * There is no separate "admin" role in this system. The portal runs on three
 * existing roles, so a new account is an ordinary Supabase Auth login plus a
 * profiles row carrying one of them.
 *
 * The creating is done by the admin-create-user Edge Function, because it
 * needs the service role key. This page cannot grant anything by itself: the
 * function checks the caller's own profile before it creates anything.
 */

const ROLES = [
  { value: 'captain', label: 'Captain', note: 'Punong Barangay. Also sees settings and the sensitive reports.' },
  { value: 'secretary', label: 'Secretary', note: 'Verifies registrations and handles document requests.' },
  { value: 'treasurer', label: 'Treasurer', note: 'Records payments on requests.' },
]

const ROLE_LABEL = Object.fromEntries(ROLES.map((r) => [r.value, r.label]))
const BLANK = { full_name: '', email: '', role: 'secretary', password: '', confirm: '' }

export default function Admins() {
  const { profile, isCaptain } = useAuth()
  const queryClient = useQueryClient()

  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(BLANK)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [created, setCreated] = useState(null)

  const [removing, setRemoving] = useState(null)
  const [removeError, setRemoveError] = useState(null)
  const [removed, setRemoved] = useState(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, status, created_at')
        .in('role', ['captain', 'secretary', 'treasurer'])
        .order('created_at')
      if (error) throw error
      return data
    },
  })

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  function startAdding() {
    setForm(BLANK)
    setError(null)
    setCreated(null)
    setAdding(true)
  }

  async function submit(e) {
    e.preventDefault()
    setError(null)

    // The same rules the function enforces; checking here only saves a round
    // trip and gives a quicker answer.
    if (form.full_name.trim().length < 4) return setError('Enter the full name of the account holder.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) {
      return setError('That does not look like an email address.')
    }
    if (form.password.length < MIN_PASSWORD) {
      return setError(`The password must be at least ${MIN_PASSWORD} characters.`)
    }
    if (form.password !== form.confirm) return setError('The two passwords do not match.')

    setBusy(true)
    try {
      // invoke() sends the signed-in session's token, which is what the
      // function checks before it creates anything.
      const { data, error } = await supabase.functions.invoke('admin-create-user', {
        body: {
          full_name: form.full_name.trim(),
          email: form.email.trim(),
          role: form.role,
          password: form.password,
        },
      })

      // A non-2xx reply carries our own message in the body; surface that
      // rather than "Edge Function returned a non-2xx status code".
      if (error) {
        let message = null
        try {
          message = (await error.context?.json())?.error ?? null
        } catch {
          message = null
        }
        throw new Error(message ?? error.message)
      }

      setForm(BLANK)
      setAdding(false)
      setCreated(`${data.full_name} can now sign in as ${ROLE_LABEL[data.role]}.`)
      queryClient.invalidateQueries({ queryKey: ['admin-accounts'] })
    } catch (err) {
      setError(friendlyError(err, 'The account could not be created.'))
    } finally {
      setBusy(false)
    }
  }

  /**
   * delete_admin() in the database does the deciding: the captain only, portal
   * accounts only, never your own, and never one that has filed anything as a
   * resident. It hands back the picture path, because the file lives in
   * storage and is not removed by the row delete.
   */
  async function remove(a) {
    const warning =
      `Remove ${a.full_name} from the Admin portal?\n\n` +
      'This permanently deletes their account and their sign-in. It cannot be undone.\n\n' +
      'The barangay record is kept: the announcements they wrote, the residents they approved ' +
      'and the requests they handled stay as they are, still showing their name.'
    if (!window.confirm(warning)) return

    setRemoving(a.id)
    setRemoveError(null)
    setRemoved(null)
    try {
      const { data, error } = await supabase.rpc('delete_admin', { p_profile_id: a.id })
      if (error) throw error

      // Best effort: the account is already gone, and a leftover file costs
      // storage, not correctness.
      if (data?.avatar_path) await supabase.storage.from('avatars').remove([data.avatar_path])

      queryClient.invalidateQueries({ queryKey: ['admin-accounts'] })
      setRemoved(`${data?.full_name ?? a.full_name} can no longer sign in to the Admin portal.`)
    } catch (err) {
      setRemoveError(friendlyError(err, 'That account could not be removed.'))
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="dash-body">
      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <div className="grow">
          <span className="eyebrow">Admin management</span>
          <h1 style={{ fontSize: 27, margin: '8px 0 0' }}>Who can use the Admin portal</h1>
        </div>
        {!adding && (
          <Button size="m" auto icon="user" onClick={startAdding}>
            Add admin
          </Button>
        )}
      </div>

      {created && (
        <Notice icon="check" title="Account created">
          {created} Give them the password in person — it is not emailed, and it is not stored anywhere in this system.
        </Notice>
      )}
      {error && (
        <Notice tone="danger" icon="alert" title="Could not create the account">
          {error}
        </Notice>
      )}
      {removed && (
        <Notice icon="check" title="Account removed">
          {removed}
        </Notice>
      )}
      {removeError && (
        <Notice tone="danger" icon="alert" title="Could not remove the account">
          {removeError}
        </Notice>
      )}

      {adding ? (
        <Card padded style={{ maxWidth: 640 }}>
          <h2 style={{ fontSize: 20, marginBottom: 6 }}>Add an Admin portal account</h2>
          <p style={{ fontSize: 14, color: 'var(--ink-500)', marginBottom: 20 }}>
            The account can sign in straight away with the password you set here. There is no
            separate admin role: the portal runs on the three barangay positions below.
          </p>

          <form onSubmit={submit}>
            <div className="stack" style={{ gap: 18 }}>
              <Field
                label="Full name"
                required
                placeholder="Juan Dela Cruz"
                value={form.full_name}
                onChange={set('full_name')}
              />
              <Field
                label="Email address"
                required
                type="email"
                autoComplete="off"
                placeholder="secretary@barangayilawod.gov.ph"
                help="They sign in with this."
                value={form.email}
                onChange={set('email')}
              />
              <Field as="select" label="Position" required value={form.role} onChange={set('role')}>
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Field>
              <p style={{ fontSize: 13, color: 'var(--ink-500)', marginTop: -8 }}>
                {ROLES.find((r) => r.value === form.role)?.note}
              </p>

              <div className="grid-2" style={{ gap: 18 }}>
                <Field
                  label="Temporary password"
                  required
                  type="password"
                  autoComplete="new-password"
                  help={`At least ${MIN_PASSWORD} characters.`}
                  value={form.password}
                  onChange={set('password')}
                />
                <Field
                  label="Repeat the password"
                  required
                  type="password"
                  autoComplete="new-password"
                  value={form.confirm}
                  onChange={set('confirm')}
                />
              </div>
            </div>

            <div
              style={{
                borderTop: '1px solid var(--ink-100)',
                marginTop: 22,
                paddingTop: 20,
                display: 'flex',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <Button type="submit" auto icon="check" disabled={busy}>
                {busy ? 'Creating…' : 'Create the account'}
              </Button>
              <Button type="button" auto variant="ghost" onClick={() => setAdding(false)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <Card flush>
          <CardHeader title={`${data?.length ?? 0} with portal access`} />

          {isLoading ? (
            <LoadingRows rows={3} />
          ) : isError ? (
            <ErrorState onRetry={refetch} />
          ) : data?.length ? (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Position</th>
                  <th>Email</th>
                  <th>Added</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.map((a) => (
                  <tr key={a.id}>
                    <td className="doc" data-label="Name">
                      {a.full_name}
                      {a.id === profile?.id && (
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-400)' }}>You</span>
                      )}
                    </td>
                    <td data-label="Position">{ROLE_LABEL[a.role] ?? a.role}</td>
                    <td className="when" data-label="Email">{a.email ?? '—'}</td>
                    <td className="when" data-label="Added">{shortDate(a.created_at)}</td>
                    <td data-label="Status">
                      <Badge tone={a.status === 'approved' ? 'approved' : 'pending'}>
                        {a.status === 'approved' ? 'Active' : a.status}
                      </Badge>
                    </td>
                    <td data-label="Action">
                      {/* Never your own account, and only the captain sees a
                          button at all. The database refuses both anyway. */}
                      {isCaptain && a.id !== profile?.id && (
                        <Button
                          size="s"
                          auto
                          variant="ghost"
                          style={{ color: 'var(--danger-600)' }}
                          disabled={removing === a.id}
                          onClick={() => remove(a)}
                        >
                          {removing === a.id ? 'Removing…' : 'Remove'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState icon="users" title="No portal accounts yet" />
          )}
        </Card>
      )}

      <Notice icon="info" title="About these accounts">
        Only the Punong Barangay can open this page, add an account or remove one; the secretary and
        treasurer keep every other admin screen. Removing an account deletes the sign-in for good,
        but nothing the official did is lost — the barangay record keeps their name. An Admin portal account is an ordinary sign-in plus one of
        the three barangay positions. Passwords are handed to Supabase Auth and never stored by this
        system, so a forgotten one is reset in the Supabase dashboard rather than read back here.
      </Notice>
    </div>
  )
}
