import { longDate } from '../lib/formatters'

/**
 * The printable sheet itself.
 *
 * Extracted so the staff print screen and the development preview render the
 * SAME markup. A preview that is a careful copy of the real thing stops being
 * a careful copy the first time someone edits one and not the other, and then
 * it is worse than no preview at all.
 *
 * The logo arrives as a prop rather than being imported, because the real
 * screen reads the barangay's uploaded logo from the database while the
 * preview must not touch the network at all.
 *
 * Renders only. No fetching, no state, no decisions -- documentTemplate.js has
 * already decided what appears.
 */
export function DocumentSheet({ doc, logo = null }) {
  if (!doc) return null

  return (
    <article className="doc">
      <header className="doc-head">
        {logo ?? <div className="doc-seal" aria-hidden="true" />}
        <div>
          <p className="doc-republic">Republic of the Philippines</p>
          <p className="doc-brgy">{doc.barangayName}</p>
          <p className="doc-office">Office of the Punong Barangay</p>
        </div>
      </header>

      <h1 className="doc-title">{doc.title}</h1>

      {/* Printed too, not just on screen: a draft that loses its mark on
          paper is exactly the problem this is guarding against. */}
      <p className="doc-draft">DRAFT — FOR REVIEW ONLY. NOT AN OFFICIAL ISSUANCE.</p>

      {doc.subject && <p className="doc-subject">{doc.subject}</p>}

      <p className="doc-statement">{doc.statement}</p>

      <dl className="doc-facts">
        {doc.facts.map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>

      <div className="doc-sign">
        {/* A line and a name. Never a drawn signature, never a seal -- the
            system holds neither, and inventing one is forgery. */}
        <div className="doc-signline" />
        {doc.signatory ? (
          <>
            <p className="doc-signname">{doc.signatory.name}</p>
            {doc.signatory.position && <p className="doc-signrole">{doc.signatory.position}</p>}
          </>
        ) : (
          <p className="doc-signrole">Punong Barangay</p>
        )}
      </div>

      <footer className="doc-foot">
        {doc.reference.map((f) => (
          <span key={f.label}>
            <b>{f.label}:</b>{' '}
            {/^(Filed on|Released on|Approved on)$/.test(f.label) ? longDate(f.value) : f.value}
          </span>
        ))}
      </footer>
    </article>
  )
}
