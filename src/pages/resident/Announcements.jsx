import { Link } from 'react-router-dom'

import { Icon } from '../../components/Icon'
import {
  AnnouncementList as Feed,
  AnnouncementDetail as Notice,
} from '../../components/Announcements'

/**
 * The barangay's notices without leaving the portal.
 *
 * Same queries, same components and the same query keys as the public pages:
 * both render components/Announcements. Only the frame differs -- here the
 * resident keeps their sidebar and top bar, and every link stays under /app.
 */

const BASE = '/app/announcements'

export function ResidentAnnouncementList() {
  return (
    <div className="dash-body">
      <Feed
        basePath={BASE}
        heading={
          <div>
            <span className="eyebrow">Announcements</span>
            <h1 style={{ fontSize: 27, margin: '6px 0 8px' }}>Notices from the barangay</h1>
            <p style={{ fontSize: 14.5, color: 'var(--ink-500)' }}>
              Everything the barangay has posted, newest first.
            </p>
          </div>
        }
      />
    </div>
  )
}

export function ResidentAnnouncementDetail() {
  return (
    <div className="dash-body">
      {/* Two ways out, as on the request detail screen: back to the notices,
          or straight to the dashboard. */}
      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <Link
          to="/app"
          style={{ fontSize: 13.5, color: 'var(--ink-500)', display: 'inline-flex', gap: 6, alignItems: 'center' }}
        >
          <Icon name="chev" size="sm" style={{ transform: 'rotate(180deg)' }} /> Back to the dashboard
        </Link>
      </div>

      <Notice basePath={BASE} backLabel="All announcements" invite={false} />
    </div>
  )
}
