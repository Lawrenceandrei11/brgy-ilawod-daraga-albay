import { Link } from 'react-router-dom'

import { Icon } from '../../components/Icon'
import { AnonymousMessage } from '../../components/AnonymousMessage'

/**
 * The anonymous channel without leaving the portal.
 *
 * Same form, same rules, same call to the database as the public page: both
 * render components/AnonymousMessage. Only the frame differs -- here the
 * resident keeps their sidebar, top bar and a way back to the dashboard.
 *
 * Being signed in changes nothing about what is sent. No account, session or
 * resident ID travels with the message from this page either; the table has
 * no column that could hold one.
 */
export default function ResidentAnonymous() {
  return (
    <div className="dash-body">
      {/* The same back link the request detail screen uses. */}
      <div>
        <Link
          to="/app"
          style={{ fontSize: 13.5, color: 'var(--ink-500)', display: 'inline-flex', gap: 6, alignItems: 'center' }}
        >
          <Icon name="chev" size="sm" style={{ transform: 'rotate(180deg)' }} /> Back to the dashboard
        </Link>
      </div>

      <AnonymousMessage
        backTo="/app"
        backLabel="Back to the dashboard"
        heading={
          <div>
            <span className="eyebrow">Anonymous message</span>
            <h1 style={{ fontSize: 27, margin: '8px 0 10px' }}>
              Report a concern without giving your name
            </h1>
            <p style={{ fontSize: 14.5, color: 'var(--ink-500)', maxWidth: 620 }}>
              You are signed in, but this message is not linked to your account. Nothing about who
              you are is sent or stored.
            </p>
          </div>
        }
      />
    </div>
  )
}
