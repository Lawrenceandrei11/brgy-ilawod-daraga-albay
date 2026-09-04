import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { Icon } from '../Icon'
import { Button, PngSlot } from '../ui'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { shortName } from '../../lib/formatters'

const ROLE_LABEL = {
  captain: 'Punong Barangay',
  secretary: 'Barangay Secretary',
  treasurer: 'Barangay Treasurer',
}

const NAV = [
  {
    group: null,
    items: [
      { to: '/admin', label: 'Overview', icon: 'dash', end: true },
      { to: '/admin/requests', label: 'Document requests', icon: 'doc', badge: 'requests_pending' },
      { to: '/admin/residents', label: 'Residents', icon: 'users', badge: 'residents_pending' },
      { to: '/admin/appointments', label: 'Appointments', icon: 'cal', badge: 'appointments_today' },
    ],
  },
  {
    group: 'Reports & concerns',
    items: [
      { to: '/admin/blotter', label: 'Blotter', icon: 'alert', badge: 'blotter_open' },
      { to: '/admin/anonymous', label: 'Anonymous inbox', icon: 'incognito', badge: 'anon_new' },
    ],
  },
  {
    group: 'Barangay',
    items: [
      { to: '/admin/announcements', label: 'Announcements', icon: 'mega' },
      { to: '/admin/notifications', label: 'Text messages', icon: 'bell' },
      { to: '/admin/officials', label: 'Officials', icon: 'user' },
      { to: '/admin/reports', label: 'Reports', icon: 'brief' },
    ],
  },
]

export default function AdminLayout() {
  const { profile, role, signOut } = useAuth()
  const [drawer, setDrawer] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => setDrawer(false), [location.pathname])

  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_stats')
      if (error) throw error
      return data
    },
    refetchInterval: 60_000,
  })

  async function handleSignOut() {
    await signOut()
    navigate('/', { replace: true })
  }

  return (
    <div className="dash">
      {drawer && <div className="side-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />}

      <aside className={`side admin ${drawer ? 'open' : ''}`.trim()}>
        <Link to="/" className="lockup">
          <PngSlot name="barangay-logo.png" className="seal" pill quiet onDark />
          <div>
            <b>BARANGAY E-ASSIST</b>
            <span>Staff portal</span>
          </div>
        </Link>

        {NAV.map((section) => (
          <div key={section.group ?? 'main'} style={{ display: 'contents' }}>
            {section.group && <div className="grp">{section.group}</div>}
            {section.items.map((item) => {
              const n = item.badge ? stats?.[item.badge] : null
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
          <b>Viewing as {ROLE_LABEL[role] ?? role}</b>
          <p>Every status change you make is recorded against your name in the request history.</p>
          <Button size="s" variant="onDark" block to="/app">
            Switch to resident view
          </Button>
        </div>

        <a style={{ marginTop: 10 }} onClick={handleSignOut} role="button" tabIndex={0}>
          <Icon name="logout" /> Sign out
        </a>
      </aside>

      <div style={{ minWidth: 0 }}>
        <div className="topbar">
          <button className="side-toggle" onClick={() => setDrawer(true)} aria-label="Open navigation">
            <Icon name="menu" />
          </button>

          <div className="search">
            <Icon name="search" />
            <input placeholder="Search by reference number or resident name" />
          </div>

          <div className="who">
            <PngSlot name="official-placeholder.png" className="av" pill quiet />
            <div>
              <b>{shortName(profile?.full_name) || 'Staff'}</b>
              <span>{ROLE_LABEL[role] ?? role}</span>
            </div>
          </div>
        </div>

        <Outlet context={{ stats }} />
      </div>
    </div>
  )
}
