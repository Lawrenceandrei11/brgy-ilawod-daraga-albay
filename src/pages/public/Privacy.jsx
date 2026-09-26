import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { Card, Notice } from '../../components/ui'
import { Icon } from '../../components/Icon'

/**
 * The privacy notice.
 *
 * Written to describe what this system actually does, not what a template
 * says a privacy notice should say. Every claim here is one the code and the
 * schema can be checked against — including the ones that are unflattering.
 */
export default function Privacy() {
  const location = useLocation()

  useEffect(() => {
    if (!location.hash) return
    const el = document.getElementById(location.hash.slice(1))
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [location.hash])

  return (
    <div className="section" style={{ maxWidth: 940 }}>
      <div className="section-head">
        <span className="eyebrow">Privacy notice</span>
        <h1>What Barangay Ilawod holds about you, and why</h1>
        <p>
          Barangay Ilawod is the data controller for this system, under Republic Act 10173, the
          Data Privacy Act of 2012.
        </p>
      </div>

      <div className="stack" style={{ gap: 24 }}>
        <Section id="what" title="What we collect">
          <p>When you register we ask for:</p>
          <List
            items={[
              'Your full legal name, date of birth and sex, as they appear on a valid ID',
              'Your mobile number and email address, so we can reach you about a request',
              'Your address, purok, length of residency and household details',
              'The type and number of one valid government ID, and a photograph of it',
            ]}
          />
          <p>
            When you use the system we also keep the requests you file, the blotter reports you
            make, the appointments you book, and a record of when your account signs in.
          </p>
        </Section>

        <Section id="biometrics" title="How face verification works">
          <p>
            If you choose to enroll, your camera takes three captures. Each is converted, in your
            own browser, into a list of 128 numbers — a <b>template</b>. The images themselves are
            never uploaded, never written to disk, and are discarded as the next frame replaces
            them. Only the numbers are sent to the barangay.
          </p>

          <Notice icon="shield" title="What a template is, stated carefully">
            A template is not a photograph, and it cannot be used to reproduce a recognisable
            picture of you by ordinary means. We do not claim it is mathematically impossible to
            derive anything from it — published research has partially reconstructed faces from
            embeddings of this kind. We claim that it is not an image, that we cannot turn it back
            into one, and that we hold it under the safeguards below.
          </Notice>

          <p>
            When you sign in with your face, the comparison happens on the barangay's server, not
            in your browser. This matters: the alternative would mean sending every enrolled
            resident's template to anyone who opened the sign-in page.
          </p>

          <p>
            Your template can be read only by the matching service. It is not readable by barangay
            staff, not readable by you, and not returned by the public interface to anyone — a
            direct request for it is refused.
          </p>

          <Notice tone="danger" icon="alert" title="An honest limitation">
            Face verification confirms that a face matches an enrolled template. It does not prove
            that the person is physically present. A steady printed photograph can defeat it. That
            is why collecting a document at the barangay hall still requires the secretary to check
            you in person, and why face sign-in is never the only thing standing between someone
            and your record.
          </Notice>
        </Section>

        <Section id="why" title="Why we hold it">
          <List
            items={[
              'To confirm you are a resident of Barangay Ilawod before issuing a document in your name',
              'To process, track and release the requests you file',
              'To keep the official barangay record that a clearance, certificate or blotter entry requires by law',
              'To let you sign in — by password, or by face if you chose to enroll',
            ]}
          />
          <p>
            We do not use any of it for advertising, we do not sell it, and we do not share it with
            other agencies except where a law or a lawful order requires it.
          </p>
        </Section>

        <Section id="anonymous" title="The anonymous channel">
          <p>
            The anonymous message form is the one part of this system with no identity attached.
            There is no name, Resident ID, email or phone field on it — and no such column exists
            on the table behind it. Nor do we record your IP address, your device, or your browser.
          </p>
          <p>
            That is a property of how the system is built, not a promise about how we behave. It
            also has a consequence worth being plain about: <b>we cannot retrieve your message for
            you</b>, and we cannot reply unless you chose to leave a contact detail. The reference
            code shown once when you submit is the only handle that exists.
          </p>
        </Section>

        <Section id="rights" title="Your rights">
          <p>Under the Data Privacy Act you may:</p>
          <List
            items={[
              'Be told what we hold about you, and ask for a copy',
              'Have anything inaccurate corrected',
              'Object to how it is being processed',
              'Ask for it to be erased or blocked, where the law does not require us to keep it',
              'Complain to the National Privacy Commission',
            ]}
          />
          <p>
            Your facial template is the one item you can delete yourself, at any time, from{' '}
            <Link to="/app/profile" style={{ fontWeight: 600 }}>
              your profile page
            </Link>
            . It is erased immediately and you can enroll again later if you want to.
          </p>
          <p>
            Barangay records — a released clearance, a blotter entry — generally cannot be deleted
            on request, because they are official records the barangay is required to keep.
          </p>
        </Section>

        <Section id="safeguards" title="How it is protected">
          <List
            items={[
              'Every table is protected at the database level, not by hiding buttons: a resident cannot read another resident’s requests even by calling the interface directly',
              'Photographs of IDs are kept in private storage, reachable only by you and barangay staff, through links that expire',
              'Facial templates have no read access for any client at all',
              'Face sign-in locks for a period after five failed attempts, and every attempt is logged',
              'Residents cannot change their own role, status, Resident ID, or the fee on their own request',
            ]}
          />
        </Section>

        <Section id="contact" title="Who to ask">
          <p>
            Visit the barangay hall Monday to Friday, 8:00 AM – 5:00 PM and ask for the Barangay
            Secretary, who acts as the barangay's data protection contact. Bring a valid ID so we
            can be sure we are speaking to the right person before discussing your record.
          </p>
        </Section>

        <Card padded style={{ background: 'var(--ink-50)' }}>
          <div className="row" style={{ gap: 10, marginBottom: 8 }}>
            <Icon name="info" size="sm" style={{ color: 'var(--ink-400)' }} />
            <b style={{ fontSize: 14, color: 'var(--ink-700)' }}>About this notice</b>
          </div>
          <p style={{ fontSize: 13.5, color: 'var(--ink-500)' }}>
            This describes the system as built. It is written for a barangay audience rather than a
            legal one, and it should be reviewed by the barangay council — and, where the barangay
            has access to one, a data protection officer — before the system carries real resident
            data.
          </p>
        </Card>
      </div>
    </div>
  )
}

function Section({ id, title, children }) {
  return (
    <Card padded id={id} style={{ scrollMarginTop: 90 }}>
      <h2 style={{ fontSize: 21, marginBottom: 14 }}>{title}</h2>
      <div className="stack" style={{ gap: 14, fontSize: 15.5, lineHeight: 1.7, color: 'var(--ink-600)' }}>
        {children}
      </div>
    </Card>
  )
}

function List({ items }) {
  return (
    <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
      {items.map((t) => (
        <li key={t} style={{ display: 'flex', gap: 11, alignItems: 'flex-start', marginBottom: 10 }}>
          <Icon name="check" size="sm" style={{ color: 'var(--success-500)', marginTop: 5, flex: 'none' }} />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  )
}
