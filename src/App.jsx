import { Navigate, Route, Routes } from 'react-router-dom'

import { IconSprite } from './components/Icon'
import { AuthProvider } from './hooks/useAuth'
import { RedirectIfSignedIn, RequireAuth } from './components/routing/Guards'

import PublicLayout from './components/layout/PublicLayout'
import ResidentLayout from './components/layout/ResidentLayout'

import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import Dashboard from './pages/resident/Dashboard'
import ComponentSheet from './pages/dev/ComponentSheet'

/**
 * Route table.
 *
 * Three groups: the public site, the resident portal at /app, and the admin
 * portal at /admin. The guards here are for usability — the real access
 * control is Row Level Security in Postgres.
 */
export default function App() {
  return (
    <AuthProvider>
      <IconSprite />
      <Routes>
        {/* ---------- public ---------- */}
        <Route element={<PublicLayout />}>
          <Route path="/" element={<Placeholder title="Landing page" phase="6" />} />
          <Route path="/services" element={<Placeholder title="Services" phase="6" />} />
          <Route path="/announcements" element={<Placeholder title="Announcements" phase="6" />} />
          <Route path="/track" element={<Placeholder title="Track a request" phase="4" />} />
          <Route path="/map" element={<Placeholder title="Barangay map" phase="6" />} />
          <Route path="/anonymous" element={<Placeholder title="Anonymous message" phase="4" />} />
          <Route path="/privacy" element={<Placeholder title="Privacy notice" phase="6" />} />
        </Route>

        {/* ---------- auth ---------- */}
        <Route
          path="/login"
          element={
            <RedirectIfSignedIn>
              <Login />
            </RedirectIfSignedIn>
          }
        />
        <Route
          path="/login/face"
          element={
            <RedirectIfSignedIn>
              <Placeholder title="Face sign-in" phase="3" />
            </RedirectIfSignedIn>
          }
        />
        <Route
          path="/register"
          element={
            <RedirectIfSignedIn>
              <Register />
            </RedirectIfSignedIn>
          }
        />

        {/* ---------- resident portal ---------- */}
        <Route
          path="/app"
          element={
            <RequireAuth>
              <ResidentLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="requests" element={<Placeholder title="My requests" phase="4" />} />
          <Route path="requests/new/:code" element={<Placeholder title="New request" phase="4" />} />
          <Route path="requests/:ref" element={<Placeholder title="Request detail" phase="4" />} />
          <Route path="blotter" element={<Placeholder title="Blotter report" phase="4" />} />
          <Route path="appointments" element={<Placeholder title="Appointments" phase="4" />} />
          <Route path="profile" element={<Placeholder title="My profile" phase="4" />} />
          <Route path="enroll" element={<Placeholder title="Face enrollment" phase="3" />} />
        </Route>

        {/* ---------- development reference ---------- */}
        <Route path="/dev/components" element={<ComponentSheet />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}

/** Temporary stand-in for screens that land in a later build phase. */
function Placeholder({ title, phase }) {
  return (
    <div className="dash-body" style={{ minHeight: '50vh' }}>
      <div className="card card-p" style={{ maxWidth: 560 }}>
        <span className="eyebrow">Coming in phase {phase}</span>
        <h1 style={{ fontSize: 26, margin: '12px 0 10px' }}>{title}</h1>
        <p style={{ fontSize: 15, color: 'var(--ink-500)' }}>
          This screen is next in the build queue. The navigation, layout and design system around it
          are already in place.
        </p>
      </div>
    </div>
  )
}
