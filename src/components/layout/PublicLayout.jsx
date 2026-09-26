import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Icon } from '../Icon'
import { Button } from '../ui'
import { MainLogo } from '../MainLogo'
import { useAuth } from '../../hooks/useAuth'

const LINKS = [
  // `end`: every path starts with "/", so without it Home would show as the
  // current page everywhere.
  { to: '/', label: 'Home', end: true },
  { to: '/services', label: 'Services' },
  { to: '/announcements', label: 'Announcements' },
  { to: '/track', label: 'Track a request' },
  { to: '/map', label: 'Barangay map' },
]

export function PublicNav() {
  const [open, setOpen] = useState(false)
  const { signedIn, isStaff } = useAuth()
  const location = useLocation()

  // Close the mobile sheet whenever the route changes.
  const close = () => setOpen(false)

  return (
    <>
      <nav className="site-nav">
        <Link to="/" className="lockup" onClick={close}>
          <MainLogo className="seal" pill quiet alt="" />
          <div>
            <b>BARANGAY E-ASSIST</b>
            <span>Barangay Ilawod</span>
          </div>
        </Link>

        <div className="links">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              {l.label}
            </NavLink>
          ))}
        </div>

        <div className="acts">
          {signedIn ? (
            <Button to={isStaff ? '/admin' : '/app'} size="m" icon="dash">
              My dashboard
            </Button>
          ) : (
            <>
              <Button to="/register" size="m" variant="secondary">
                Create account
              </Button>
              <Button to="/login" size="m" icon="scan">
                Scan to sign in
              </Button>
            </>
          )}
        </div>

        <button
          className="burger"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name={open ? 'x' : 'menu'} />
        </button>
      </nav>

      <div className={`mobile-menu ${open ? 'open' : ''}`.trim()} key={location.pathname}>
        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} onClick={close}>
            {l.label}
          </NavLink>
        ))}
        {signedIn ? (
          <Button to={isStaff ? '/admin' : '/app'} icon="dash" onClick={close}>
            My dashboard
          </Button>
        ) : (
          <>
            <Button to="/login" icon="scan" onClick={close}>
              Scan to sign in
            </Button>
            <Button to="/register" variant="secondary" onClick={close}>
              Create account
            </Button>
          </>
        )}
      </div>
    </>
  )
}

export function SiteFooter() {
  return (
    <footer className="site-foot">
      <div className="cols">
        <div>
          <div className="lockup" style={{ marginBottom: 16 }}>
            <MainLogo className="seal" pill quiet onDark />
            <div>
              <b style={{ color: '#fff' }}>BARANGAY E-ASSIST</b>
              <span style={{ color: 'var(--ink-400)' }}>Barangay Ilawod</span>
            </div>
          </div>
          <p style={{ fontSize: 13.5, maxWidth: '34ch' }}>
            Barangay Hall, Barangay Ilawod. Open Monday to Friday, 8:00 AM – 5:00 PM. Emergency
            hotline available 24 hours.
          </p>
        </div>

        <div>
          <h3>Services</h3>
          <Link to="/services">Barangay Clearance</Link>
          <Link to="/services">Certificate of Residency</Link>
          <Link to="/services">Certificate of Indigency</Link>
          <Link to="/services">Business Clearance</Link>
        </div>

        <div>
          <h3>Report</h3>
          <Link to="/app/blotter">File a blotter report</Link>
          <Link to="/anonymous">Send an anonymous message</Link>
          <Link to="/app/appointments">Book an appointment</Link>
          <Link to="/track">Track a request</Link>
        </div>

        <div>
          <h3>About</h3>
          <Link to="/">Barangay officials</Link>
          <Link to="/map">Barangay map</Link>
          <Link to="/privacy">Privacy notice</Link>
          <Link to="/privacy#biometrics">How face verification works</Link>
        </div>
      </div>

      <div className="fine">
        <span>© {new Date().getFullYear()} Barangay Ilawod. All rights reserved.</span>
        <Link to="/privacy">Privacy notice</Link>
        <Link to="/privacy">Terms of use</Link>
        <Link to="/privacy">Accessibility</Link>
      </div>
    </footer>
  )
}

export default function PublicLayout() {
  return (
    <>
      <PublicNav />
      <Outlet />
      <SiteFooter />
    </>
  )
}
