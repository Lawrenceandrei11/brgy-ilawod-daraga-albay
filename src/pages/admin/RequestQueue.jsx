import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '../../lib/supabase'
import { Badge, Button, Card, CardHeader } from '../../components/ui'
import { EmptyState, ErrorState, LoadingRows } from '../../components/ui/States'
import { REQUEST_STATUS } from '../../lib/status'
import { peso, relative, shortDate } from '../../lib/formatters'

const TABS = [
  { key: 'pending', label: 'Awaiting review' },
  { key: 'processing', label: 'In progress' },
  { key: 'approved', label: 'Approved' },
  { key: 'ready', label: 'Ready for pickup' },
  { key: 'rejected', label: 'Returned' },
  { key: 'released', label: 'Released' },
  { key: 'all', label: 'All' },
]

export default function RequestQueue() {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? 'pending'
  const service = params.get('service') ?? 'all'

  const { data: services } = useQuery({
    queryKey: ['services'],
    queryFn: async () => {
      const { data, error } = await supabase.from('services').select('code, name').eq('kind', 'document').order('sort_order')
      if (error) throw error
      return data
    },
  })

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-requests', status, service],
    queryFn: async () => {
      let q = supabase
        .from('document_requests')
        .select('*, services(name), profiles!document_requests_profile_id_fkey(full_name, resident_id, purok)')
        .order('filed_at', { ascending: true })

      if (status !== 'all') q = q.eq('status', status)
      if (service !== 'all') q = q.eq('service_code', service)

      const { data, error } = await q
      if (error) throw error
      return data
    },
  })

  const { data: counts } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_stats')
      if (error) throw error
      return data?.requests_by_status ?? {}
    },
  })

  function setParam(key, value) {
    const next = new URLSearchParams(params)
    if (value === 'all' && key === 'service') next.delete(key)
    else next.set(key, value)
    setParams(next)
  }

  return (
    <div className="dash-body">
      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <div className="grow">
          <span className="eyebrow">Document requests</span>
          <h1 style={{ fontSize: 27, margin: '8px 0 0' }}>The queue</h1>
        </div>
      </div>

      <div className="filterbar">
        {TABS.map((t) => (
          <button
            key={t.key}
            className="chip"
            aria-pressed={status === t.key}
            onClick={() => setParam('status', t.key)}
          >
            {t.label}
            {counts?.[t.key] > 0 && <span className="chip-n">{counts[t.key]}</span>}
          </button>
        ))}
      </div>

      <div className="filterbar">
        <button
          className="chip"
          aria-pressed={service === 'all'}
          onClick={() => setParam('service', 'all')}
        >
          Every document
        </button>
        {(services ?? []).map((s) => (
          <button
            key={s.code}
            className="chip"
            aria-pressed={service === s.code}
            onClick={() => setParam('service', s.code)}
          >
            {s.name}
          </button>
        ))}
      </div>

      <Card flush>
        <CardHeader title={`${TABS.find((t) => t.key === status)?.label ?? 'All'} · ${data?.length ?? 0}`} />

        {isLoading ? (
          <LoadingRows rows={5} />
        ) : isError ? (
          <ErrorState onRetry={refetch} />
        ) : data.length === 0 ? (
          <EmptyState icon="check" title="Nothing here">
            {status === 'pending'
              ? 'Every request has been picked up. The queue is clear.'
              : 'No requests match this filter.'}
          </EmptyState>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Resident</th>
                <th>Document</th>
                <th>Waiting</th>
                <th>Fee</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} className="clickable">
                  <td className="ref" data-label="Reference">
                    <Link to={`/admin/requests/${r.ref_no}`}>{r.ref_no}</Link>
                  </td>
                  <td className="doc" data-label="Resident">
                    {r.profiles?.full_name}
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-400)' }}>
                      {r.profiles?.resident_id}
                      {r.profiles?.purok ? ` · Purok ${r.profiles.purok}` : ''}
                    </span>
                  </td>
                  <td className="when" data-label="Document">{r.services?.name}</td>
                  <td className="when" data-label="Waiting">
                    {shortDate(r.filed_at)}
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-400)' }}>
                      {relative(r.filed_at)}
                    </span>
                  </td>
                  <td className="when" data-label="Fee">
                    {peso(r.fee)}
                    {r.fee > 0 && (
                      <span
                        style={{
                          display: 'block',
                          fontSize: 12,
                          color: r.fee_paid ? 'var(--success-600)' : 'var(--warning-600)',
                        }}
                      >
                        {r.fee_paid ? 'paid' : 'unpaid'}
                      </span>
                    )}
                  </td>
                  <td data-label="Status"><Badge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {status !== 'all' && REQUEST_STATUS[status] && (
        <p style={{ fontSize: 13.5, color: 'var(--ink-400)' }}>
          <b>{REQUEST_STATUS[status].label}:</b> {REQUEST_STATUS[status].resident}
        </p>
      )}
    </div>
  )
}
