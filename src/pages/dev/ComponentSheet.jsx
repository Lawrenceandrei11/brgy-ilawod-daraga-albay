import { Badge, Button, Card, Check, Field, Notice, PngSlot, Stepper } from '../../components/ui'
import { EmptyState, ErrorState, LoadingRows } from '../../components/ui/States'
import { Icon } from '../../components/Icon'
import { REQUEST_STATUS } from '../../lib/status'
import { peso, shortDate, shortName } from '../../lib/formatters'

/**
 * Component sheet — the design-system reference, ported from screen 06 of
 * the prototype. It is the fastest way to confirm that every primitive still
 * renders correctly after a token or CSS change.
 *
 * Development only; it is not linked from the product navigation.
 */
export default function ComponentSheet() {
  return (
    <div className="sheet">
      <div>
        <span className="eyebrow">Reference</span>
        <h2 style={{ fontSize: 30, margin: '12px 0 8px' }}>Barangay E-Assist component sheet</h2>
        <p style={{ fontSize: 16, color: 'var(--ink-500)', maxWidth: '72ch' }}>
          Every primitive in the design system, rendered from the same React components the product
          uses. Tokens are mirrored from the Figma collections <b>E-Assist / Color</b> and{' '}
          <b>E-Assist / Scale</b>.
        </p>
      </div>

      <Group
        title="Badge / Status"
        note="Eight request-lifecycle states. Colour never carries the meaning alone — each state keeps its written label, so the badge still works in greyscale and for colour-blind readers."
      >
        <div className="tray">
          {Object.keys(REQUEST_STATUS).map((s) => (
            <Badge key={s} status={s} />
          ))}
          <Badge tone="verified">Identity verified</Badge>
        </div>
      </Group>

      <Group title="Buttons" note="Six variants across three sizes.">
        <div className="tray" style={{ marginBottom: 16 }}>
          <Button auto icon="scan">Verify my identity</Button>
          <Button auto variant="secondary" icon="print">Upload a document</Button>
          <Button auto variant="ghost">Cancel</Button>
          <Button auto variant="accent">Request a document</Button>
          <Button auto variant="danger">Delete request</Button>
        </div>
        <div className="tray" style={{ marginBottom: 16 }}>
          <Button auto size="m">Medium 44px</Button>
          <Button auto size="s" variant="secondary">Small 36px</Button>
          <Button auto disabled>Disabled</Button>
        </div>
        <div className="tray" style={{ background: 'var(--primary-900)', borderColor: 'transparent' }}>
          <Button auto variant="onDark">On a dark surface</Button>
        </div>
      </Group>

      <Group title="Fields" note="Label, control, help text, and the error state that replaces it.">
        <div className="tray" style={{ alignItems: 'flex-start', gap: 24 }}>
          <Field
            label="Full legal name"
            required
            placeholder="Juan Dela Cruz"
            help="As printed on your valid ID"
            style={{ minWidth: 260 }}
          />
          <div style={{ minWidth: 260 }}>
            <Field as="select" label="Purpose of request" help="Local employment, scholarship, bank requirement…">
              <option>Select a purpose</option>
              <option>Local employment</option>
              <option>Scholarship</option>
            </Field>
          </div>
          <Field
            label="Valid ID number"
            required
            defaultValue="1234"
            error="Check the digits and try again"
            style={{ minWidth: 260 }}
          />
        </div>
        <div style={{ marginTop: 20, maxWidth: 520 }}>
          <Check
            title="I consent to Barangay Ilawod enrolling my facial template"
            description="I confirm I have read how it is stored, used and deleted."
          />
        </div>
      </Group>

      <Group title="Notice" note="Privacy notices, consent explanations and inline warnings.">
        <div className="stack" style={{ gap: 14 }}>
          <Notice icon="shield" title="A template, not a photograph">
            Three captures are converted into a numeric template. The photographs are deleted
            immediately, and the template is not an image and cannot be used to reproduce a
            recognisable picture of you by ordinary means.
          </Notice>
          <Notice tone="quiet" icon="lock" title="Used only to confirm it is you">
            Your template is used for signing in and for releasing documents at the barangay hall.
            It is not shared with other agencies and is not used for surveillance.
          </Notice>
          <Notice tone="danger" icon="alert" title="Attempt 2 of 5">
            After five failed attempts, face sign-in locks for 15 minutes and you'll need your
            Resident ID and password. Nothing happens to your account.
          </Notice>
        </div>
      </Group>

      <Group title="Stepper" note="Registration and enrollment progress. Labels hide below 900px.">
        <div style={{ maxWidth: 620 }}>
          <Stepper steps={['Personal details', 'Household & address', 'Review & submit']} current={2} />
        </div>
      </Group>

      <Group title="Cards" note="The three repeating containers behind the dashboard and landing page.">
        <div className="grid-3">
          <article className="svc">
            <PngSlot name="service-clearance.png" className="slot" />
            <h3>Barangay Clearance</h3>
            <p>The standard clearance for employment and permits.</p>
            <div className="go">
              Request this <Icon name="arrow" size="sm" />
              <span className="fee">{peso(50)}</span>
            </div>
          </article>

          <div className="stat">
            <div className="top">
              <Icon name="doc" size="sm" />
              <b>Active requests</b>
            </div>
            <div className="n">3</div>
            <div className="sub">1 needs your action</div>
          </div>

          <Card flush>
            <div className="appt">
              <div className="date">
                <b>10</b>
                <span>Aug</span>
              </div>
              <div className="grow">
                <b style={{ display: 'block', fontSize: 14.5, color: 'var(--ink-900)' }}>
                  Clearance pickup
                </b>
                <span style={{ fontSize: 13, color: 'var(--ink-400)' }}>10:00 AM · window 2</span>
              </div>
            </div>
            <div className="feed-item">
              <PngSlot name="announcement-placeholder.png" className="thumb" />
              <div className="grow">
                <b>Water interruption, Purok 3</b>
                <span>{shortDate('2026-08-11')}</span>
              </div>
            </div>
          </Card>
        </div>
      </Group>

      <Group title="Table" note="Collapses to stacked cards below 900px; each cell carries its own label.">
        <Card flush>
          <table className="tbl">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Document</th>
                <th>Filed</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['ILW-2026-00841', 'Barangay Clearance', '2026-08-06', 'ready'],
                ['ILW-2026-00838', 'Business Clearance', '2026-08-04', 'processing'],
                ['ILW-2026-00830', 'Certificate of Indigency', '2026-08-01', 'rejected'],
                ['ILW-2026-00812', 'Certificate of Residency', '2026-07-22', 'released'],
              ].map(([ref, doc, filed, status]) => (
                <tr key={ref}>
                  <td className="ref" data-label="Reference">{ref}</td>
                  <td className="doc" data-label="Document">{doc}</td>
                  <td className="when" data-label="Filed">{shortDate(filed)}</td>
                  <td data-label="Status"><Badge status={status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </Group>

      <Group title="Empty, loading and error states" note="Every list routes through these three.">
        <div className="grid-3" style={{ alignItems: 'start' }}>
          <Card flush>
            <EmptyState icon="doc" title="No requests yet" action={<Button size="m" auto>Request a document</Button>}>
              When you file a clearance or certificate, it will appear here with its reference number.
            </EmptyState>
          </Card>
          <Card flush>
            <LoadingRows rows={3} />
          </Card>
          <Card flush>
            <ErrorState onRetry={() => {}} />
          </Card>
        </div>
      </Group>

      <Group title="Reference code" note="Shown once after an anonymous message. Not recoverable.">
        <div style={{ maxWidth: 320 }}>
          <div className="refcode">
            <b>ANON-7QK4-2M</b>
            <span>Shown once · not recoverable</span>
          </div>
        </div>
      </Group>

      <Group title="Formatters" note="Shared helpers, so dates and pesos never drift between screens.">
        <div className="tray" style={{ gap: 28, fontSize: 14 }}>
          <div><b>shortDate</b><br />{shortDate('2026-08-06')}</div>
          <div><b>peso</b><br />{peso(50)} · {peso(0)}</div>
          <div><b>shortName</b><br />{shortName('Juan Miguel Dela Cruz')}</div>
        </div>
      </Group>

      <Group title="Icons" note="The full sprite, defined once at the app root.">
        <div className="tray">
          {['scan','shield','lock','doc','home','dash','alert','incognito','cal','search','mega','bell','user','pin','cam','check','x','arrow','chev','menu','clock','brief','heart','users','print','fp','logout','info'].map((n) => (
            <div key={n} style={{ display: 'grid', placeItems: 'center', gap: 6, width: 74 }}>
              <Icon name={n} size="lg" style={{ color: 'var(--primary-700)' }} />
              <span style={{ fontSize: 10.5, color: 'var(--ink-400)' }}>{n}</span>
            </div>
          ))}
        </div>
      </Group>
    </div>
  )
}

function Group({ title, note, children }) {
  return (
    <section className="sheet-grp">
      <h3>{title}</h3>
      {note && <p className="d">{note}</p>}
      {children}
    </section>
  )
}
