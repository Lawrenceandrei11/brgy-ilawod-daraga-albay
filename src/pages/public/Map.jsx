import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '../../lib/supabase'
import { useMainLogo } from '../../lib/branding'
import { Button, Card, Notice } from '../../components/ui'
import { Icon } from '../../components/Icon'

/**
 * The barangay map: OpenStreetMap and Esri satellite imagery through Leaflet.
 *
 * Only places with a confirmed position get a pin. The Ilawod marker is
 * OpenStreetMap's own point for the area (node 5345040716). The hall, health
 * centre and evacuation points are not on OpenStreetMap -- the nearby entries
 * there are Daraga's municipal buildings -- so their coordinates are the ones
 * the barangay supplied. A wrong pin on an evacuation point is worse than none.
 *
 * Leaflet is loaded only when this page opens, so it adds nothing to the
 * download for anyone who never visits the map.
 */

// The Barangay Hall, as supplied by the barangay. The Ilawod logo pin, the
// hall and the health centre all stand on this one point, and the map opens
// and returns ("Back to Barangay Ilawod") here.
const HALL = [13.147336671465483, 123.71653936874432]
const ILAWOD = HALL
export const HOME_ZOOM = 16

// position: [latitude, longitude], as supplied by the barangay. A place with
// position: null is listed but not pinned. The hall and the health centre
// share a building, hence the same point.
export const PLACES = [
  {
    key: 'ilawod',
    label: 'Barangay Ilawod',
    kind: 'Barangay',
    note: 'Ilawod, Poblacion, Daraga, Albay. The logo pin points to the Barangay Hall.',
    position: ILAWOD,
  },
  {
    key: 'hall',
    label: 'Barangay Hall',
    kind: 'Office',
    note: 'Requests, clearances and the secretary’s desk',
    position: HALL,
  },
  {
    key: 'health',
    label: 'Health Centre',
    kind: 'Health',
    note: 'Immunisation, prenatal and first aid',
    position: [13.147336671465483, 123.71653936874432],
  },
  {
    key: 'court',
    label: 'Covered Court',
    kind: 'Evacuation',
    note: 'Primary evacuation point',
    position: [13.14887656677177, 123.71336186085507],
  },
  {
    key: 'school',
    label: 'Elementary School',
    kind: 'Evacuation',
    note: 'Secondary evacuation point',
    position: [13.144228283415217, 123.7163976687443],
  },
]

// Dots on exactly the same point would hide each other. Each keeps its true
// position -- directions stay exact -- and is only drawn nudged sideways, so
// every one can be seen and clicked. { key: pixel offset }
//
// The Ilawod logo is left out: it is a pin standing *above* its point with
// its tip on the coordinate, so it never covers the dots and is never nudged.
const SPREAD_PX = 14
const MARKER_OFFSETS = (() => {
  const groups = {}
  for (const p of PLACES) {
    if (p.position && p.key !== 'ilawod') (groups[p.position.join(',')] ??= []).push(p.key)
  }
  const offsets = {}
  for (const keys of Object.values(groups)) {
    keys.forEach((key, i) => {
      offsets[key] = (i - (keys.length - 1) / 2) * SPREAD_PX * 2
    })
  }
  return offsets
})()

export const LEGEND = [
  { kind: 'office', label: 'Barangay Hall' },
  { kind: 'health', label: 'Health Centre' },
  { kind: 'evacuation', label: 'Evacuation points' },
]

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
const ESRI_ATTRIBUTION = 'Imagery &copy; Esri, Maxar, Earthstar Geographics'

export const TILES = {
  map: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 19, attribution: OSM_ATTRIBUTION },
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    // Imagery outside cities often stops at 18; beyond that, scale it up
    // rather than show "map data not yet available" tiles.
    options: { maxZoom: 19, maxNativeZoom: 18, attribution: ESRI_ATTRIBUTION },
  },
  // Place names and roads over the satellite view, as in most map apps.
  labels: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 19, maxNativeZoom: 18 },
  },
}

const directionsUrl = ([lat, lng]) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
const largerMapUrl = ([lat, lng]) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`

/**
 * OpenStreetMap's own geocoder. Its usage policy allows searches a person
 * submits but not search-as-you-type, so this runs on Enter only. Results are
 * biased towards Daraga and limited to the Philippines.
 */
async function geocode(q) {
  const params = new URLSearchParams({
    q,
    format: 'jsonv2',
    limit: '5',
    countrycodes: 'ph',
    viewbox: '123.62,13.22,123.80,13.08',
    'accept-language': 'en',
  })
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`)
  if (!res.ok) throw new Error(`Search failed (${res.status})`)
  const rows = await res.json()
  return rows.map((r) => ({
    id: `osm-${r.osm_type}-${r.osm_id}`,
    label: r.name || r.display_name.split(',')[0],
    detail: r.display_name,
    position: [Number(r.lat), Number(r.lon)],
  }))
}

// Built with textContent, never innerHTML: search results are other people's
// data, and a place name must not be able to inject markup into the page.
function popupContent(title, text) {
  const el = document.createElement('div')
  const b = document.createElement('b')
  b.textContent = title
  el.append(b)
  if (text) {
    const p = document.createElement('p')
    p.className = 'imap-popup-note'
    p.textContent = text
    el.append(p)
  }
  return el
}

// The logo pin's size. Must match .imap-pin in components.css: a 36px disc
// plus a 14px pointer = 50px tall, tip at the bottom centre.
const PIN_W = 40
const PIN_H = 50

// Only compile-time constants go into these HTML strings, with one exception:
// the logo's address, which is quote-escaped below before it is written into
// the img tag.
export function placeIcon(L, place, logoUrl) {
  if (place.key === 'ilawod') {
    // A 40x50 pin: the logo disc on top, a pointer below whose tip is the
    // bottom-centre pixel (20, 50). iconAnchor puts that tip on the
    // coordinate, and Leaflet keeps it there through every zoom and pan. The
    // numbers are the icon's own geometry (see .imap-pin), not a screen offset.
    return L.divIcon({
      className: 'imap-marker imap-marker-pin',
      html:
        '<span class="imap-halo"></span><span class="imap-pin"><img src="' +
        String(logoUrl || '/assets/barangay-logo.png').replace(/"/g, '&quot;') +
        '" alt=""></span>',
      iconSize: [PIN_W, PIN_H],
      iconAnchor: [PIN_W / 2, PIN_H],
      popupAnchor: [0, -PIN_H],
    })
  }
  // A positive offset draws the dot to the right of its true point: the anchor
  // (the pixel that sits on the coordinate) moves left by the same amount.
  const dx = MARKER_OFFSETS[place.key] ?? 0
  return L.divIcon({
    className: 'imap-marker',
    html: `<span class="imap-dot imap-dot-${place.kind.toLowerCase()}"></span>`,
    iconSize: [22, 22],
    iconAnchor: [11 - dx, 11],
    // Relative to that same coordinate, so point the popup at the drawn dot.
    popupAnchor: [dx, -12],
  })
}

function foundIcon(L) {
  return L.divIcon({
    className: 'imap-marker',
    html: '<span class="imap-dot imap-dot-found"></span>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -12],
  })
}

export default function BarangayMap() {
  // The logo as known when the map is built; a change shows on next load.
  const logo = useMainLogo()
  const [active, setActive] = useState(PLACES[0])
  const [view, setView] = useState('map')
  const [ready, setReady] = useState(false)
  const [mapError, setMapError] = useState(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null) // null = dropdown closed
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)

  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState(null)

  const containerRef = useRef(null)
  const searchRef = useRef(null)
  const searchSeq = useRef(0)
  // { L, map, base, markers, found, me } once Leaflet has loaded.
  const mapRef = useRef(null)

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

  useEffect(() => {
    let cancelled = false
    let map
    let resizeObserver

    ;(async () => {
      try {
        const [{ default: L }] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')])
        if (cancelled || !containerRef.current) return

        map = L.map(containerRef.current, {
          center: ILAWOD,
          zoom: HOME_ZOOM,
          maxZoom: 19,
          // Wheel zoom only once someone has clicked into the map, so
          // scrolling down the page does not get caught zooming it instead.
          scrollWheelZoom: false,
        })
        map.on('click focus', () => map.scrollWheelZoom.enable())
        map.on('mouseout blur', () => map.scrollWheelZoom.disable())

        const base = {
          map: L.tileLayer(TILES.map.url, TILES.map.options),
          satellite: L.layerGroup([
            L.tileLayer(TILES.satellite.url, TILES.satellite.options),
            L.tileLayer(TILES.labels.url, TILES.labels.options),
          ]),
        }
        base.map.addTo(map)

        const markers = {}
        for (const place of PLACES) {
          if (!place.position) continue
          const isPin = place.key === 'ilawod'
          markers[place.key] = L.marker(place.position, {
            icon: placeIcon(L, place, logo.url),
            title: place.label,
            // Beneath the dots, so its halo never covers them or their clicks.
            zIndexOffset: isPin ? -1000 : 0,
          })
            .addTo(map)
            .bindPopup(popupContent(place.label, place.note))
            .bindTooltip(place.label, {
              direction: 'top',
              offset: isPin ? [0, -PIN_H] : [MARKER_OFFSETS[place.key] ?? 0, -12],
            })
            .on('click', () => setActive(place))
        }

        // Leaflet measures its box once, and only re-measures on window
        // resize. The box also changes when the page finishes laying out or a
        // phone rotates, which otherwise leaves tiles in a strip down the
        // middle, so watch the box itself.
        resizeObserver = new ResizeObserver(() => map.invalidateSize())
        resizeObserver.observe(containerRef.current)

        mapRef.current = { L, map, base, markers, found: null, me: null }
        setReady(true)
      } catch {
        if (!cancelled) setMapError('The map could not be loaded. Check your connection and refresh the page.')
      }
    })()

    return () => {
      cancelled = true
      resizeObserver?.disconnect()
      map?.remove()
      mapRef.current = null
    }
  }, [])

  // Swap the base layer when the Map / Satellite toggle changes.
  useEffect(() => {
    const m = mapRef.current
    if (!m) return
    const other = view === 'map' ? 'satellite' : 'map'
    if (m.map.hasLayer(m.base[other])) m.map.removeLayer(m.base[other])
    if (!m.map.hasLayer(m.base[view])) m.base[view].addTo(m.map)
  }, [view, ready])

  // Close the results when clicking anywhere outside the search box.
  useEffect(() => {
    if (!results) return
    function onPointerDown(e) {
      if (!searchRef.current?.contains(e.target)) setResults(null)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [results])

  function selectPlace(place) {
    setActive(place)
    const m = mapRef.current
    if (!m || !place.position) return
    m.map.flyTo(place.position, Math.max(m.map.getZoom(), HOME_ZOOM))
    m.markers[place.key]?.openPopup()
  }

  function goHome() {
    selectPlace(PLACES[0])
  }

  async function runSearch(e) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return

    // Ilawod's own places answer instantly, pinned or not.
    const lower = q.toLowerCase()
    const local = PLACES.filter((p) => p.label.toLowerCase().includes(lower)).map((p) => ({
      id: `place-${p.key}`,
      label: p.label,
      detail: p.position ? `${p.kind} · Barangay Ilawod` : `${p.kind} · not pinned on the map yet`,
      place: p,
    }))

    const seq = ++searchSeq.current
    setResults(local)
    setSearchError(null)
    if (q.length < 3) return

    setSearching(true)
    try {
      const found = await geocode(q)
      if (seq === searchSeq.current) setResults([...local, ...found])
    } catch {
      if (seq === searchSeq.current) setSearchError('Location search is not available right now. Please try again.')
    } finally {
      if (seq === searchSeq.current) setSearching(false)
    }
  }

  function pickResult(r) {
    setResults(null)
    if (r.place) {
      selectPlace(r.place)
      return
    }
    const m = mapRef.current
    if (!m) return
    m.found?.remove()
    m.found = m.L.marker(r.position, { icon: foundIcon(m.L), title: r.label })
      .addTo(m.map)
      .bindPopup(popupContent(r.label, r.detail))
    m.map.flyTo(r.position, 17)
    m.found.openPopup()
    setActive({ key: r.id, label: r.label, kind: 'Search result', note: r.detail, position: r.position })
  }

  function locateMe() {
    if (!navigator.geolocation) {
      setLocateError('This browser cannot share your location.')
      return
    }
    setLocating(true)
    setLocateError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        const m = mapRef.current
        if (!m) return
        const here = [pos.coords.latitude, pos.coords.longitude]
        m.me?.remove()
        m.me = m.L.layerGroup([
          m.L.circle(here, { radius: pos.coords.accuracy, weight: 1, color: '#0e7c8b', fillOpacity: 0.1 }),
          m.L.circleMarker(here, { radius: 7, weight: 3, color: '#fff', fillColor: '#0e7c8b', fillOpacity: 1 })
            .bindTooltip('You are here'),
        ]).addTo(m.map)
        m.map.flyTo(here, 17)
      },
      (err) => {
        setLocating(false)
        setLocateError(
          err.code === err.PERMISSION_DENIED
            ? 'Location access is blocked. Allow it in your browser settings to see where you are.'
            : 'Your location could not be found. Check that location is turned on and try again.'
        )
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    )
  }

  // Directions go to the selected place when it has a pin, otherwise to Ilawod.
  const target = active.position ?? ILAWOD
  const targetName = active.position ? active.label : 'Barangay Ilawod'
  const isSearchResult = active.kind === 'Search result'

  return (
    <div className="section">
      <div className="section-head">
        <span className="eyebrow">Barangay map</span>
        <h1>Barangay Ilawod at a glance</h1>
        <p>
          Find the hall, the health centre and the evacuation points, and check which purok your
          household belongs to before you file a request.
        </p>
      </div>

      <div className="stack" style={{ gap: 28 }}>
        <Card padded className="imap-card">
          <div className="imap">
            <div ref={containerRef} className="imap-canvas" role="region" aria-label="Map of Barangay Ilawod" />

            <form className="imap-search" role="search" ref={searchRef} onSubmit={runSearch}>
              <Icon name="search" size="sm" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setResults(null)
                  // Handled here rather than left to the form's implicit
                  // submission, which not every browser and on-screen keyboard
                  // performs for a form with no submit button.
                  else if (e.key === 'Enter') runSearch(e)
                }}
                placeholder="Search location..."
                aria-label="Search location"
                enterKeyHint="search"
                autoComplete="off"
              />
              {searching && <span className="imap-spin" aria-label="Searching" />}

              {results && (
                <div className="imap-results">
                  {results.map((r) => (
                    <button key={r.id} type="button" onClick={() => pickResult(r)}>
                      <b>{r.label}</b>
                      <span>{r.detail}</span>
                    </button>
                  ))}
                  {searching && results.length === 0 && <p aria-live="polite">Searching…</p>}
                  {!searching && searchError && <p role="alert">{searchError}</p>}
                  {!searching && !searchError && results.length === 0 && (
                    <p aria-live="polite">No results found for “{query.trim()}”.</p>
                  )}
                </div>
              )}
            </form>

            <div className="imap-tools">
              <button
                type="button"
                className="imap-tool"
                onClick={locateMe}
                disabled={!ready || locating}
                aria-label="Show my location"
                title="Show my location"
              >
                <Icon name="pin" />
              </button>
              <button
                type="button"
                className="imap-tool"
                onClick={goHome}
                disabled={!ready}
                aria-label="Back to Barangay Ilawod"
                title="Back to Barangay Ilawod"
              >
                <Icon name="home" />
              </button>
              <div className="imap-seg" role="group" aria-label="Map style">
                <button type="button" aria-pressed={view === 'map'} disabled={!ready} onClick={() => setView('map')}>
                  Map
                </button>
                <button
                  type="button"
                  aria-pressed={view === 'satellite'}
                  disabled={!ready}
                  onClick={() => setView('satellite')}
                >
                  Satellite
                </button>
              </div>
            </div>

            <a
              className="btn btn-primary btn-m btn-auto imap-go"
              href={directionsUrl(target)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Start navigation
            </a>

            {!ready && <div className="imap-loading" role={mapError ? 'alert' : undefined}>{mapError ?? 'Loading the map…'}</div>}
          </div>

          {locateError && (
            <p className="help help-err" role="alert" style={{ marginTop: 10 }}>
              {locateError}
            </p>
          )}

          <div className="imap-legend" aria-label="Map legend">
            {LEGEND.map((l) => (
              <span key={l.kind}>
                <i className={`imap-dot-${l.kind}`} aria-hidden="true" /> {l.label}
              </span>
            ))}
          </div>

          <div className="imap-foot">
            <span>Powered by OpenStreetMap, Leaflet and Esri imagery</span>
            <div className="imap-links">
              {/* On phones the in-map button would cover the map controls, so it moves here. */}
              <a
                className="btn btn-primary btn-m btn-auto imap-go-mobile"
                href={directionsUrl(target)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Start navigation
              </a>
              <a href={largerMapUrl(target)} target="_blank" rel="noopener noreferrer">
                View larger map on Google Maps →
              </a>
            </div>
          </div>
        </Card>

        <div className="grid-2 split" style={{ gap: 28, alignItems: 'start' }}>
          <div className="stack" style={{ gap: 20 }}>
            <Card padded>
              <span className="eyebrow">{active.kind}</span>
              <h2 style={{ fontSize: 20, margin: '10px 0 8px' }}>{active.label}</h2>
              <p style={{ fontSize: 14.5, color: 'var(--ink-500)', marginBottom: 16 }}>{active.note}</p>
              {!active.position && (
                <p style={{ fontSize: 13.5, color: 'var(--warning-600)', marginBottom: 16 }}>
                  Not pinned on the map yet. Directions go to Barangay Ilawod until its exact location is confirmed.
                </p>
              )}
              {!isSearchResult && (
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
              )}
              <a
                href={directionsUrl(target)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: 16, fontSize: 14, fontWeight: 600 }}
              >
                Directions to {targetName} →
              </a>
            </Card>

            <Card padded>
              <h2 style={{ fontSize: 16.5, marginBottom: 12 }}>Places in Ilawod</h2>
              <div className="imap-places">
                {PLACES.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className="imap-place"
                    aria-pressed={active.key === p.key}
                    onClick={() => selectPlace(p)}
                  >
                    <b>{p.label}</b>
                    <span>{p.position ? p.kind : 'Pin coming soon'}</span>
                  </button>
                ))}
              </div>
            </Card>
          </div>

          <aside className="stack" style={{ gap: 20 }}>
            <Card padded>
              <h2 style={{ fontSize: 16.5, marginBottom: 12 }}>Which purok am I in?</h2>
              <p style={{ fontSize: 14, color: 'var(--ink-500)', marginBottom: 16 }}>
                Barangay Ilawod has {purokCount} puroks. If a utility bill or an older barangay
                document does not say, the secretary can confirm it from the household record.
              </p>
              <Button to="/register" size="s" variant="secondary" block>
                Register and have it confirmed
              </Button>
            </Card>

            <Notice icon="info" title="About this map">
              The map comes from OpenStreetMap and the satellite view from Esri. The hall, health
              centre and evacuation points are pinned from locations the barangay supplied. Barangay
              Ilawod's purok boundaries are not published as open data, so they are not drawn; the
              barangay's own record decides which purok a household belongs to.
            </Notice>
          </aside>
        </div>
      </div>
    </div>
  )
}
