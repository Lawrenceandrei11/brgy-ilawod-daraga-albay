import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '../../lib/supabase'
import { Badge, Button, Card, CardHeader, Notice } from '../../components/ui'
import { EmptyState, LoadingRows } from '../../components/ui/States'
import { Icon } from '../../components/Icon'
import { REQUEST_STATUS } from '../../lib/status'
import { longDate, peso, shortDate, timeOnly, turnaround } from '../../lib/formatters'
import { SERVICE_FIELDS } from '../../lib/serviceFields'

/**
 * A single request, with the audit trail rendered as a timeline.
 *
 * The timeline is read from request_status_history, which is written by a
 * database trigger rather than by the app — so what a resident sees here is
 * the same record an auditor would see, not a story the UI made up.
 */
export default function RequestDetail() {
  const { ref } = useParams()
  const [params] = useSearchParams()
  const justFiled = params.get('filed') === '1'

  const { data: request, isLoading } = useQuery({
    queryKey: ['request', ref],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('document_requests')
        .select('*, services(name, icon, requirements, processing_days, requires_council_review)')
        .eq('ref_no', ref)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  const { data: history } = useQuery({
    queryKey: ['request-history', request?.id],
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

  if (isLoading) {
    return (
      <div className="dash-body">
        <Card flush>
          <LoadingRows rows={5} />
        </Card>
      </div>
    )
  }

  if (!request) {
    return (
      <div className="dash-body">
        <Card flush>
          <EmptyState
            icon="search"
            title="Request not found"
            action={
              <Button to="/app/requests" size="m" auto variant="secondary">
                Back to my requests
              </Button>
            }
          >
            No request with reference <b>{ref}</b> belongs to your account.
          </EmptyState>
        </Card>
      </div>
    )
  }

  const spec = SERVICE_FIELDS[request.service_code]
  const details = request.details ?? {}

  // Show the questions in the order the form asked them, using their labels.
  const answered = (spec?.fields ?? [])
    .filter((f) => details[f.name] != null && String(details[f.name]).trim() !== '')
    .map((f) => [f.label, String(details[f.name])])

  return (
    <div className="dash-body">
      <div>
        <Link
          to="/app/requests"
          style={{ fontSize: 13.5, color: 'var(--ink-500)', display: 'inline-flex', gap: 6, alignItems: 'center' }}
        >
          <Icon name="chev" size="sm" style={{ transform: 'rotate(180deg)' }} /> Back to my requests
        </Link>
      </div>

      {justFiled && (
        <Notice icon="check" title="Your request has been filed">
          Keep the reference number below. You can follow this request from here, or from the
          public tracking page using the reference and your surname.
        </Notice>
      )}

      <div className="welcome" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <Badge status={request.status} style={{ marginBottom: 14 }} />
          <h1 style={{ fontSize: 25 }}>{request.services?.name}</h1>
          <p style={{ marginTop: 6 }}>{REQUEST_STATUS[request.status]?.resident}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--scan-300)' }}>
            Reference
          </div>
          <div style={{ fontFamily: 'var(--display)', fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: '.02em' }}>
            {request.ref_no}
          </div>
        </div>
      </div>

      <div className="grid-2 split" style={{ gap: 24, alignItems: 'start' }}>
        <div className="stack" style={{ gap: 24 }}>
          {request.status === 'rejected' && request.remarks && (
            <Notice tone="danger" icon="alert" title="This request needs correcting">
              {request.remarks}
            </Notice>
          )}

          <Card flush>
            <CardHeader title="Progress" />
            <div style={{ padding: '20px 26px' }}>
              {history?.length ? (
                <ol className="timeline">
                  {history.map((h, i) => {
                    const isLast = i === history.length - 1
                    return (
                      <li key={h.id} className={isLast ? 'now' : 'done'}>
                        <span className="dot">
                          <Icon name={isLast ? 'clock' : 'check'} size="sm" />
                        </span>
                        <div>
                          <b>{REQUEST_STATUS[h.to_status]?.label ?? h.to_status}</b>
                          <span>
                            {shortDate(h.created_at)} · {timeOnly(h.created_at)}
                            {h.profiles?.full_name && ` · ${h.profiles.full_name}`}
                          </span>
                          {h.note && <p className="note">{h.note}</p>}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              ) : (
                <LoadingRows rows={2} height={40} />
              )}
            </div>
          </Card>

          {answered.length > 0 && (
            <Card flush>
              <CardHeader title="What you told us" />
              <div style={{ padding: '8px 26px 20px' }}>
                <dl style={{ margin: 0 }}>
                  {answered.map(([label, value]) => (
                    <div
                      key={label}
                      className="row"
                      style={{ gap: 16, padding: '13px 0', borderBottom: '1px solid var(--ink-100)', alignItems: 'flex-start' }}
                    >
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
            <h3 style={{ fontSize: 17, marginBottom: 16 }}>Details</h3>
            <div className="stack" style={{ gap: 14 }}>
              {[
                ['Filed', longDate(request.filed_at)],
                ['Fee', peso(request.fee)],
                ['Payment', request.fee > 0 ? (request.fee_paid ? 'Paid' : 'Pay on collection') : 'No fee'],
                ['Processing', turnaround(request.services?.processing_days)],
                request.released_at ? ['Released', longDate(request.released_at)] : null,
              ]
                .filter(Boolean)
                .map(([k, v]) => (
                  <div key={k} className="row" style={{ gap: 12 }}>
                    <span style={{ fontSize: 14, color: 'var(--ink-500)' }}>{k}</span>
                    <b style={{ marginLeft: 'auto', fontSize: 14.5, color: 'var(--ink-900)' }}>{v}</b>
                  </div>
                ))}
            </div>
          </Card>

          {request.status === 'ready' && (
            <Card padded style={{ padding: 24, background: 'var(--primary-100)', borderColor: 'var(--primary-200)' }}>
              <Icon name="check" size="lg" style={{ color: 'var(--primary-700)', marginBottom: 10 }} />
              <h3 style={{ fontSize: 16.5, marginBottom: 8 }}>Ready to collect</h3>
              <p style={{ fontSize: 14, color: 'var(--primary-800)', marginBottom: 16 }}>
                Collect at the barangay hall, Monday to Friday, 8:00 AM – 5:00 PM. Bring a valid ID.
                {request.fee > 0 && !request.fee_paid && ` The ${peso(request.fee)} fee is payable on collection.`}
              </p>
              <Button to="/app/appointments" size="s" variant="secondary" block icon="cal">
                Book a pickup slot
              </Button>
            </Card>
          )}

          <Card padded style={{ padding: 24 }}>
            <h3 style={{ fontSize: 17, marginBottom: 14 }}>Bring these when you collect</h3>
            <div className="stack" style={{ gap: 13 }}>
              {(request.services?.requirements ?? []).map((r) => (
                <div key={r} className="row" style={{ gap: 11, alignItems: 'flex-start' }}>
                  <Icon name="check" size="sm" style={{ color: 'var(--success-500)', marginTop: 3 }} />
                  <span style={{ fontSize: 14, color: 'var(--ink-600)' }}>{r}</span>
                </div>
              ))}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  )
}
