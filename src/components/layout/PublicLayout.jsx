import { useCallback, useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { Icon } from '../Icon'
import { Button } from '../ui'
import { useAuth } from '../../hooks/useAuth'
import { MainLogo } from '../MainLogo'

/**
 * The four sections of the home page, in the order they appear on it. The nav
 * scrolls to them rather than opening a page of their own; the fuller pages
 * behind /services, /announcements and /map are still there, reached from the
 * footer and from each section's own "see everything" link.
 */
const LINKS = [
  { id: 'home', label: 'Home' },
  { id: 'services', label: 'Services' },
  { id: 'announcements', label: 'Announcements' },
  { id: 'officials', label: 'Officials' },
  { id: 'map', label: 'Barangay map' },
]

// Away from the home page there is nothing to spy on, so the standalone page
// being read is what lights up instead.
const PAGE_SECTION = {
  '/services': 'services',
  '/announcements': 'announcements',
  '/map': 'map',
}

/** How tall the sticky header is right now, at whatever width. */
function headerHeight() {
  return document.querySelector('.site-nav')?.offsetHeight ?? 0
}

export function PublicNav() {
  const [open, setOpen] = useState(false)
  const { signedIn, isStaff } = useAuth()
  const location = useLocation()

  const onHome = location.pathname === '/'
  const [seen, setSeen] = useState('home')
  const active = onHome ? seen : PAGE_SECTION[location.pathname] ?? null

  // Close the mobile sheet whenever the route changes.
  const close = () => setOpen(false)

  // Scrolled by hand rather than by the browser's own anchor jump, so the
  // heading clears the sticky header instead of hiding beneath it.
  const scrollToSection = useCallback((id) => {
    const el = document.getElementById(id)
    if (!el) return
    const top = window.scrollY + el.getBoundingClientRect().top - headerHeight() - 12
    // Someone who has asked their system for less motion gets taken there
    // without the slide, the same exemption the stylesheet makes.
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' })
  }, [])

  // Arriving from another page as /#services.
  useEffect(() => {
    if (!onHome || !location.hash) return
    const id = location.hash.slice(1)
    // A tick, so the section has been laid out before it is measured.
    const t = setTimeout(() => scrollToSection(id), 120)
    return () => clearTimeout(t)
  }, [onHome, location.hash, scrollToSection])

  // Which section is being read: the last one whose top has passed under the
  // header. Recomputed on scroll rather than observed, so it stays right when
  // the sections change height as announcements and services load in.
  useEffect(() => {
    if (!onHome) return

    function update() {
      const line = headerHeight() + 24
      let current = LINKS[0].id
      for (const { id } of LINKS) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= line) current = id
      }
      // The last section is often too short to reach the line; at the foot of
      // the page it is what you are looking at all the same.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        current = LINKS[LINKS.length - 1].id
      }
      setSeen(current)
    }

    // Four rectangle reads, straight from the scroll handler. Cheap enough to
    // need no throttling, and nothing to stall when the tab is in the
    // background or animation frames are not being served.
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [onHome])

  // On the home page this is a scroll, not a navigation. From anywhere else
  // it is an ordinary link to /#section, which the effect above then scrolls.
  function go(e, id) {
    close()
    if (!onHome) return
    e.preventDefault()
    scrollToSection(id)
  }

  return (
    <>
      <nav className="site-nav">
        {/* The seal and the name are one target, and on the home page they do
            what Home does: slide back to the top rather than re-navigating to
            a route already open. Elsewhere it stays an ordinary link home. */}
        <Link
          to="/"
          className="lockup"
          aria-label={
            onHome ? 'Barangay E-Assist — back to the top' : 'Barangay E-Assist — go to the home page'
          }
          onClick={(e) => go(e, 'home')}
        >
          <MainLogo className="seal" pill quiet alt="" />
          <div>
            <b>BARANGAY E-ASSIST</b>
            <span>Barangay Ilawod</span>
          </div>
        </Link>

        <div className="links">
          {LINKS.map((l) => (
            <Link
              key={l.id}
              to={`/#${l.id}`}
              className={active === l.id ? 'active' : ''}
              aria-current={active === l.id ? 'true' : undefined}
              onClick={(e) => go(e, l.id)}
            >
              {l.label}
            </Link>
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
          <Link
            key={l.id}
            to={`/#${l.id}`}
            className={active === l.id ? 'active' : ''}
            aria-current={active === l.id ? 'true' : undefined}
            onClick={(e) => go(e, l.id)}
          >
            {l.label}
          </Link>
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
