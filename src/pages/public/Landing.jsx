import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '../../lib/supabase'
import { Button, Card, PngSlot } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { longDate, pesoShort, turnaround } from '../../lib/formatters'
import { publicPhotoUrl } from '../../lib/storage'
import { MapPreview } from '../../components/MapPreview'
import { OfficialsCarousel } from '../../components/OfficialsCarousel'
import { LEGEND as MAP_LEGEND } from './Map'

/**
 * The public landing page, ported from the prototype.
 *
 * Services, announcements and officials all come from the database, so the
 * barangay changes what the public sees by using the admin portal — not by
 * asking someone to edit the site.
 *
 * The hero scanner here is decorative. It deliberately does NOT load
 * face-api: a visitor reading an announcement should not download 1.3 MB of
 * TensorFlow. The real thing lives behind /login/face.
 */
export default function Landing() {
  const { data: services } = useQuery({
    queryKey: ['services'],
    queryFn: async () => {
      const { data, error } = await supabase.from('services').select('*').order('sort_order')
      if (error) throw error
      return data
    },
  })

  const { data: announcements } = useQuery({
    queryKey: ['announcements', 'landing'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('announcements')
        .select('id, title, excerpt, category, published_at, cover_path')
        .not('published_at', 'is', null)
        .order('published_at', { ascending: false })
        .limit(3)
      if (error) throw error
      return data
    },
  })

  const { data: officials } = useQuery({
    queryKey: ['officials'],
    queryFn: async () => {
      const { data, error } = await supabase.from('officials').select('*').eq('active', true).order('sort_order')
      if (error) throw error
      return data
    },
  })

  return (
    <>
      {/* ---------------- hero ---------------- */}
      <header className="hero on-dark" id="home">
        <div className="hero-in">
          <div>
            <span className="eyebrow-pill">Barangay E-Assist · Barangay Ilawod, Daraga, Albay</span>
            <h1>
              Barangay services,
              <br />
              settled by <em>your face</em>.
            </h1>
            <p className="lede">
              Barangay E-Assist is Barangay Ilawod's online service desk. Request clearances and
              certificates, file a blotter report, book an appointment or send an anonymous concern
              — signed in by facial verification, with no password to lose and no queue to stand in.
            </p>
            <div className="ctas">
              <Button to="/login/face" icon="scan">
                Scan to sign in
              </Button>
              <Button to="/register" variant="onDark">
                Register as a resident
              </Button>
            </div>
            <div className="trust">
              <div>
                <Icon name="shield" size="sm" /> A template, never a stored photo
              </div>
              <div>
                <Icon name="lock" size="sm" /> Data Privacy Act of 2012 compliant
              </div>
              <div>
                <Icon name="clock" size="sm" /> Requests tracked end to end
              </div>
            </div>
          </div>

          <div>
            <DecorativeScanner />
          </div>
        </div>
      </header>

      {/* ---------------- services ---------------- */}
      <section className="section" id="services">
        <div className="section-head">
          <span className="eyebrow">Barangay services</span>
          <h2>Six services, one verified identity</h2>
          <p>
            Fill in a request once. Your barangay record supplies the rest, and the secretary sees
            a complete, legible application instead of a half-filled form.
          </p>
        </div>

        <div className="services">
          {(services ?? []).map((s) => (
            <Link
              key={s.code}
              to={
                s.code === 'anonymous'
                  ? '/anonymous'
                  : s.code === 'blotter'
                    ? '/app/blotter'
                    : `/services#${s.code}`
              }
              className={`svc ${s.code === 'anonymous' ? 'featured' : ''}`.trim()}
            >
              <PngSlot name={s.icon} className="slot" />
              <h3>{s.name}</h3>
              <p>{s.description}</p>
              <div className="go">
                {s.kind === 'anonymous'
                  ? 'Send anonymously'
                  : s.kind === 'report'
                    ? 'File a report'
                    : 'Request this'}
                <Icon name="arrow" size="sm" />
                <span className="fee">
                  {s.kind === 'anonymous'
                    ? 'No account'
                    : `${pesoShort(s.fee)} · ${turnaround(s.processing_days)}`}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ---------------- how it works ---------------- */}
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="section-head">
          <span className="eyebrow">How it works</span>
          <h2>Enroll once, then just look at the camera</h2>
        </div>
        <div className="steps">
          <div className="step">
            <div className="num">STEP 01</div>
            <h3>Register your household</h3>
            <p>
              Give your name, address and household details once. The barangay secretary verifies
              them against the resident record.
            </p>
          </div>
          <div className="step">
            <div className="num">STEP 02</div>
            <h3>Enroll your face</h3>
            <p>
              Three quick captures build a mathematical template. The photographs are discarded —
              only the template is kept, and it is not a picture of you.
            </p>
          </div>
          <div className="step">
            <div className="num">STEP 03</div>
            <h3>Sign in and transact</h3>
            <p>
              Look at the camera to sign in. Request documents, book appointments, and follow every
              request from filed to released.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------- announcements ---------------- */}
      <section className="section" style={{ paddingTop: 0 }} id="announcements">
        <div className="section-head">
          <span className="eyebrow">Announcements</span>
          <h2>What's happening in Ilawod</h2>
        </div>
        <div className="ann-grid">
          {(announcements ?? []).map((a) => (
            <article className="ann" key={a.id}>
              <PngSlot name="announcement-placeholder.png" src={publicPhotoUrl(a.cover_path)} className="cover" />
              <div className="body">
                <span className="date">{longDate(a.published_at)}</span>
                <h3>{a.title}</h3>
                <p>{a.excerpt}</p>
                <Link to={`/announcements/${a.id}`} style={{ fontSize: 14, fontWeight: 600 }}>
                  Read the notice →
                </Link>
              </div>
            </article>
          ))}
        </div>
        {announcements?.length === 0 && (
          <Card padded style={{ textAlign: 'center', color: 'var(--ink-400)' }}>
            No notices have been posted yet.
          </Card>
        )}
      </section>

      {/* ---------------- officials ---------------- */}
      <section className="section" style={{ paddingTop: 0 }} id="officials">
        <div className="section-head">
          <span className="eyebrow">Your barangay council</span>
          <h2>Who you are dealing with</h2>
          <p>Every request is handled by a named official, and you can see who has it.</p>
        </div>
        <OfficialsCarousel officials={officials ?? []} />
      </section>

      {/* ---------------- map ---------------- */}
      <section className="section" style={{ paddingTop: 0 }} id="map">
        <div className="map-band">
          <div>
            <span className="eyebrow">Barangay map</span>
            <h2 style={{ fontSize: 28, margin: '12px 0' }}>Explore Barangay Ilawod</h2>
            <p style={{ fontSize: 15.5, color: 'var(--ink-500)' }}>
              Find important barangay locations, facilities, and evacuation points in one place.
            </p>
            {/* The full map's own legend, so the colours match its markers. */}
            <div className="map-legend">
              {MAP_LEGEND.map((l) => (
                <div key={l.kind}>
                  <b className={`imap-dot-${l.kind}`} /> {l.label}
                </div>
              ))}
            </div>
            <Button to="/map" size="m" auto icon="pin" style={{ marginTop: 22 }}>
              Open the full map
            </Button>
          </div>
          <MapPreview />
        </div>
      </section>

      {/* ---------------- call to action ---------------- */}
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="cta-band">
          <div>
            <h2>Not enrolled yet?</h2>
            <p style={{ fontSize: 16 }}>
              Registration takes about five minutes, and you can enroll your face at the barangay
              hall or from your own phone.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Button to="/register" variant="accent">
              Register as a resident
            </Button>
            <Button to="/login/face" variant="onDark">
              Enroll my face
            </Button>
          </div>
        </div>
      </section>
    </>
  )
}

/**
 * The hero scanner, for looks only.
 *
 * It reuses the scanner's CSS so the marketing page and the real thing stay
 * visually identical, but it holds no camera and imports no face-api — the
 * animation is pure CSS. A visitor who only came to read a notice should not
 * pay 1.3 MB for a decoration.
 */
const MESH = [
  [50, 14], [26, 26], [74, 26], [18, 44], [82, 44], [50, 40], [36, 52], [64, 52],
  [24, 64], [76, 64], [50, 68], [38, 80], [62, 80], [50, 88], [30, 38], [70, 38],
]

function DecorativeScanner() {
  return (
    <div className="scanner" data-state="scanning" aria-hidden="true">
      <div className="grid-bg" />
      <div className="cam-label">
        <span className="live" /> Camera live
      </div>
      <PngSlot name="biometric-face.png" className="face-slot" onDark quiet />
      <div className="mesh">
        {MESH.map(([left, top], i) => (
          <span
            key={`${left}-${top}`}
            style={{ left: `${left}%`, top: `${top}%`, animation: 'meshIn .5s ease both', animationDelay: `${i * 28}ms` }}
          />
        ))}
      </div>
      <div className="guide" />
      <div className="brackets">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="scanline" />
      <div className="caption">
        <b>Align your face inside the outline</b>
        <span>Verification takes about two seconds</span>
      </div>
    </div>
  )
}
