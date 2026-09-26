import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { Icon } from '../Icon'
import { GlobalSearch } from '../GlobalSearch'
import { MyAvatar } from '../MyAvatar'
import { Button } from '../ui'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { shortName } from '../../lib/formatters'
import { MainLogo } from '../MainLogo'

const ROLE_LABEL = {
  captain: 'Punong Barangay',
  secretary: 'Barangay Secretary',
  treasurer: 'Barangay Treasurer',
}

// One line of the wordmark: its own line, in the wordmark's own type.
const NAME_LINE = { display: 'block', fontSize: 'inherit', color: 'inherit' }

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
      { to: '/admin/admins', label: 'Admin accounts', icon: 'shield', captainOnly: true },
      { to: '/admin/reports', label: 'Reports', icon: 'brief' },
    ],
  },
  {
    // Your own account, as the resident sidebar ends with. Reachable from the
    // top bar already; this is the way in for anyone who looks for it in the
    // navigation instead. No captainOnly flag: every official has a profile.
    group: 'Account',
    items: [{ to: '/admin/profile', label: 'My profile', icon: 'user' }],
  },
]

export default function AdminLayout() {
  const { profile, role, isCaptain, signOut } = useAuth()
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
          <MainLogo className="seal" pill quiet onDark />
          <div>
            {/* Two deliberate lines rather than whatever the available width
                decides. A hyphen is a line-break opportunity, so left to
                itself the name splits as "BARANGAY E-" / "ASSIST" as soon as
                the font renders wider than expected -- a fallback face, a
                zoomed page, a longer sidebar label. Each word gets its own
                line, and E-ASSIST is held together so the hyphen can never
                break it. No fixed widths, so it stacks the same at any size. */}
            {/* fontSize and color are inherited back on purpose: .lockup span
                styles the "Staff portal" line beneath, and it matches any
                span in here, so without these the name would render in the
                subtitle's small grey type. */}
            <b>
              <span style={NAME_LINE}>BARANGAY</span>
              <span style={{ ...NAME_LINE, whiteSpace: 'nowrap' }}>E-ASSIST</span>
            </b>
            <span>Staff portal</span>
          </div>
        </Link>

        {NAV.map((section) => (
          <div key={section.group ?? 'main'} style={{ display: 'contents' }}>
            {section.group && <div className="grp">{section.group}</div>}
            {section.items.map((item) => {
              // Hiding it is the courtesy; the route guard and the Edge
              // Function are what actually stop anyone else.
              if (item.captainOnly && !isCaptain) return null
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

          <GlobalSearch scope="admin" placeholder="Search reference numbers, residents, notices" />

          {/* The Admin portal has no profile menu item; your own name is the way in. */}
          <Link to="/admin/profile" className="who" title="My profile">
            <MyAvatar name="official-placeholder.png" caption={false} className="av" pill quiet />
            <div>
              <b>{shortName(profile?.full_name) || 'Staff'}</b>
              <span>{ROLE_LABEL[role] ?? role}</span>
            </div>
          </Link>
        </div>

        <Outlet context={{ stats }} />
      </div>
    </div>
  )
}
