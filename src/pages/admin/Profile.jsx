import { Card, CardHeader } from '../../components/ui'
import { ProfilePictureCard } from '../../components/ProfilePictureCard'
import { useAuth } from '../../hooks/useAuth'

const ROLE_LABEL = {
  captain: 'Punong Barangay',
  secretary: 'Barangay Secretary',
  treasurer: 'Barangay Treasurer',
}

/**
 * The Admin portal's own profile page: who you are signed in as, and your
 * profile picture. The same page for the captain, secretary and treasurer.
 * Account details are shown, not edited, here; they belong to the barangay
 * record.
 */
export default function AdminProfile() {
  const { profile, role } = useAuth()

  const rows = [
    ['Name', profile?.full_name],
    ['Position', ROLE_LABEL[role] ?? role],
    ['Email', profile?.email],
  ]

  return (
    <div className="dash-body">
      <div>
        <span className="eyebrow">My profile</span>
        <h1 style={{ fontSize: 27, margin: '8px 0 0' }}>Your account</h1>
      </div>

      <div className="grid-2 split" style={{ gap: 24, alignItems: 'start' }}>
        <ProfilePictureCard placeholder="official-placeholder.png" />

        {/* Laid out like the resident profile's Identity card. */}
        <Card flush>
          <CardHeader title="Signed in as" />
          <div className="stack" style={{ gap: 14, padding: '20px 26px' }}>
            {rows.map(([label, value]) => (
              <div key={label}>
                <div style={{ fontSize: 12, color: 'var(--ink-400)', fontWeight: 600 }}>{label}</div>
                <div style={{ fontSize: 14.5, color: 'var(--ink-800)', overflowWrap: 'anywhere' }}>
                  {value || '—'}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
