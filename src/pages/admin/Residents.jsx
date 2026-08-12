import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '../../lib/supabase'
import { Badge, Button, Card, CardHeader, Field } from '../../components/ui'
import { EmptyState, ErrorState, LoadingRows } from '../../components/ui/States'
import { shortDate } from '../../lib/formatters'

const TABS = [
  { key: 'pending', label: 'To verify' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Not approved' },
  { key: 'all', label: 'Everyone' },
]

const STATUS_TONE = { approved: 'approved', pending: 'pending', rejected: 'rejected', suspended: 'released' }

export default function Residents() {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? 'pending'
  const [search, setSearch] = useState('')

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-residents', status],
    queryFn: async () => {
      let q = supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false })
      if (status !== 'all') q = q.eq('status', status)
      const { data, error } = await q
      if (error) throw error
      return data
    },
  })

  const rows = (data ?? []).filter((p) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      p.full_name?.toLowerCase().includes(q) ||
      p.resident_id?.toLowerCase().includes(q) ||
      p.mobile?.includes(q)
    )
  })

  return (
    <div className="dash-body">
      <div>
        <span className="eyebrow">Residents</span>
        <h1 style={{ fontSize: 27, margin: '8px 0 0' }}>The barangay masterlist</h1>
      </div>

      <div className="filterbar">
        {TABS.map((t) => (
          <button
            key={t.key}
            className="chip"
            aria-pressed={status === t.key}
            onClick={() => {
              const next = new URLSearchParams(params)
              next.set('status', t.key)
              setParams(next)
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 380 }}>
        <Field
          label="Search"
          placeholder="Name, Resident ID or mobile number"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card flush>
        <CardHeader title={`${TABS.find((t) => t.key === status)?.label} · ${rows.length}`} />

        {isLoading ? (
          <LoadingRows rows={5} />
        ) : isError ? (
          <ErrorState onRetry={refetch} />
        ) : rows.length === 0 ? (
          <EmptyState icon="users" title="Nobody here">
            {status === 'pending'
              ? 'Every registration has been verified.'
              : 'No residents match this filter.'}
          </EmptyState>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Resident ID</th>
                <th>Purok</th>
                <th>Registered</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="clickable">
                  <td className="doc" data-label="Name">
                    <Link to={`/admin/residents/${p.id}`}>{p.full_name}</Link>
                    {p.role !== 'resident' && (
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--primary-600)', fontWeight: 600 }}>
                        {p.role}
                      </span>
                    )}
                  </td>
                  <td className="ref" data-label="Resident ID">{p.resident_id ?? '—'}</td>
                  <td className="when" data-label="Purok">{p.purok ? `Purok ${p.purok}` : '—'}</td>
                  <td className="when" data-label="Registered">{shortDate(p.created_at)}</td>
                  <td data-label="Status">
                    <Badge tone={STATUS_TONE[p.status]}>
                      {p.status === 'pending' ? 'To verify' : p.status}
                    </Badge>
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
