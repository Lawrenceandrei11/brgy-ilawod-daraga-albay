import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { Icon, IconSprite } from './components/Icon'
import { AuthProvider } from './hooks/useAuth'
import { RedirectIfSignedIn, RequireAuth } from './components/routing/Guards'

import PublicLayout from './components/layout/PublicLayout'
import ResidentLayout from './components/layout/ResidentLayout'

import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import Dashboard from './pages/resident/Dashboard'
import Requests from './pages/resident/Requests'
import NewRequest from './pages/resident/NewRequest'
import RequestDetail from './pages/resident/RequestDetail'
import Blotter from './pages/resident/Blotter'
import Appointments from './pages/resident/Appointments'
import ProfilePage from './pages/resident/Profile'
import Anonymous from './pages/public/Anonymous'
import Track from './pages/public/Track'
import ComponentSheet from './pages/dev/ComponentSheet'

// face-api carries TensorFlow.js — about 1.5 MB of the bundle. Only the two
// biometric screens need it, so they load on demand. Everyone else, including
// a resident who only came to read an announcement on mobile data, never
// downloads it.
const FaceLogin = lazy(() => import('./pages/auth/FaceLogin'))
const Enroll = lazy(() => import('./pages/auth/Enroll'))

function LoadingScreen({ label = 'Loading…' }) {
  return (
    <div
      style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', color: 'var(--ink-400)' }}
      aria-busy="true"
    >
      <div style={{ textAlign: 'center' }}>
        <Icon name="scan" size="lg" />
        <p style={{ marginTop: 10, fontSize: 14 }}>{label}</p>
      </div>
    </div>
  )
}

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
          <Route path="/track" element={<Track />} />
          <Route path="/map" element={<Placeholder title="Barangay map" phase="6" />} />
          <Route path="/anonymous" element={<Anonymous />} />
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
              <Suspense fallback={<LoadingScreen label="Loading face recognition…" />}>
                <FaceLogin />
              </Suspense>
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
          <Route path="requests" element={<Requests />} />
          <Route path="requests/new/:code" element={<NewRequest />} />
          <Route path="requests/:ref" element={<RequestDetail />} />
          <Route path="blotter" element={<Blotter />} />
          <Route path="appointments" element={<Appointments />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route
            path="enroll"
            element={
              <Suspense fallback={<LoadingScreen label="Loading face recognition…" />}>
                <Enroll />
              </Suspense>
            }
          />
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
