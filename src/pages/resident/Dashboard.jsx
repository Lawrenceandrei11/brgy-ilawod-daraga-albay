import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Badge, Button, Card, CardHeader, PngSlot } from '../../components/ui'
import { EmptyState, LoadingRows } from '../../components/ui/States'
import { Icon } from '../../components/Icon'
import { MyAvatar } from '../../components/MyAvatar'
import { firstName, shortDate, dayParts, timeOnly } from '../../lib/formatters'
import { OPEN_STATUSES } from '../../lib/status'

export default function Dashboard() {
  const { profile, isApproved } = useAuth()

  const { data: services } = useQuery({
    queryKey: ['services'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('services')
        .select('*')
        .order('sort_order')
      if (error) throw error
      return data
    },
  })

  const { data: requests, isLoading: requestsLoading } = useQuery({
    queryKey: ['my-requests', profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('document_requests')
        .select('*, services(name)')
        .order('filed_at', { ascending: false })
        .limit(5)
      if (error) throw error
      return data
    },
  })

  const { data: announcements } = useQuery({
    queryKey: ['announcements', 'recent'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('announcements')
        .select('id, title, category, published_at')
        .not('published_at', 'is', null)
        .order('published_at', { ascending: false })
        .limit(3)
      if (error) throw error
      return data
    },
  })

  const { data: appointments } = useQuery({
    queryKey: ['my-appointments', profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select('*')
        .eq('status', 'booked')
        .order('scheduled_at')
        .limit(3)
      if (error) throw error
      return data
    },
  })

  const { data: enrollment } = useQuery({
    queryKey: ['face-enrollment', profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('face_enrollment_status')
      if (error) throw error
      return data?.[0] ?? null
    },
  })

  const open = (requests ?? []).filter((r) => OPEN_STATUSES.includes(r.status))
  const ready = (requests ?? []).filter((r) => r.status === 'ready')
  const needsAction = (requests ?? []).filter((r) => r.status === 'rejected')

  const documentServices = (services ?? []).filter((s) => s.kind === 'document')

  return (
    <div className="dash-body">
      <div className="welcome">
        <div className="grow">
          {enrollment?.angles >= 3 && (
            <Badge tone="verified" style={{ marginBottom: 14 }}>
              Face enrolled
            </Badge>
          )}
          <h1>Magandang araw, {firstName(profile?.full_name) || 'kabarangay'}.</h1>
          <p>
            {!isApproved
              ? 'Your account is still being reviewed. You can browse the services and announcements while you wait.'
              : open.length === 0
                ? 'You have no active requests. Request a document below and it will be tracked from filing to release.'
                : `You have ${open.length} active ${open.length === 1 ? 'request' : 'requests'}${
                    ready.length ? `, and ${ready.length} ready to collect at the barangay hall` : ''
                  }.`}
          </p>
        </div>
        <MyAvatar name="resident-placeholder.png" className="av" pill quiet onDark />
      </div>

      <div className="stats">
        <div className="stat">
          <div className="top">
            <Icon name="doc" size="sm" />
            <b>Active requests</b>
          </div>
          <div className="n">{open.length}</div>
          <div className="sub">
            {needsAction.length ? `${needsAction.length} needs your action` : 'Nothing needs you'}
          </div>
        </div>

        <div className="stat">
          <div className="top" style={{ color: 'var(--success-600)' }}>
            <Icon name="check" size="sm" />
            <b>Ready for pickup</b>
          </div>
          <div className="n">{ready.length}</div>
          <div className="sub">{ready.length ? 'Collect at the barangay hall' : 'Nothing waiting'}</div>
        </div>

        <div className="stat">
          <div className="top" style={{ color: 'var(--accent-600)' }}>
            <Icon name="cal" size="sm" />
            <b>Appointments</b>
          </div>
          <div className="n">{appointments?.length ?? 0}</div>
          <div className="sub">
            {appointments?.length
              ? `Next: ${shortDate(appointments[0].scheduled_at)}`
              : 'None booked'}
          </div>
        </div>

        <div className="stat">
          <div className="top">
            <Icon name="bell" size="sm" />
            <b>Announcements</b>
          </div>
          <div className="n">{announcements?.length ?? 0}</div>
          <div className="sub">From the barangay</div>
        </div>
      </div>

      <div>
        <h2 style={{ fontSize: 18, marginBottom: 14 }}>Request a document</h2>
        <div className="quick">
          {(services ?? []).map((s) => (
            <Link
              key={s.code}
              to={
                s.code === 'anonymous'
                  ? '/anonymous'
                  : s.code === 'blotter'
                    ? '/app/blotter'
                    : `/app/requests/new/${s.code}`
              }
              className="qa"
            >
              <PngSlot name={s.icon} className="slot" />
              <b>{s.name}</b>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid-2 split" style={{ gap: 24, alignItems: 'start' }}>
        <div className="stack" style={{ gap: 24 }}>
          <Card flush>
            <CardHeader title="My requests">
              <Button to="/app/requests" size="s" variant="ghost" iconRight="chev">
                View all
              </Button>
            </CardHeader>

            {requestsLoading ? (
              <LoadingRows rows={3} />
            ) : requests?.length ? (
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
                    <tr key={r.id}>
                      <td className="ref" data-label="Reference">
                        <Link to={`/app/requests/${r.ref_no}`}>{r.ref_no}</Link>
                      </td>
                      <td className="doc" data-label="Document">{r.services?.name}</td>
                      <td className="when" data-label="Filed">{shortDate(r.filed_at)}</td>
                      <td data-label="Status"><Badge status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState
                icon="doc"
                title="No requests yet"
                action={
                  isApproved ? (
                    <Button to="/app/requests/new/barangay-clearance" size="m" auto>
                      Request a document
                    </Button>
                  ) : null
                }
              >
                When you file a clearance or certificate it appears here, with its reference number
                and current status.
              </EmptyState>
            )}
          </Card>

          <Card flush>
            <CardHeader title="Announcements">
              <Button to="/announcements" size="s" variant="ghost" iconRight="chev">
                All notices
              </Button>
            </CardHeader>
            <div className="feed">
              {(announcements ?? []).map((a) => (
                <Link key={a.id} to={`/announcements/${a.id}`} className="feed-item">
                  <PngSlot name="announcement-placeholder.png" className="thumb" />
                  <div className="grow">
                    <b>{a.title}</b>
                    <span>
                      {shortDate(a.published_at)} · {a.category}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </Card>
        </div>

        <div className="stack" style={{ gap: 24 }}>
          <Card flush>
            <CardHeader title="Appointments" />
            {appointments?.length ? (
              appointments.map((a) => {
                const { day, month } = dayParts(a.scheduled_at)
                return (
                  <div className="appt" key={a.id}>
                    <div className="date">
                      <b>{day}</b>
                      <span>{month}</span>
                    </div>
                    <div className="grow">
                      <b style={{ display: 'block', fontSize: 14.5, color: 'var(--ink-900)' }}>
                        {a.purpose ?? 'Barangay hall visit'}
                      </b>
                      <span style={{ fontSize: 13, color: 'var(--ink-400)' }}>
                        {timeOnly(a.scheduled_at)}
                        {a.window_no ? ` · Window ${a.window_no}` : ''}
                      </span>
                    </div>
                  </div>
                )
              })
            ) : (
              <EmptyState icon="cal" title="No appointments booked">
                Book a slot and skip the queue at the barangay hall.
              </EmptyState>
            )}
            <div style={{ padding: '18px 26px' }}>
              <Button to="/app/appointments" size="m" variant="secondary" block icon="cal">
                Book an appointment
              </Button>
            </div>
          </Card>

          <Card padded style={{ padding: 24 }}>
            <div className="row" style={{ gap: 12, marginBottom: 14 }}>
              <Icon name="fp" size="lg" style={{ color: 'var(--primary-600)' }} />
              <h3 style={{ fontSize: 16.5, flex: 1 }}>Biometric status</h3>
            </div>

            {enrollment?.angles >= 3 ? (
              <>
                <Badge tone={enrollment.confirmed ? 'verified' : 'pending'} style={{ marginBottom: 14 }}>
                  {enrollment.confirmed ? 'Face enrolled & confirmed' : 'Awaiting confirmation'}
                </Badge>
                <p style={{ fontSize: 13.5, color: 'var(--ink-500)', marginBottom: 16 }}>
                  Enrolled {shortDate(enrollment.enrolled_at)}, {enrollment.angles} angles.
                  {!enrollment.confirmed &&
                    ' The secretary confirms this in person before it can be used to collect documents.'}
                </p>
                <Button to="/app/enroll" size="s" variant="secondary" block>
                  Re-enrol my face
                </Button>
              </>
            ) : (
              <>
                <p style={{ fontSize: 13.5, color: 'var(--ink-500)', marginBottom: 16 }}>
                  You have not enrolled your face yet. Enrolling lets you sign in by looking at the
                  camera instead of typing a password.
                </p>
                <Button to="/app/enroll" size="s" block icon="scan">
                  Enrol my face
                </Button>
              </>
            )}
          </Card>

          <div className="anon-card">
            <PngSlot name="service-anonymous.png" className="slot" onDark quiet />
            <h3>Something you'd rather not put your name to?</h3>
            <p>
              Send it anonymously. No name, no Resident ID, no email, no phone number — and you
              choose whether the barangay may contact you at all.
            </p>
            <Button to="/anonymous" size="m" variant="accent" block icon="incognito">
              Send an anonymous message
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
