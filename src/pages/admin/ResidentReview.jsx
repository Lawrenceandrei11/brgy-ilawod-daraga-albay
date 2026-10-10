import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase, friendlyError } from '../../lib/supabase'
import { Badge, Button, Card, CardHeader, Field, Notice, PngSlot } from '../../components/ui'
import { EmptyState, LoadingRows } from '../../components/ui/States'
import { Icon } from '../../components/Icon'
import { longDate, peso, shortDate } from '../../lib/formatters'
import { cleanupSupersededIds, idReviewSupported, needsIdReview } from '../../lib/idRetention'

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
  const [idIsPdf, setIdIsPdf] = useState(false)
  const [idExpanded, setIdExpanded] = useState(false)
  const idCloseRef = useRef(null)
  const idOpenRef = useRef(null)
  const [idReviewBusy, setIdReviewBusy] = useState(false)
  const [idReviewError, setIdReviewError] = useState(null)

  /**
   * Accept the document the resident replaced.
   *
   * The database goes first and storage second, deliberately. The review is
   * the fact that matters; a failed cleanup leaves an unreferenced file,
   * which is untidy and fixable, whereas deleting first would risk removing
   * a document while the review failed to record. Which file to keep comes
   * back from the RPC rather than from the row we read earlier, so a path
   * changed in between cannot cause the live document to be deleted.
   */
  async function markIdReviewed() {
    setIdReviewBusy(true)
    setIdReviewError(null)
    try {
      const { data: keepPath, error } = await supabase.rpc('mark_valid_id_reviewed', {
        p_profile_id: id,
      })
      if (error) throw error

      // A resident who changed only their ID number has no file at all, so
      // the RPC returns null. There is nothing to supersede, and asking the
      // cleanup to run would correctly refuse and look like a failure.
      const tidied = keepPath
        ? await cleanupSupersededIds({ client: supabase, userId: id, keepPath })
        : { ok: true, removed: [] }
      if (!tidied.ok) {
        // Not a failure of the review, which has already been recorded.
        setIdReviewError(
          'Marked as checked. The resident’s older ID files could not be removed; they can be tidied later.',
        )
      }
      await queryClient.invalidateQueries({ queryKey: ['admin-resident', id] })
      await queryClient.invalidateQueries({ queryKey: ['admin-residents'] })
    } catch (err) {
      setIdReviewError(friendlyError(err, 'This ID could not be marked as checked.'))
    } finally {
      setIdReviewBusy(false)
    }
  }

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
    // Registration names the file after the upload's own extension, so the
    // path says which of the four accepted types this is.
    setIdIsPdf(/\.pdf$/i.test(p.valid_id_path))
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

  // The expanded ID viewer. It shows the same signed URL the panel already
  // holds -- no second request, no longer-lived link -- so it expires with
  // everything else after five minutes.
  //
  // Escape closes it, the page behind it does not scroll, focus moves to the
  // close button on open and returns to the trigger on close, and Tab cannot
  // wander out of the dialog into the page underneath.
  useEffect(() => {
    if (!idExpanded) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setIdExpanded(false)
      if (e.key === 'Tab') {
        e.preventDefault()
        idCloseRef.current?.focus()
      }
    }
    const scrollY = window.scrollY
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    idCloseRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      window.scrollTo(0, scrollY)
      idOpenRef.current?.focus()
    }
  }, [idExpanded])

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

            {/* A replacement the resident uploaded themselves. Their account
                is untouched -- they are still approved and still hold their
                Resident ID -- it is this document that has not been seen.
                Hidden entirely until the migration adds the columns, so this
                screen is safe to ship ahead of the database change. */}
            {idReviewSupported(p) && needsIdReview(p) && (
              <div style={{ marginBottom: 14 }}>
                <Notice icon="alert" title="This ID has not been checked yet">
                  The resident replaced it on {shortDate(p.valid_id_replaced_at)}. Compare it with
                  the details below, then mark it checked.
                </Notice>
                {idReviewError && (
                  <p style={{ fontSize: 13, color: 'var(--danger-600)', marginTop: 8 }}>
                    {idReviewError}
                  </p>
                )}
                <Button
                  size="s"
                  auto
                  icon="check"
                  disabled={idReviewBusy}
                  onClick={markIdReviewed}
                  style={{ marginTop: 10 }}
                >
                  {idReviewBusy ? 'Saving…' : 'Mark this ID as checked'}
                </Button>
              </div>
            )}

            {idUrl ? (
              <>
                {/* Registration accepts a PDF as well as an image, and a PDF in
                    an <img> is a broken icon -- which would mean approving a
                    registration having never seen the document. */}
                {idIsPdf ? (
                  <object
                    data={idUrl}
                    type="application/pdf"
                    className="idview"
                    aria-label="The resident's uploaded valid ID"
                  >
                    <p style={{ fontSize: 13.5, color: 'var(--ink-500)', padding: 16 }}>
                      This browser will not display the PDF in this panel. Use
                      &ldquo;View larger&rdquo; below to open it in the full-size viewer.
                    </p>
                  </object>
                ) : (
                  <img src={idUrl} alt="The resident's uploaded valid ID" className="idview" />
                )}

                {/* An ID number is often too small to read in the panel, so it
                    opens larger -- in the page, not a new tab. A new tab would
                    put the signed URL in the address bar and the browser's
                    history, where it can be read, copied or left on screen. */}
                <button
                  type="button"
                  ref={idOpenRef}
                  className="idview-open"
                  onClick={() => setIdExpanded(true)}
                  aria-haspopup="dialog"
                >
                  <Icon name="search" size="sm" />
                  View larger{idIsPdf ? ' (PDF)' : ''}
                </button>

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

      {/* The ID, larger, without the signed URL ever reaching the address bar.
          Same link the panel is already using, same five-minute expiry. */}
      {idExpanded && idUrl && (
        <div
          className="idmodal"
          role="dialog"
          aria-modal="true"
          aria-label={`Valid ID of ${p.full_name}`}
          onClick={(e) => {
            // Only the backdrop closes; a click on the document itself must not.
            if (e.target === e.currentTarget) setIdExpanded(false)
          }}
        >
          <div className="idmodal-box">
            <div className="idmodal-bar">
              <b>
                {p.full_name} · {p.valid_id_type || 'Valid ID'}
                {p.valid_id_number ? ` · ${p.valid_id_number}` : ''}
              </b>
              <button
                type="button"
                ref={idCloseRef}
                className="idmodal-close"
                onClick={() => setIdExpanded(false)}
                aria-label="Close the ID viewer"
              >
                <Icon name="x" />
              </button>
            </div>

            {idIsPdf ? (
              <object
                data={idUrl}
                type="application/pdf"
                className="idmodal-doc"
                aria-label={`Valid ID of ${p.full_name}, PDF`}
              >
                <p style={{ fontSize: 14, color: 'var(--ink-500)', padding: 24 }}>
                  This browser cannot display PDFs. The ID type and number are shown
                  above. To see the document itself, open this page in a browser that
                  displays PDFs, or ask the resident to bring the ID to the barangay hall.
                </p>
              </object>
            ) : (
              <img src={idUrl} alt={`Valid ID of ${p.full_name}`} className="idmodal-doc" />
            )}

            <p className="idmodal-foot">
              Held in a private bucket. This view uses the same signed link as the
              panel and expires five minutes after it was issued. Press
              <kbd>Esc</kbd> to close.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
