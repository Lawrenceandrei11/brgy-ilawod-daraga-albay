import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '../../lib/supabase'
import { Badge, Card, CardHeader, Notice } from '../../components/ui'
import { EmptyState, ErrorState, LoadingRows } from '../../components/ui/States'
import { smsStatusLabel, smsStatusTone } from '../../lib/sms'
import { relative, shortDate, timeOnly } from '../../lib/formatters'

/**
 * The delivery log.
 *
 * This screen exists to answer one question staff will ask the moment a
 * resident says nobody told them: did the text go out, and if not, why not.
 * So a message that was never sent carries its reason in the same row as one
 * that was, rather than simply being absent.
 */

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'queued', label: 'Waiting' },
  { key: 'sent', label: 'Sent' },
  { key: 'failed', label: 'Not delivered' },
  { key: 'skipped', label: 'Not sent' },
]

export default function SmsLog() {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? 'all'

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-sms', status],
    queryFn: async () => {
      let q = supabase
        .from('sms_messages')
        .select('*, document_requests(ref_no), profiles(full_name, resident_id)')
        .order('created_at', { ascending: false })
        .limit(200)

      if (status !== 'all') q = q.eq('status', status)

      const { data, error } = await q
      if (error) throw error
      return data
    },
    // Messages leave the queue one every ten seconds, so a stale screen is
    // worse than a slightly chatty one.
    refetchInterval: 20_000,
  })

  function setStatus(next) {
    const p = new URLSearchParams(params)
    if (next === 'all') p.delete('status')
    else p.set('status', next)
    setParams(p)
  }

  const waiting = data?.filter((m) => m.status === 'queued').length ?? 0

  return (
    <div className="dash-body">
      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <div className="grow">
          <span className="eyebrow">Text messages</span>
          <h1 style={{ fontSize: 27, margin: '8px 0 0' }}>What the barangay has sent</h1>
        </div>
      </div>

      {status === 'all' && waiting > 0 && (
        <Notice tone="quiet" icon="clock" title={`${waiting} still to send`}>
          The network allows one text every ten seconds, so a notice sent to the whole barangay
          takes a while to finish going out. Nothing here needs your attention.
        </Notice>
      )}

      <div className="filterbar">
        {TABS.map((t) => (
          <button
            key={t.key}
            className="chip"
            aria-pressed={status === t.key}
            onClick={() => setStatus(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card flush>
        <CardHeader title={`${data?.length ?? 0} messages`} />

        {isLoading ? (
          <LoadingRows rows={5} />
        ) : isError ? (
          <ErrorState onRetry={refetch} />
        ) : data?.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>When</th>
                <th>Resident</th>
                <th>Message</th>
                <th>About</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id}>
                  <td className="when" data-label="When">
                    {shortDate(m.created_at)} · {timeOnly(m.created_at)}
                  </td>

                  <td className="doc" data-label="Resident">
                    {m.profiles?.full_name ?? 'Record removed'}
                    <span style={{ display: 'block', fontSize: 12.5, color: 'var(--ink-400)' }}>
                      {m.recipient ?? 'no number on file'}
                      {/* Only differs when a test recipient is set, and that is
                          exactly when someone needs to notice. */}
                      {m.sent_to && m.sent_to !== m.recipient && ` → sent to ${m.sent_to}`}
                    </span>
                  </td>

                  <td data-label="Message" style={{ maxWidth: 380 }}>
                    <span style={{ fontSize: 13.5, color: 'var(--ink-700)' }}>{m.body}</span>
                  </td>

                  <td className="when" data-label="About">
                    {m.document_requests?.ref_no ? (
                      <Link to={`/admin/requests/${m.document_requests.ref_no}`}>
                        {m.document_requests.ref_no}
                      </Link>
                    ) : m.kind === 'announcement' ? (
                      'Announcement'
                    ) : (
                      '—'
                    )}
                  </td>

                  <td data-label="Status">
                    <Badge tone={smsStatusTone(m.status)}>{smsStatusLabel(m.status)}</Badge>
                    {(m.skip_reason || m.last_error) && (
                      <span
                        style={{
                          display: 'block',
                          fontSize: 12.5,
                          color: 'var(--ink-400)',
                          marginTop: 6,
                          maxWidth: 260,
                        }}
                      >
                        {m.skip_reason || m.last_error}
                      </span>
                    )}
                    {m.status === 'sent' && m.sent_at && (
                      <span style={{ display: 'block', fontSize: 12.5, color: 'var(--ink-400)', marginTop: 6 }}>
                        {relative(m.sent_at)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState icon="bell" title="No text messages yet">
            Residents are texted when a request is approved, ready, released, returned for
            correction or scheduled — and when staff tick “Also text residents” on a notice.
          </EmptyState>
        )}
      </Card>
    </div>
  )
}
