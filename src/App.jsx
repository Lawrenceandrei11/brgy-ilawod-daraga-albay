import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { Icon, IconSprite } from './components/Icon'
import { AuthProvider } from './hooks/useAuth'
import { RedirectIfSignedIn, RequireAuth, RequireCaptain, RequireStaff } from './components/routing/Guards'

import PublicLayout from './components/layout/PublicLayout'
import ResidentLayout from './components/layout/ResidentLayout'
import AdminLayout from './components/layout/AdminLayout'

import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import Dashboard from './pages/resident/Dashboard'
import Requests from './pages/resident/Requests'
import NewRequest from './pages/resident/NewRequest'
import RequestDetail from './pages/resident/RequestDetail'
import Blotter from './pages/resident/Blotter'
import Appointments from './pages/resident/Appointments'
import ProfilePage from './pages/resident/Profile'
import ResidentAnonymous from './pages/resident/Anonymous'
import {
  ResidentAnnouncementList,
  ResidentAnnouncementDetail,
} from './pages/resident/Announcements'
import Anonymous from './pages/public/Anonymous'
import Landing from './pages/public/Landing'
import Services from './pages/public/Services'
import { AnnouncementList, AnnouncementDetail } from './pages/public/Announcements'
import BarangayMap from './pages/public/Map'
import Privacy from './pages/public/Privacy'

import AdminDashboard from './pages/admin/Dashboard'
import RequestQueue from './pages/admin/RequestQueue'
import RequestReview from './pages/admin/RequestReview'
import RequestPrint from './pages/admin/RequestPrint'
import Residents from './pages/admin/Residents'
import ResidentReview from './pages/admin/ResidentReview'
import BlotterAdmin from './pages/admin/BlotterAdmin'
import AnonymousInbox from './pages/admin/AnonymousInbox'
import AppointmentsAdmin from './pages/admin/AppointmentsAdmin'
import AnnouncementsAdmin from './pages/admin/Announcements'
import Officials from './pages/admin/Officials'
import Reports from './pages/admin/Reports'
import SmsLog from './pages/admin/SmsLog'
import AdminProfile from './pages/admin/Profile'
import Admins from './pages/admin/Admins'

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
          <Route path="/" element={<Landing />} />
          <Route path="/services" element={<Services />} />
          <Route path="/announcements" element={<AnnouncementList />} />
          <Route path="/announcements/:id" element={<AnnouncementDetail />} />
          <Route path="/map" element={<BarangayMap />} />
          <Route path="/anonymous" element={<Anonymous />} />
          <Route path="/privacy" element={<Privacy />} />
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
          {/* The same anonymous form as /anonymous, inside the portal frame,
              so a signed-in resident keeps their sidebar and top bar. */}
          <Route path="anonymous" element={<ResidentAnonymous />} />
          {/* The same notices as /announcements, inside the portal frame. */}
          <Route path="announcements" element={<ResidentAnnouncementList />} />
          <Route path="announcements/:id" element={<ResidentAnnouncementDetail />} />
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

        {/* ---------- admin portal ---------- */}
        <Route
          path="/admin"
          element={
            <RequireStaff>
              <AdminLayout />
            </RequireStaff>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="requests" element={<RequestQueue />} />
          <Route path="requests/:ref" element={<RequestReview />} />
          <Route path="requests/:ref/print" element={<RequestPrint />} />
          <Route path="residents" element={<Residents />} />
          <Route path="residents/:id" element={<ResidentReview />} />
          <Route path="blotter" element={<BlotterAdmin />} />
          <Route path="anonymous" element={<AnonymousInbox />} />
          <Route path="appointments" element={<AppointmentsAdmin />} />
          <Route path="announcements" element={<AnnouncementsAdmin />} />
          <Route path="notifications" element={<SmsLog />} />
          <Route path="officials" element={<Officials />} />
          <Route path="reports" element={<Reports />} />
          {/* Admin Management is the captain's alone. Every other admin
              screen stays open to the secretary and treasurer. */}
          <Route
            path="admins"
            element={
              <RequireCaptain>
                <Admins />
              </RequireCaptain>
            }
          />
          <Route path="profile" element={<AdminProfile />} />
        </Route>

        {/* ---------- development reference -------------- */}
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
