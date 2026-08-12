import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase, friendlyError } from '../../lib/supabase'
import { Badge, Button, Card, CardHeader, Field, Notice, PngSlot } from '../../components/ui'
import { EmptyState, LoadingRows } from '../../components/ui/States'
import { Icon } from '../../components/Icon'
import { longDate, peso, shortDate } from '../../lib/formatters'

const STATUS_TONE = { approved: 'approved', pending: 'pending', rejected: 'rejected', suspended: 'released' }

/**
 * Verifying a registration, and confirming a biometric enrollment in person.
 *
 * Both go through SECURITY DEFINER functions rather than a direct update:
 * approving has to allocate a Resident ID from a sequence no client role can
 * touch, and confirming a face has to write to a table staff cannot read.
 */
export default function ResidentReview() {
  const { id } = useParams()
  const queryClient = useQueryClient()

  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const [idUrl, setIdUrl] = useState(null)

  const { data: p, isLoading } = useQuery({
    queryKey: ['admin-resident', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle()
      if (error) throw error
      return data
    },
  })

  const { data: enrollment } = useQuery({
    queryKey: ['admin-enrollment', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('face_enrollment_status', { p_profile_id: id })
      if (error) throw error
      return data?.[0] ?? null
    },
  })

  const { data: requests } = useQuery({
    queryKey: ['admin-resident-requests', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('document_requests')
        .select('*, services(name)')
        .eq('profile_id', id)
        .order('filed_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  // The ID photograph lives in a private bucket, so it needs a signed URL.
  // Staff can read it under the storage policy; nobody else can, and the
  // link expires.
  useEffect(() => {
    let cancelled = false
    if (!p?.valid_id_path) return undefined
    supabase.storage
      .from('valid-ids')
      .createSignedUrl(p.valid_id_path, 300)
      .then(({ data }) => {
        if (!cancelled) setIdUrl(data?.signedUrl ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [p?.valid_id_path])

  async function approve() {
    setBusy('approve')
    setError(null)
    try {
      const { data, error: rpcError } = await supabase.rpc('approve_resident', { p_profile_id: id })
      if (rpcError) throw rpcError
      setDone(`Approved. Resident ID ${data} issued.`)
      queryClient.invalidateQueries({ queryKey: ['admin-resident', id] })
      queryClient.invalidateQueries({ queryKey: ['admin-residents'] })
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
    } catch (err) {
      setError(friendlyError(err, 'Could not approve this registration.'))
    } finally {
      setBusy(null)
    }
  }

  async function reject() {
    if (!reason.trim()) {
      setError('Give a reason — the resident is shown this so they can put it right.')
      return
    }
    setBusy('reject')
    setError(null)
    try {
      const { error: rpcError } = await supabase.rpc('reject_resident', {
        p_profile_id: id,
        p_reason: reason.trim(),
      })
      if (rpcError) throw rpcError
      setDone('Registration marked as not approved.')
      setReason('')
      queryClient.invalidateQueries({ queryKey: ['admin-resident', id] })
      queryClient.invalidateQueries({ queryKey: ['admin-residents'] })
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
    } catch (err) {
      setError(friendlyError(err, 'Could not save that.'))
    } finally {
      setBusy(null)
    }
  }

  async function confirmFace() {
    setBusy('face')
    setError(null)
    try {
      const { data, error: rpcError } = await supabase.rpc('confirm_face_enrollment', { p_profile_id: id })
      if (rpcError) throw rpcError
      setDone(`Biometric enrollment confirmed (${data} angles).`)
      queryClient.invalidateQueries({ queryKey: ['admin-enrollment', id] })
    } catch (err) {
      setError(friendlyError(err, 'Could not confirm the enrollment.'))
    } finally {
      setBusy(null)
    }
  }

  if (isLoading) return <div className="dash-body"><Card flush><LoadingRows rows={6} /></Card></div>

  if (!p) {
    return (
      <div className="dash-body">
        <Card flush>
          <EmptyState
            icon="search"
            title="Resident not found"
            action={<Button to="/admin/residents" size="m" auto variant="secondary">Back to the masterlist</Button>}
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="dash-body">
      <div>
        <Link to="/admin/residents" style={{ fontSize: 13.5, color: 'var(--ink-500)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <Icon name="chev" size="sm" style={{ transform: 'rotate(180deg)' }} /> Back to the masterlist
        </Link>
      </div>

      {done && <Notice icon="check" title="Saved">{done}</Notice>}
      {error && <Notice tone="danger" icon="alert" title="Could not save">{error}</Notice>}

      <div className="welcome" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <Badge tone={STATUS_TONE[p.status]} style={{ marginBottom: 14 }}>
            {p.status === 'pending' ? 'Awaiting verification' : p.status}
          </Badge>
          <h1 style={{ fontSize: 25 }}>{p.full_name}</h1>
          <p style={{ marginTop: 6 }}>
            {p.resident_id ?? 'No Resident ID yet'}
            {p.purok ? ` · Purok ${p.purok}` : ''} · registered {shortDate(p.created_at)}
          </p>
        </div>
      </div>

      <div className="grid-2 split" style={{ gap: 24, alignItems: 'start' }}>
        <div className="stack" style={{ gap: 24 }}>
          {p.status === 'pending' && (
            <Card padded>
              <h3 style={{ fontSize: 18, marginBottom: 6 }}>Verify this registration</h3>
              <p style={{ fontSize: 14.5, color: 'var(--ink-500)', marginBottom: 20 }}>
                Check the details below against the household record and the ID photograph.
                Approving issues a Resident ID and lets them file requests.
              </p>

              <div style={{ marginBottom: 18 }}>
                <Field
                  as="textarea"
                  label="Reason, if not approving"
                  hint="required to reject"
                  placeholder="e.g. The address given is outside Barangay Ilawod."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  help="Shown to the resident so they can correct it"
                />
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Button auto icon="check" disabled={!!busy} onClick={approve}>
                  {busy === 'approve' ? 'Approving…' : 'Approve and issue a Resident ID'}
                </Button>
                <Button auto variant="danger" icon="x" disabled={!!busy} onClick={reject}>
                  {busy === 'reject' ? 'Saving…' : 'Not approved'}
                </Button>
              </div>
            </Card>
          )}

          {p.status === 'rejected' && p.rejection_reason && (
            <Notice tone="danger" icon="alert" title="Marked as not approved">
              {p.rejection_reason}
              <div style={{ marginTop: 14 }}>
                <Button auto size="s" disabled={!!busy} onClick={approve}>
                  {busy === 'approve' ? 'Approving…' : 'Approve after all'}
                </Button>
              </div>
            </Notice>
          )}

          <Card flush>
            <CardHeader title="Registration details" />
            <div style={{ padding: '20px 26px' }}>
              <div className="grid-2" style={{ gap: '16px 24px' }}>
                {[
                  ['Full legal name', p.full_name],
                  ['Date of birth', p.date_of_birth ? longDate(p.date_of_birth) : '—'],
                  ['Sex', p.sex],
                  ['Civil status', p.civil_status],
                  ['Mobile', p.mobile],
                  ['Email', p.email],
                  ['Purok', p.purok ? `Purok ${p.purok}` : '—'],
                  ['Address', p.address_line],
                  ['Years of residency', p.years_of_residency],
                  ['Head of household', p.household_head || 'Self'],
                  ['People in household', p.household_size],
                  ['Valid ID', p.valid_id_type],
                  ['ID number', p.valid_id_number],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div style={{ fontSize: 12, color: 'var(--ink-400)', fontWeight: 600 }}>{k}</div>
                    <div style={{ fontSize: 14.5, color: 'var(--ink-800)' }}>{v || '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card flush>
            <CardHeader title={`Requests · ${requests?.length ?? 0}`} />
            {requests?.length ? (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Document</th>
                    <th>Filed</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id} className="clickable">
                      <td className="ref" data-label="Reference">
                        <Link to={`/admin/requests/${r.ref_no}`}>{r.ref_no}</Link>
                      </td>
                      <td className="doc" data-label="Document">{r.services?.name}</td>
                      <td className="when" data-label="Filed">{shortDate(r.filed_at)}</td>
                      <td data-label="Status"><Badge status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState icon="doc" title="No requests filed" />
            )}
          </Card>
        </div>

        <aside className="stack" style={{ gap: 24 }}>
          <Card padded style={{ padding: 24 }}>
            <h3 style={{ fontSize: 17, marginBottom: 14 }}>ID photograph</h3>
            {idUrl ? (
              <>
                <img
                  src={idUrl}
                  alt="The resident's uploaded valid ID"
                  style={{ width: '100%', borderRadius: 'var(--r-md)', border: '1px solid var(--ink-200)', marginBottom: 12 }}
                />
                <p style={{ fontSize: 12.5, color: 'var(--ink-400)' }}>
                  Held in a private bucket. This link is signed and expires in five minutes.
                </p>
              </>
            ) : (
              <>
                <PngSlot name="valid-id-placeholder.png" style={{ width: '100%', height: 130, marginBottom: 12 }} />
                <p style={{ fontSize: 13.5, color: 'var(--ink-500)' }}>
                  No ID photograph on file. Ask the resident to bring their ID to the hall.
                </p>
              </>
            )}
          </Card>

          <Card padded style={{ padding: 24 }}>
            <div className="row" style={{ gap: 12, marginBottom: 14 }}>
              <Icon name="fp" size="lg" style={{ color: 'var(--primary-600)' }} />
              <h3 style={{ fontSize: 16.5, flex: 1 }}>Biometrics</h3>
            </div>

            {enrollment?.angles > 0 ? (
              <>
                <Badge tone={enrollment.confirmed ? 'verified' : 'pending'} style={{ marginBottom: 14 }}>
                  {enrollment.confirmed ? 'Confirmed in person' : 'Awaiting confirmation'}
                </Badge>
                <p style={{ fontSize: 13.5, color: 'var(--ink-500)', marginBottom: 16 }}>
                  Enrolled {shortDate(enrollment.enrolled_at)} · {enrollment.angles} angles.
                  {enrollment.confirmed
                    ? ` Confirmed ${shortDate(enrollment.confirmed_at)}.`
                    : ' Check the resident in person before confirming.'}
                </p>
                {!enrollment.confirmed && (
                  <Button size="s" block icon="check" disabled={!!busy} onClick={confirmFace}>
                    {busy === 'face' ? 'Confirming…' : 'Confirm this enrollment'}
                  </Button>
                )}
                <p style={{ fontSize: 12.5, color: 'var(--ink-400)', marginTop: 14, lineHeight: 1.6 }}>
                  You cannot view the facial template. It is readable only by the matching service,
                  never by staff.
                </p>
              </>
            ) : (
              <p style={{ fontSize: 13.5, color: 'var(--ink-500)' }}>
                This resident has not enrolled a face. They can sign in with a password.
              </p>
            )}
          </Card>

          <Card padded style={{ padding: 24 }}>
            <h3 style={{ fontSize: 17, marginBottom: 12 }}>Account</h3>
            <div className="stack" style={{ gap: 10 }}>
              <div className="row" style={{ gap: 12 }}>
                <span style={{ fontSize: 14, color: 'var(--ink-500)' }}>Role</span>
                <b style={{ marginLeft: 'auto', fontSize: 14 }}>{p.role}</b>
              </div>
              <div className="row" style={{ gap: 12 }}>
                <span style={{ fontSize: 14, color: 'var(--ink-500)' }}>Fees paid</span>
                <b style={{ marginLeft: 'auto', fontSize: 14 }}>
                  {peso((requests ?? []).filter((r) => r.fee_paid).reduce((s, r) => s + Number(r.fee), 0))}
                </b>
              </div>
              {p.approved_at && (
                <div className="row" style={{ gap: 12 }}>
                  <span style={{ fontSize: 14, color: 'var(--ink-500)' }}>Verified</span>
                  <b style={{ marginLeft: 'auto', fontSize: 14 }}>{shortDate(p.approved_at)}</b>
                </div>
              )}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  )
}
