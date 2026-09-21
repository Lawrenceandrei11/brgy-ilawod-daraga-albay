import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { HOME_ZOOM, PLACES, TILES, placeIcon } from '../pages/public/Map'

/**
 * A small, still preview of the Barangay Map for the home page.
 *
 * Everything that makes it look like the real map -- the pinned places, the
 * OpenStreetMap tiles, the logo pin and the coloured dots -- comes from the
 * map page itself, so the two can never disagree about where anything is.
 * What it leaves out is everything you would do with a map: no dragging,
 * zooming, search or popups. The whole preview is a way into /map.
 *
 * Leaflet and the tiles are fetched only once the preview scrolls near the
 * screen, so a visitor who never scrolls this far downloads none of it.
 */
export function MapPreview() {
  const boxRef = useRef(null)
  const containerRef = useRef(null)
  const [near, setNear] = useState(false)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    // Without IntersectionObserver there is no way to wait, so load now.
    if (!('IntersectionObserver' in window)) {
      setNear(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true)
          io.disconnect()
        }
      },
      { rootMargin: '300px' }
    )
    io.observe(box)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!near) return
    let cancelled = false
    let map
    let resizeObserver

    ;(async () => {
      try {
        const [{ default: L }] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')])
        if (cancelled || !containerRef.current) return

        // No centre or zoom here: the first view is the fit to the pins below,
        // so no tiles are fetched for a view that is thrown away at once.
        map = L.map(containerRef.current, {
          // A picture of the map, not a map to use.
          dragging: false,
          touchZoom: false,
          doubleClickZoom: false,
          scrollWheelZoom: false,
          boxZoom: false,
          keyboard: false,
          zoomControl: false,
        })
        const pinned = PLACES.filter((p) => p.position)

        // Frame every pin, with room for the logo pin standing above its point.
        // Not animated: a still picture has nothing to animate, and an
        // animated fit only lands once the browser paints, so a tab opened in
        // the background would otherwise stay at the wrong zoom.
        const fit = () =>
          map.fitBounds(
            pinned.map((p) => p.position),
            { paddingTopLeft: [36, 70], paddingBottomRight: [36, 36], maxZoom: HOME_ZOOM, animate: false }
          )
        fit()

        L.tileLayer(TILES.map.url, TILES.map.options).addTo(map)

        for (const place of pinned) {
          L.marker(place.position, {
            icon: placeIcon(L, place),
            interactive: false,
            keyboard: false,
            zIndexOffset: place.key === 'ilawod' ? -1000 : 0,
          }).addTo(map)
        }

        resizeObserver = new ResizeObserver(() => {
          map.invalidateSize()
          fit()
        })
        resizeObserver.observe(containerRef.current)

        setReady(true)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()

    return () => {
      cancelled = true
      resizeObserver?.disconnect()
      map?.remove()
    }
  }, [near])

  return (
    <div className="imap imap-preview" ref={boxRef}>
      <div ref={containerRef} className="imap-canvas" aria-hidden="true" />
      {/* The button beside the preview is the way in for keyboard and screen
          reader users; this only makes the picture itself clickable. */}
      <Link to="/map" className="imap-preview-link" tabIndex={-1} aria-hidden="true" />
      {!ready && (
        <div className="imap-loading">{failed ? 'The map preview could not be loaded.' : 'Loading the map…'}</div>
      )}
    </div>
  )
}

export default MapPreview
