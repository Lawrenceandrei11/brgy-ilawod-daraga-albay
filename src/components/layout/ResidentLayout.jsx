import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { Icon } from '../Icon'
import { Button, PngSlot } from '../ui'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { shortName } from '../../lib/formatters'
import { OPEN_STATUSES } from '../../lib/status'

const NAV = [
  { group: null, items: [
    { to: '/app', label: 'Dashboard', icon: 'dash', end: true },
    { to: '/app/requests', label: 'My requests', icon: 'doc', badge: 'openRequests' },
    { to: '/app/appointments', label: 'Appointments', icon: 'cal' },
    { to: '/track', label: 'Track a request', icon: 'search' },
  ]},
  { group: 'Report', items: [
    { to: '/app/blotter', label: 'Blotter report', icon: 'alert' },
    { to: '/anonymous', label: 'Anonymous message', icon: 'incognito' },
  ]},
  { group: 'Barangay', items: [
    { to: '/announcements', label: 'Announcements', icon: 'mega' },
    { to: '/map', label: 'Barangay map', icon: 'pin' },
    { to: '/app/profile', label: 'My profile', icon: 'user' },
  ]},
]

export default function ResidentLayout() {
  const { profile, signOut, isApproved, status } = useAuth()
  const [drawer, setDrawer] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  // Close the drawer on navigation, otherwise it stays over the new page.
  useEffect(() => setDrawer(false), [location.pathname])

  const { data: counts } = useQuery({
    queryKey: ['nav-counts', profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { count } = await supabase
        .from('document_requests')
        .select('id', { count: 'exact', head: true })
        .in('status', OPEN_STATUSES)
      return { openRequests: count ?? 0 }
    },
  })

  async function handleSignOut() {
    await signOut()
    navigate('/', { replace: true })
  }

  return (
    <div className="dash">
      {drawer && <div className="side-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />}

      <aside className={`side ${drawer ? 'open' : ''}`.trim()}>
        <Link to="/" className="lockup">
          <PngSlot name="barangay-logo.png" className="seal" pill quiet onDark />
          <div>
            <b>BARANGAY E-ASSIST</b>
            <span>Barangay Ilawod</span>
          </div>
        </Link>

        {NAV.map((section) => (
          <div key={section.group ?? 'main'} style={{ display: 'contents' }}>
            {section.group && <div className="grp">{section.group}</div>}
            {section.items.map((item) => {
              const n = item.badge ? counts?.[item.badge] : null
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => (isActive ? 'on' : '')}
                >
                  <Icon name={item.icon} />
                  {item.label}
                  {!!n && <span className="pip">{n}</span>}
                </NavLink>
              )
            })}
          </div>
        ))}

        <div className="card-help">
          <b>Need help?</b>
          <p>Visit the barangay hall Monday to Friday, 8:00 AM – 5:00 PM.</p>
          <Button size="s" variant="onDark" block>
            Contact the barangay
          </Button>
        </div>

        <a style={{ marginTop: 10 }} onClick={handleSignOut} role="button" tabIndex={0}>
          <Icon name="logout" /> Sign out
        </a>
      </aside>

      <div style={{ minWidth: 0 }}>
        <div className="topbar">
          <button
            className="side-toggle"
            onClick={() => setDrawer(true)}
            aria-label="Open navigation"
          >
            <Icon name="menu" />
          </button>

          <div className="search">
            <Icon name="search" />
            <input placeholder="Search requests, reference numbers, announcements" />
          </div>

          <button className="icon-btn" aria-label="Notifications">
            <Icon name="bell" />
          </button>

          <div className="who">
            <PngSlot name="resident-placeholder.png" className="av" pill quiet />
            <div>
              <b>{shortName(profile?.full_name) || 'Resident'}</b>
              <span>
                {profile?.resident_id ?? (status === 'pending' ? 'Pending approval' : 'No ID yet')}
                {profile?.purok ? ` · Purok ${profile.purok}` : ''}
              </span>
            </div>
          </div>
        </div>

        {!isApproved && <PendingBanner status={status} />}

        <Outlet />
      </div>
    </div>
  )
}

/**
 * A pending or rejected resident can sign in and look around, but cannot file
 * anything. Saying so plainly at the top of every page is kinder than letting
 * them fill in a form and hit a permission error at the end.
 */
function PendingBanner({ status }) {
  if (status === 'rejected') {
    return (
      <div
        style={{
          background: 'var(--danger-100)',
          borderBottom: '1px solid #F3C9C7',
          padding: '14px 32px',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          color: 'var(--danger-600)',
        }}
      >
        <Icon name="alert" />
        <div style={{ fontSize: 14 }}>
          <b>Your registration was not approved.</b> Visit the barangay hall with a valid ID to sort
          this out — the secretary can correct your record in person.
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        background: 'var(--warning-100)',
        borderBottom: '1px solid #F3DFBB',
        padding: '14px 32px',
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        color: 'var(--warning-600)',
      }}
    >
      <Icon name="clock" />
      <div style={{ fontSize: 14 }}>
        <b>Your registration is being reviewed.</b> You can look around, but you won't be able to
        file a request until the barangay secretary approves your account.
      </div>
    </div>
  )
}
