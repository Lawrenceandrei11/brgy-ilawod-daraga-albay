import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { addDays, format, startOfDay } from 'date-fns'

import { supabase, friendlyError } from '../../lib/supabase'
import { Badge, Button, Card, CardHeader, Field, Notice } from '../../components/ui'
import { EmptyState, LoadingRows } from '../../components/ui/States'
import { longDate, timeOnly } from '../../lib/formatters'

const STATUS_TONE = { booked: 'processing', completed: 'approved', cancelled: 'rejected', no_show: 'released' }

export default function AppointmentsAdmin() {
  const queryClient = useQueryClient()
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-appointments', date],
    queryFn: async () => {
      const from = startOfDay(new Date(date)).toISOString()
      const to = addDays(startOfDay(new Date(date)), 1).toISOString()
      const { data, error } = await supabase
        .from('appointments')
        .select('*, profiles(full_name, resident_id, purok, mobile), document_requests(ref_no, services(name))')
        .gte('scheduled_at', from)
        .lt('scheduled_at', to)
        .order('scheduled_at')
      if (error) throw error
      return data
    },
  })

  async function setStatus(id, status) {
    setBusy(id)
    setError(null)
    try {
      const { error: updateError } = await supabase.from('appointments').update({ status }).eq('id', id)
      if (updateError) throw updateError
      queryClient.invalidateQueries({ queryKey: ['admin-appointments'] })
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(null)
    }
  }

  const booked = (data ?? []).filter((a) => a.status === 'booked')

  return (
    <div className="dash-body">
      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <div className="grow">
          <span className="eyebrow">Appointments</span>
          <h1 style={{ fontSize: 27, margin: '8px 0 0' }}>Who is coming in</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="m" auto variant="secondary" onClick={() => setDate(format(new Date(), 'yyyy-MM-dd'))}>
            Today
          </Button>
          <Button
            size="m"
            auto
            variant="secondary"
            onClick={() => setDate(format(addDays(new Date(date), 1), 'yyyy-MM-dd'))}
          >
            Next day
          </Button>
        </div>
      </div>

      {error && <Notice tone="danger" icon="alert" title="Could not save">{error}</Notice>}

      <div style={{ maxWidth: 260 }}>
        <Field label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <Card flush>
        <CardHeader title={`${longDate(date)} · ${booked.length} booked`} />
        {isLoading ? (
          <LoadingRows rows={4} />
        ) : (data ?? []).length === 0 ? (
          <EmptyState icon="cal" title="Nobody booked">
            No appointments for this date. Residents can still walk in during office hours.
          </EmptyState>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Time</th>
                <th>Resident</th>
                <th>Purpose</th>
                <th>Window</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id}>
                  <td className="ref" data-label="Time">{timeOnly(a.scheduled_at)}</td>
                  <td className="doc" data-label="Resident">
                    {a.profiles?.full_name}
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-400)' }}>
                      {a.profiles?.resident_id}
                      {a.profiles?.purok ? ` · Purok ${a.profiles.purok}` : ''} · {a.profiles?.mobile}
                    </span>
                  </td>
                  <td className="when" data-label="Purpose">
                    {a.purpose}
                    {a.document_requests?.ref_no && (
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--primary-600)' }}>
                        {a.document_requests.ref_no}
                      </span>
                    )}
                  </td>
                  <td className="when" data-label="Window">{a.window_no ?? '—'}</td>
                  <td data-label="Status">
                    <Badge tone={STATUS_TONE[a.status]}>{a.status.replace('_', ' ')}</Badge>
                  </td>
                  <td data-label="Action">
                    {a.status === 'booked' && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <Button size="s" auto disabled={busy === a.id} onClick={() => setStatus(a.id, 'completed')}>
                          Seen
                        </Button>
                        <Button
                          size="s"
                          auto
                          variant="ghost"
                          disabled={busy === a.id}
                          onClick={() => setStatus(a.id, 'no_show')}
                        >
                          No show
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
