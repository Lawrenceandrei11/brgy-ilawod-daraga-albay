import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '../../lib/supabase'
import { Button, Card, Notice, PngSlot } from '../../components/ui'
import { Icon } from '../../components/Icon'

/**
 * The barangay map.
 *
 * This is the prototype's stylised purok canvas rather than a real basemap.
 * Barangay Ilawod's actual purok boundaries are not published as open data,
 * so a real map would need the barangay's own survey — which is noted on the
 * page rather than faked with plausible-looking coordinates.
 */
const PLACES = [
  { key: 'hall', label: 'Barangay Hall', kind: 'Office', left: '34%', top: '38%', note: 'Requests, clearances and the secretary’s desk' },
  { key: 'health', label: 'Health Centre', kind: 'Health', left: '62%', top: '30%', note: 'Immunisation, prenatal and first aid' },
  { key: 'court', label: 'Covered Court', kind: 'Evacuation', left: '48%', top: '72%', note: 'Primary evacuation point' },
  { key: 'school', label: 'Elementary School', kind: 'Evacuation', left: '78%', top: '60%', note: 'Secondary evacuation point' },
]

export default function BarangayMap() {
  const [active, setActive] = useState(PLACES[0])

  const { data: puroks } = useQuery({
    queryKey: ['purok-counts'],
    queryFn: async () => {
      // Public aggregate: how many approved residents sit in each purok.
      // RLS hides the rows themselves, so this only works for staff — for
      // the public we simply show the seven puroks without counts.
      const { data, error } = await supabase.from('settings').select('value').eq('key', 'barangay').maybeSingle()
      if (error) return null
      return data?.value ?? null
    },
  })

  const purokCount = puroks?.puroks ?? 7

  return (
    <div className="section">
      <div className="section-head">
        <span className="eyebrow">Barangay map</span>
        <h2>Barangay Ilawod at a glance</h2>
        <p>
          Find the hall, the health centre and the evacuation points, and check which purok your
          household belongs to before you file a request.
        </p>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: '1.4fr .8fr', gap: 28, alignItems: 'start' }}>
        <Card padded>
          <div className="map-canvas" style={{ aspectRatio: '16 / 11' }}>
            <div className="river" />
            {PLACES.map((p) => (
              <button
                key={p.key}
                onClick={() => setActive(p)}
                aria-label={p.label}
                aria-pressed={active.key === p.key}
                style={{
                  position: 'absolute',
                  left: p.left,
                  top: p.top,
                  transform: 'translate(-50%, -100%)',
                  display: 'grid',
                  placeItems: 'center',
                  gap: 4,
                }}
              >
                <PngSlot
                  name="map-marker.png"
                  className="pin"
                  style={{
                    position: 'static',
                    transform: 'none',
                    width: active.key === p.key ? 44 : 34,
                    height: active.key === p.key ? 44 : 34,
                    transition: 'width .18s, height .18s',
                  }}
                />
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: active.key === p.key ? 'var(--primary-800)' : 'var(--ink-500)',
                    background: 'rgba(255,255,255,.85)',
                    padding: '2px 7px',
                    borderRadius: 'var(--r-pill)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.label}
                </span>
              </button>
            ))}
          </div>

          <div className="map-legend" style={{ marginTop: 22 }}>
            <div>
              <b style={{ background: 'var(--primary-700)' }} /> Barangay hall &amp; health centre
            </div>
            <div>
              <b style={{ background: 'var(--accent-500)' }} /> Purok boundaries (1–{purokCount})
            </div>
            <div>
              <b style={{ background: 'var(--success-500)' }} /> Evacuation points
            </div>
          </div>
        </Card>

        <aside className="stack" style={{ gap: 20 }}>
          <Card padded>
            <span className="eyebrow">{active.kind}</span>
            <h3 style={{ fontSize: 20, margin: '10px 0 8px' }}>{active.label}</h3>
            <p style={{ fontSize: 14.5, color: 'var(--ink-500)', marginBottom: 16 }}>{active.note}</p>
            <div className="stack" style={{ gap: 10 }}>
              <div className="row" style={{ gap: 10 }}>
                <Icon name="clock" size="sm" style={{ color: 'var(--primary-600)' }} />
                <span style={{ fontSize: 13.5, color: 'var(--ink-600)' }}>
                  Monday to Friday, 8:00 AM – 5:00 PM
                </span>
              </div>
              <div className="row" style={{ gap: 10 }}>
                <Icon name="pin" size="sm" style={{ color: 'var(--primary-600)' }} />
                <span style={{ fontSize: 13.5, color: 'var(--ink-600)' }}>Barangay Ilawod</span>
              </div>
            </div>
          </Card>

          <Card padded>
            <h3 style={{ fontSize: 16.5, marginBottom: 12 }}>Which purok am I in?</h3>
            <p style={{ fontSize: 14, color: 'var(--ink-500)', marginBottom: 16 }}>
              Barangay Ilawod has {purokCount} puroks. If a utility bill or an older barangay
              document does not say, the secretary can confirm it from the household record.
            </p>
            <Button to="/register" size="s" variant="secondary" block>
              Register and have it confirmed
            </Button>
          </Card>

          <Notice icon="info" title="About this map">
            This is a schematic, not a survey. Barangay Ilawod's purok boundaries are not published
            as open data, so the outlines here are indicative — the barangay's own record is what
            decides which purok a household belongs to.
          </Notice>
        </aside>
      </div>
    </div>
  )
}
