import { AnonymousMessage } from '../../components/AnonymousMessage'

/**
 * The anonymous channel for anyone with no account: the public page around
 * the shared form. A signed-in resident reaches the same form without leaving
 * their dashboard -- see pages/resident/Anonymous.jsx.
 */
export default function Anonymous() {
  return (
    <div className="section">
      <AnonymousMessage
        heading={
          <div className="section-head">
            <span className="eyebrow">Anonymous message</span>
            <h1>Report a concern without giving your name</h1>
            <p>
              No sign-in, no contact details, no account. Use this when putting your name to
              something would put you at risk.
            </p>
          </div>
        }
      />
    </div>
  )
}
