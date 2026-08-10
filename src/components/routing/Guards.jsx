import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { Icon } from '../Icon'

/**
 * Route guards.
 *
 * These are a convenience, not the security boundary. The real enforcement is
 * Row Level Security in Postgres: a resident who edits the URL to reach an
 * admin screen sees an empty table, because the database refuses to return
 * anyone else's rows. The guards just avoid showing a page that would be
 * blank and confusing.
 */

function Checking() {
  return (
    <div
      style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', color: 'var(--ink-400)' }}
      aria-busy="true"
    >
      <div style={{ textAlign: 'center' }}>
        <Icon name="shield" size="lg" />
        <p style={{ marginTop: 10, fontSize: 14 }}>Checking your sign-in…</p>
      </div>
    </div>
  )
}

/** Requires a signed-in user of any status. */
export function RequireAuth({ children }) {
  const { loading, signedIn } = useAuth()
  const location = useLocation()

  if (loading) return <Checking />
  if (!signedIn) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  return children
}

/** Requires barangay staff. */
export function RequireStaff({ children }) {
  const { loading, signedIn, isStaff } = useAuth()
  const location = useLocation()

  if (loading) return <Checking />
  if (!signedIn) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  if (!isStaff) return <Navigate to="/app" replace />
  return children
}

/** Requires the barangay captain specifically (settings, sensitive reports). */
export function RequireCaptain({ children }) {
  const { loading, signedIn, isCaptain } = useAuth()

  if (loading) return <Checking />
  if (!signedIn) return <Navigate to="/login" replace />
  if (!isCaptain) return <Navigate to="/admin" replace />
  return children
}

/** Keeps signed-in users away from the login and registration pages. */
export function RedirectIfSignedIn({ children }) {
  const { loading, signedIn, isStaff } = useAuth()

  if (loading) return <Checking />
  if (signedIn) return <Navigate to={isStaff ? '/admin' : '/app'} replace />
  return children
}
