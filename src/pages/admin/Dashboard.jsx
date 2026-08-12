import { Link, useOutletContext } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Badge, Button, Card, CardHeader } from '../../components/ui'
import { EmptyState, LoadingRows } from '../../components/ui/States'
import { Icon } from '../../components/Icon'
import { firstName, peso, shortDate, timeOnly } from '../../lib/formatters'

export default function AdminDashboard() {
  const { profile } = useAuth()
  const { stats } = useOutletContext()

  const { data: queue, isLoading } = useQuery({
    queryKey: ['admin-queue-preview'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('document_requests')
        .select('*, services(name), profiles!document_requests_profile_id_fkey(full_name, resident_id, purok)')
        .in('status', ['pending', 'processing'])
        .order('filed_at', { ascending: true })
        .limit(6)
      if (error) throw error
      return data
    },
  })

  const { data: pendingResidents } = useQuery({
    queryKey: ['admin-pending-residents'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, purok, created_at, valid_id_type')
        .eq('status', 'pending')
        .order('created_at')
        .limit(5)
      if (error) throw error
      return data
    },
  })

  const { data: today } = useQuery({
    queryKey: ['admin-today-appointments'],
    queryFn: async () => {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      const end = new Date(start)
      end.setDate(end.getDate() + 1)
      const { data, error } = await supabase
        .from('appointments')
        .select('*, profiles(full_name, resident_id)')
        .eq('status', 'booked')
        .gte('scheduled_at', start.toISOString())
        .lt('scheduled_at', end.toISOString())
        .order('scheduled_at')
      if (error) throw error
      return data
    },
  })

  const cards = [
    { label: 'Awaiting review', value: stats?.requests_pending ?? 0, icon: 'doc', to: '/admin/requests?status=pending', sub: 'Document requests' },
    { label: 'Ready for pickup', value: stats?.requests_ready ?? 0, icon: 'check', to: '/admin/requests?status=ready', sub: 'Waiting on the resident', tone: 'var(--success-600)' },
    { label: 'New registrations', value: stats?.residents_pending ?? 0, icon: 'users', to: '/admin/residents?status=pending', sub: 'Need verifying', tone: 'var(--accent-600)' },
    { label: 'Open blotter cases', value: stats?.blotter_open ?? 0, icon: 'alert', to: '/admin/blotter', sub: 'Filed or in mediation', tone: 'var(--danger-600)' },
  ]

  return (
    <div className="dash-body">
      <div className="welcome">
        <div className="grow">
          <h1>Magandang araw, {firstName(profile?.full_name)}.</h1>
          <p>
            {stats
              ? `${stats.requests_pending} request${stats.requests_pending === 1 ? '' : 's'} awaiting review, ${stats.residents_pending} registration${stats.residents_pending === 1 ? '' : 's'} to verify, and ${stats.appointments_today} appointment${stats.appointments_today === 1 ? '' : 's'} booked for today.`
              : 'Loading the barangay caseload…'}
          </p>
        </div>
        <PngSeal />
      </div>

      <div className="stats">
        {cards.map((c) => (
          <Link key={c.label} to={c.to} className="stat" style={{ display: 'block' }}>
            <div className="top" style={{ color: c.tone }}>
              <Icon name={c.icon} size="sm" />
              <b>{c.label}</b>
            </div>
            <div className="n">{c.value}</div>
            <div className="sub">{c.sub}</div>
          </Link>
        ))}
      </div>

      <div className="grid-2 split" style={{ gap: 24, alignItems: 'start' }}>
        <div className="stack" style={{ gap: 24 }}>
          <Card flush>
            <CardHeader title="Oldest waiting">
              <Button to="/admin/requests" size="s" variant="ghost" iconRight="chev">
                Open the queue
              </Button>
            </CardHeader>

            {isLoading ? (
              <LoadingRows rows={4} />
            ) : queue?.length ? (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Resident</th>
                    <th>Document</th>
                    <th>Filed</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((r) => (
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
                      <td className="when" data-label="Filed">{shortDate(r.filed_at)}</td>
                      <td data-label="Status"><Badge status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState icon="check" title="Nothing waiting">
                Every document request has been picked up. The queue is clear.
              </EmptyState>
            )}
          </Card>

          <Card flush>
            <CardHeader title="Registrations to verify">
              <Button to="/admin/residents" size="s" variant="ghost" iconRight="chev">
                All residents
              </Button>
            </CardHeader>
            {pendingResidents?.length ? (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Purok</th>
                    <th>ID presented</th>
                    <th>Registered</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingResidents.map((p) => (
                    <tr key={p.id} className="clickable">
                      <td className="doc" data-label="Name">
                        <Link to={`/admin/residents/${p.id}`}>{p.full_name}</Link>
                      </td>
                      <td className="when" data-label="Purok">{p.purok ? `Purok ${p.purok}` : '—'}</td>
                      <td className="when" data-label="ID presented">{p.valid_id_type ?? '—'}</td>
                      <td className="when" data-label="Registered">{shortDate(p.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState icon="users" title="No new registrations">
                Everyone who has registered has been verified.
              </EmptyState>
            )}
          </Card>
        </div>

        <div className="stack" style={{ gap: 24 }}>
          <Card flush>
            <CardHeader title="Today at the hall" />
            {today?.length ? (
              today.map((a) => (
                <div className="appt" key={a.id}>
                  <div className="date" style={{ width: 66 }}>
                    <b style={{ fontSize: 15 }}>{timeOnly(a.scheduled_at).replace(' ', '')}</b>
                  </div>
                  <div className="grow">
                    <b style={{ display: 'block', fontSize: 14.5, color: 'var(--ink-900)' }}>
                      {a.profiles?.full_name}
                    </b>
                    <span style={{ fontSize: 13, color: 'var(--ink-400)' }}>
                      {a.purpose}
                      {a.window_no ? ` · Window ${a.window_no}` : ''}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState icon="cal" title="No appointments today">
                Residents can still walk in during office hours.
              </EmptyState>
            )}
          </Card>

          <Card padded style={{ padding: 24 }}>
            <div className="row" style={{ gap: 12, marginBottom: 16 }}>
              <Icon name="brief" size="lg" style={{ color: 'var(--primary-600)' }} />
              <h3 style={{ fontSize: 16.5, flex: 1 }}>Fees</h3>
            </div>
            <div className="stack" style={{ gap: 14 }}>
              <div className="row" style={{ gap: 12 }}>
                <span style={{ fontSize: 14, color: 'var(--ink-500)' }}>Collected</span>
                <b style={{ marginLeft: 'auto', fontSize: 17, color: 'var(--success-600)', fontFamily: 'var(--display)' }}>
                  {peso(stats?.fees_collected)}
                </b>
              </div>
              <div className="row" style={{ gap: 12 }}>
                <span style={{ fontSize: 14, color: 'var(--ink-500)' }}>Outstanding</span>
                <b style={{ marginLeft: 'auto', fontSize: 17, color: 'var(--warning-600)', fontFamily: 'var(--display)' }}>
                  {peso(stats?.fees_outstanding)}
                </b>
              </div>
            </div>
            <div style={{ marginTop: 18 }}>
              <Button to="/admin/reports" size="s" variant="secondary" block iconRight="chev">
                Full reports
              </Button>
            </div>
          </Card>

          {stats?.anon_new > 0 && (
            <div className="anon-card">
              <h3>{stats.anon_new} unread anonymous message{stats.anon_new === 1 ? '' : 's'}</h3>
              <p>
                Sent without a name. Nobody — including the barangay — can trace these back to a
                resident, so they are read on their own merits.
              </p>
              <Button to="/admin/anonymous" size="m" variant="accent" block icon="incognito">
                Open the inbox
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PngSeal() {
  return (
    <div
      className="av pill quiet on-dark-slot"
      data-png="barangay-logo.png"
      style={{ width: 76, height: 76, flex: 'none' }}
      aria-hidden="true"
    />
  )
}
