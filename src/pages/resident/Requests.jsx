import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Badge, Button, Card, CardHeader, PngSlot } from '../../components/ui'
import { EmptyState, ErrorState, LoadingRows } from '../../components/ui/States'
import { Icon } from '../../components/Icon'
import { REQUEST_STATUS, OPEN_STATUSES } from '../../lib/status'
import { peso, pesoShort, shortDate, turnaround } from '../../lib/formatters'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'In progress' },
  { key: 'ready', label: 'Ready for pickup' },
  { key: 'rejected', label: 'Needs correction' },
  { key: 'released', label: 'Released' },
]

export default function Requests() {
  const { profile, isApproved } = useAuth()
  const [filter, setFilter] = useState('all')

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['my-requests', 'all', profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      // No .eq('profile_id') needed — RLS already restricts this to the
      // signed-in resident's own rows. Adding it would be belt and braces,
      // but the point is that the database is what enforces it.
      const { data, error } = await supabase
        .from('document_requests')
        .select('*, services(name, icon)')
        .order('filed_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  // The document requests a resident can file here. Only kind = 'document':
  // the blotter report (kind 'report') has its own page and menu entry, and
  // the anonymous message needs no account. Names, descriptions, fees and
  // icons all come from the services table, as on the public Services page.
  const { data: documentTypes } = useQuery({
    queryKey: ['services', 'document'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('services')
        .select('code, name, description, fee, processing_days, icon')
        .eq('kind', 'document')
        .order('sort_order')
      if (error) throw error
      return data
    },
  })

  const rows = (data ?? []).filter((r) => {
    if (filter === 'all') return true
    if (filter === 'open') return OPEN_STATUSES.includes(r.status) && r.status !== 'ready'
    return r.status === filter
  })

  const counts = {
    all: data?.length ?? 0,
    open: (data ?? []).filter((r) => OPEN_STATUSES.includes(r.status) && r.status !== 'ready').length,
    ready: (data ?? []).filter((r) => r.status === 'ready').length,
    rejected: (data ?? []).filter((r) => r.status === 'rejected').length,
    released: (data ?? []).filter((r) => r.status === 'released').length,
  }

  return (
    <div className="dash-body">
      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <div className="grow">
          <span className="eyebrow">My requests</span>
          <h1 style={{ fontSize: 27, margin: '8px 0 0' }}>Everything you have filed</h1>
        </div>
        {isApproved && (
          <Button href="#choose-request" size="m" auto icon="doc">
            New request
          </Button>
        )}
      </div>

      {/* Each card opens the existing request form for that document, which
          files through the same system: reference number, statuses, and this
          list below. */}
      <section id="choose-request" aria-labelledby="choose-request-title" style={{ scrollMarginTop: 96 }}>
        <h2 id="choose-request-title" style={{ fontSize: 18, marginBottom: 6 }}>
          What would you like to request?
        </h2>
        <p style={{ fontSize: 14, color: 'var(--ink-500)', marginBottom: 16 }}>
          {isApproved
            ? 'Pick the document you need. The form asks only for what that document requires, and your request appears in the list below with its reference number.'
            : 'You can look at each form now. Filing opens once the barangay secretary approves your registration.'}
        </p>
        <div className="services req-choices">
          {(documentTypes ?? []).map((s) => (
            <Link key={s.code} to={`/app/requests/new/${s.code}`} className="svc">
              <PngSlot name={s.icon} className="slot" />
              <h3>{s.name}</h3>
              <p>{s.description}</p>
              <div className="go">
                Request this
                <Icon name="arrow" size="sm" />
                <span className="fee">
                  {pesoShort(s.fee)} · {turnaround(s.processing_days)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <div className="filterbar">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className="chip"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            {counts[f.key] > 0 && <span className="chip-n">{counts[f.key]}</span>}
          </button>
        ))}
      </div>

      <Card flush>
        <CardHeader title={FILTERS.find((f) => f.key === filter)?.label ?? 'All'} />

        {isLoading ? (
          <LoadingRows rows={4} />
        ) : isError ? (
          <ErrorState onRetry={refetch} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="doc"
            title={filter === 'all' ? 'No requests yet' : 'Nothing in this list'}
            action={
              isApproved && filter === 'all' ? (
                <Button href="#choose-request" size="m" auto>
                  Request a document
                </Button>
              ) : null
            }
          >
            {filter === 'all'
              ? 'When you file a clearance or certificate it appears here, with its reference number and current status.'
              : 'Try a different filter to see your other requests.'}
          </EmptyState>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Document</th>
                <th>Filed</th>
                <th>Fee</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="clickable">
                  <td className="ref" data-label="Reference">
                    <Link to={`/app/requests/${r.ref_no}`}>{r.ref_no}</Link>
                  </td>
                  <td className="doc" data-label="Document">
                    {r.services?.name}
                  </td>
                  <td className="when" data-label="Filed">
                    {shortDate(r.filed_at)}
                  </td>
                  <td className="when" data-label="Fee">
                    {peso(r.fee)}
                    {r.fee > 0 && !r.fee_paid && (
                      <span style={{ color: 'var(--warning-600)' }}> · unpaid</span>
                    )}
                  </td>
                  <td data-label="Status">
                    <Badge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {counts.rejected > 0 && (
        <Card padded style={{ background: 'var(--danger-100)', borderColor: '#F3C9C7' }}>
          <b style={{ display: 'block', fontSize: 15, color: 'var(--danger-600)', marginBottom: 6 }}>
            {counts.rejected} request{counts.rejected > 1 ? 's need' : ' needs'} correcting
          </b>
          <p style={{ fontSize: 14, color: 'var(--danger-600)' }}>
            {REQUEST_STATUS.rejected.resident} Open the request to see the secretary's remarks.
          </p>
        </Card>
      )}
    </div>
  )
}
