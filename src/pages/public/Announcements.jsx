import {
  AnnouncementList as Feed,
  AnnouncementDetail as Notice,
} from '../../components/Announcements'

/**
 * The barangay's notices for anyone with no account: the public pages around
 * the shared list and detail. A signed-in resident reads the same notices
 * without leaving their portal -- see pages/resident/Announcements.jsx.
 */

export function AnnouncementList() {
  return (
    <div className="section">
      <Feed
        heading={
          <div className="section-head">
            <span className="eyebrow">Announcements</span>
            <h1>Notices from the barangay</h1>
            <p>Everything the barangay has posted, newest first.</p>
          </div>
        }
      />
    </div>
  )
}

export function AnnouncementDetail() {
  return (
    <div className="section" style={{ maxWidth: 980 }}>
      <Notice />
    </div>
  )
}
