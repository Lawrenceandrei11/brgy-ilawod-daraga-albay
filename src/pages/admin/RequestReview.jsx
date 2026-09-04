import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase, friendlyError } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Badge, Button, Card, CardHeader, Field, Notice } from '../../components/ui'
import { EmptyState, LoadingRows } from '../../components/ui/States'
import { Icon } from '../../components/Icon'
import { REQUEST_STATUS, STATUS_TRANSITIONS } from '../../lib/status'
import { smsStatusLabel } from '../../lib/sms'
import { longDate, peso, shortDate, timeOnly } from '../../lib/formatters'
import { SERVICE_FIELDS } from '../../lib/serviceFields'

/**
 * Where a request actually moves through its lifecycle.
 *
 * Which moves are offered comes from STATUS_TRANSITIONS, the same map the
 * design system uses, so the UI cannot offer a transition the workflow does
 * not have. The history entry is written by a database trigger, not here —
 * so the audit trail records what happened even if this screen has a bug.
 */
export default function RequestReview() {
  const { ref } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { profile, role } = useAuth()

  const [remarks, setRemarks] = useState('')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  const { data: request, isLoading } = useQuery({
    queryKey: ['admin-request', ref],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('document_requests')
        .select('*, services(*), profiles!document_requests_profile_id_fkey(*)')
        .eq('ref_no', ref)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  const { data: history } = useQuery({
    queryKey: ['admin-request-history', request?.id],
    enabled: !!request?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('request_status_history')
        .select('*, profiles:changed_by(full_name, role)')
        .eq('request_id', request.id)
        .order('created_at')
      if (error) throw error
      return data
    },
  })

  // Written by the notify_request_status trigger, never by this screen, so it
  // records what actually happened rather than what this page believes.
  const { data: texts } = useQuery({
    queryKey: ['admin-request-sms', request?.id],
    enabled: !!request?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sms_messages')
        .select('id, status, created_at, sent_at, skip_reason, last_error')
        .eq('request_id', request.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  async function moveTo(next) {
    // Returning a request without saying why leaves the resident guessing,
    // so the remark is required for that transition only.
    if (next === 'rejected' && !remarks.trim()) {
      setError('Say what needs correcting — the resident is shown this.')
      return
    }

    setBusy(next)
    setError(null)
    try {
      const patch = { status: next }
      if (remarks.trim()) patch.remarks = remarks.trim()
      if (next === 'released') patch.released_at = new Date().toISOString()

      const { error: updateError } = await supabase
        .from('document_requests')
        .update(patch)
        .eq('id', request.id)
      if (updateError) throw updateError

      setRemarks('')
      queryClient.invalidateQueries({ queryKey: ['admin-request', ref] })
      queryClient.invalidateQueries({ queryKey: ['admin-request-history'] })
      queryClient.invalidateQueries({ queryKey: ['admin-requests'] })
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
      queryClient.invalidateQueries({ queryKey: ['admin-request-sms'] })
    } catch (err) {
      setError(friendlyError(err, 'That change could not be saved.'))
    } finally {
      setBusy(null)
    }
  }

  async function togglePaid() {
    setBusy('fee')
    setError(null)
    try {
      const { error: updateError } = await supabase
        .from('document_requests')
        .update({ fee_paid: !request.fee_paid })
        .eq('id', request.id)
      if (updateError) throw updateError
      queryClient.invalidateQueries({ queryKey: ['admin-request', ref] })
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(null)
    }
  }

  async function assignToMe() {
    setBusy('assign')
    try {
      await supabase.from('document_requests').update({ assigned_to: profile.id }).eq('id', request.id)
      queryClient.invalidateQueries({ queryKey: ['admin-request', ref] })
    } finally {
      setBusy(null)
    }
  }

  if (isLoading) {
    return <div className="dash-body"><Card flush><LoadingRows rows={6} /></Card></div>
  }

  if (!request) {
    return (
      <div className="dash-body">
        <Card flush>
          <EmptyState
            icon="search"
            title="Request not found"
            action={<Button to="/admin/requests" size="m" auto variant="secondary">Back to the queue</Button>}
          >
            No request with reference <b>{ref}</b>.
          </EmptyState>
        </Card>
      </div>
    )
  }

  const r = request
  const p = r.profiles
  const spec = SERVICE_FIELDS[r.service_code]
  const details = r.details ?? {}
  const answered = (spec?.fields ?? [])
    .filter((f) => details[f.name] != null && String(details[f.name]).trim() !== '')
    .map((f) => [f.label, String(details[f.name])])

  const nextStates = STATUS_TRANSITIONS[r.status] ?? []
  const canCollectFee = role === 'treasurer' || role === 'captain' || role === 'secretary'

  const lastText = texts?.[0]
  // Why a text will not arrive is more useful than the silence itself, and
  // both answers are already on the applicant record.
  const cannotText = !p?.mobile
    ? 'No mobile number on file'
    : p?.sms_opt_in === false
      ? 'Resident has texts turned off'
      : null

  return (
    <div className="dash-body">
      <div>
        <Link to="/admin/requests" style={{ fontSize: 13.5, color: 'var(--ink-500)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <Icon name="chev" size="sm" style={{ transform: 'rotate(180deg)' }} /> Back to the queue
        </Link>
      </div>

      {error && (
        <Notice tone="danger" icon="alert" title="Could not save">
          {error}
        </Notice>
      )}

      <div className="welcome" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <Badge status={r.status} style={{ marginBottom: 14 }} />
          <h1 style={{ fontSize: 25 }}>{r.services?.name}</h1>
          <p style={{ marginTop: 6 }}>
            {p?.full_name} · {p?.resident_id ?? 'no ID'} {p?.purok ? `· Purok ${p.purok}` : ''}
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--scan-300)' }}>
            Reference
          </div>
          <div style={{ fontFamily: 'var(--display)', fontSize: 22, fontWeight: 800, color: '#fff' }}>
            {r.ref_no}
          </div>
        </div>
      </div>

      <div className="grid-2 split" style={{ gap: 24, alignItems: 'start' }}>
        <div className="stack" style={{ gap: 24 }}>
          <Card padded>
            <h3 style={{ fontSize: 18, marginBottom: 6 }}>Move this request on</h3>
            <p style={{ fontSize: 14.5, color: 'var(--ink-500)', marginBottom: 20 }}>
              Every change is recorded against your name and shown to the resident.
            </p>

            <div style={{ marginBottom: 18 }}>
              <Field
                as="textarea"
                label="Remarks"
                hint="required when returning"
                placeholder="What the resident needs to know — required if you are sending this back for correction."
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                help="Shown to the resident on their request page"
              />
            </div>

            {nextStates.length ? (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {nextStates.map((s) => (
                  <Button
                    key={s}
                    auto
                    variant={s === 'rejected' ? 'danger' : s === 'released' ? 'accent' : 'primary'}
                    disabled={!!busy}
                    onClick={() => moveTo(s)}
                    icon={s === 'rejected' ? 'x' : s === 'released' ? 'check' : 'arrow'}
                  >
                    {busy === s ? 'Saving…' : `Mark ${REQUEST_STATUS[s].label.toLowerCase()}`}
                  </Button>
                ))}
              </div>
            ) : (
              <Notice tone="quiet" icon="check" title="This request is finished">
                Released requests cannot be moved again. The history below is the permanent record.
              </Notice>
            )}
          </Card>

          <Card flush>
            <CardHeader title="History" />
            <div style={{ padding: '20px 26px' }}>
              {history?.length ? (
                <ol className="timeline">
                  {history.map((h, i) => (
                    <li key={h.id} className={i === history.length - 1 ? 'now' : 'done'}>
                      <span className="dot">
                        <Icon name={i === history.length - 1 ? 'clock' : 'check'} size="sm" />
                      </span>
                      <div>
                        <b>{REQUEST_STATUS[h.to_status]?.label ?? h.to_status}</b>
                        <span>
                          {shortDate(h.created_at)} · {timeOnly(h.created_at)}
                          {h.profiles?.full_name
                            ? ` · ${h.profiles.full_name}`
                            : ' · the resident'}
                        </span>
                        {h.note && <p className="note">{h.note}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <LoadingRows rows={2} height={40} />
              )}
            </div>
          </Card>

          {answered.length > 0 && (
            <Card flush>
              <CardHeader title="What the resident submitted" />
              <div style={{ padding: '8px 26px 20px' }}>
                <dl style={{ margin: 0 }}>
                  {answered.map(([label, value]) => (
                    <div key={label} className="row" style={{ gap: 16, padding: '13px 0', borderBottom: '1px solid var(--ink-100)', alignItems: 'flex-start' }}>
                      <dt style={{ fontSize: 13, color: 'var(--ink-400)', width: 220, flex: 'none', fontWeight: 600 }}>
                        {label}
                      </dt>
                      <dd style={{ margin: 0, fontSize: 14.5, color: 'var(--ink-800)' }}>{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </Card>
          )}
        </div>

        <aside className="stack" style={{ gap: 24 }}>
          <Card padded style={{ padding: 24 }}>
            <h3 style={{ fontSize: 17, marginBottom: 16 }}>Fee</h3>
            <div className="row" style={{ gap: 12, marginBottom: 16 }}>
              <span style={{ fontSize: 14, color: 'var(--ink-500)' }}>Amount</span>
              <b style={{ marginLeft: 'auto', fontSize: 19, fontFamily: 'var(--display)', color: 'var(--primary-900)' }}>
                {peso(r.fee)}
              </b>
            </div>
            {r.fee > 0 ? (
              <>
                <Badge tone={r.fee_paid ? 'approved' : 'pending'} style={{ marginBottom: 14 }}>
                  {r.fee_paid ? 'Paid' : 'Not yet paid'}
                </Badge>
                {canCollectFee && (
                  <Button
                    size="s"
                    block
                    variant={r.fee_paid ? 'secondary' : 'primary'}
                    disabled={busy === 'fee'}
                    onClick={togglePaid}
                  >
                    {busy === 'fee' ? 'Saving…' : r.fee_paid ? 'Mark as unpaid' : 'Record payment'}
                  </Button>
                )}
              </>
            ) : (
              <p style={{ fontSize: 14, color: 'var(--ink-500)' }}>No fee for this document.</p>
            )}
          </Card>

          <Card padded style={{ padding: 24 }}>
            <h3 style={{ fontSize: 17, marginBottom: 16 }}>Applicant</h3>
            <div className="stack" style={{ gap: 12 }}>
              {[
                ['Name', p?.full_name],
                ['Resident ID', p?.resident_id ?? '—'],
                ['Purok', p?.purok ? `Purok ${p.purok}` : '—'],
                ['Address', p?.address_line],
                ['Mobile', p?.mobile],
                ['Years resident', p?.years_of_residency],
                ['Valid ID', p?.valid_id_type],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 12, color: 'var(--ink-400)', fontWeight: 600 }}>{k}</div>
                  <div style={{ fontSize: 14, color: 'var(--ink-800)' }}>{v || '—'}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16 }}>
              <Button to={`/admin/residents/${p?.id}`} size="s" variant="secondary" block>
                Open resident record
              </Button>
            </div>
          </Card>

          <Card padded style={{ padding: 24 }}>
            <h3 style={{ fontSize: 17, marginBottom: 14 }}>Handling</h3>
            <div className="stack" style={{ gap: 12, marginBottom: 14 }}>
              <div className="row" style={{ gap: 12 }}>
                <span style={{ fontSize: 14, color: 'var(--ink-500)' }}>Filed</span>
                <b style={{ marginLeft: 'auto', fontSize: 14 }}>{longDate(r.filed_at)}</b>
              </div>
              {r.released_at && (
                <div className="row" style={{ gap: 12 }}>
                  <span style={{ fontSize: 14, color: 'var(--ink-500)' }}>Released</span>
                  <b style={{ marginLeft: 'auto', fontSize: 14 }}>{longDate(r.released_at)}</b>
                </div>
              )}
              <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 14, color: 'var(--ink-500)', flex: 'none' }}>Texts</span>
                <b style={{ marginLeft: 'auto', fontSize: 14, textAlign: 'right' }}>
                  {cannotText ??
                    (lastText
                      ? `${smsStatusLabel(lastText.status)} · ${shortDate(lastText.created_at)}`
                      : 'None yet')}
                </b>
              </div>

              {r.services?.requires_council_review && (
                <Notice tone="quiet" icon="users" title="Council review required">
                  This document needs the barangay council's finding before it can be approved.
                </Notice>
              )}
            </div>
            {!r.assigned_to && (
              <Button size="s" variant="secondary" block disabled={busy === 'assign'} onClick={assignToMe}>
                {busy === 'assign' ? 'Assigning…' : 'Assign to me'}
              </Button>
            )}
          </Card>
        </aside>
      </div>
    </div>
  )
}
