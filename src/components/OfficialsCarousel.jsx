import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { PngSlot } from './ui'
import { Icon } from './Icon'
import { publicPhotoUrl } from '../lib/storage'

/**
 * The barangay council, sliding.
 *
 * The cards are the same .off cards the section always used, with the same
 * five records from the officials table -- nothing is added, copied or
 * re-queried. What is new is the frame around them: a fixed window, a track
 * that slides by exactly one card, and arrows for doing it by hand.
 *
 * The loop is seamless because the track holds the list twice. Sliding past
 * the last real card lands on its copy, which looks identical, and the track
 * then snaps back by one list width with the animation switched off. Nobody
 * sees the snap, and there is never an empty stretch at the end.
 *
 * When every official fits in the window there is nothing to slide, so the
 * arrows and the timer stay away and the row renders as it did before.
 */

const GAP = 18 // matches the gap the officials row has always used
const DELAY = 4000 // pause on each card
const DURATION = 520 // must match .carousel-track's transition

function perViewFor(width) {
  if (width >= 1040) return 4
  if (width >= 760) return 3
  if (width >= 520) return 2
  return 1
}

export function OfficialsCarousel({ officials = [] }) {
  const viewportRef = useRef(null)
  const [perView, setPerView] = useState(4)
  const [cardWidth, setCardWidth] = useState(0)
  const [index, setIndex] = useState(0)
  const [animate, setAnimate] = useState(true)
  const [held, setHeld] = useState(false) // pointer or focus is on the carousel

  const count = officials.length
  const slides = count > perView

  // The window decides how many fit and how wide each card is, so the cards
  // always end flush with both edges and never cause sideways page scroll.
  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const measure = () => {
      const width = el.clientWidth
      if (!width) return
      const pv = Math.max(1, Math.min(perViewFor(width), Math.max(count, 1)))
      setPerView(pv)
      setCardWidth((width - GAP * (pv - 1)) / pv)
    }
    measure()
    // The observer catches the window that changes without the page doing so
    // -- a phone turning, a panel opening. The resize listener is the belt to
    // its braces: observer callbacks ride the rendering loop, which a
    // background tab suspends, and a tab can be resized while hidden.
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [count])

  // Back to the start if the window grows enough to show everything.
  useEffect(() => {
    if (!slides && index !== 0) {
      setAnimate(false)
      setIndex(0)
    }
  }, [slides, index])

  // Re-arm the animation after any silent jump.
  useEffect(() => {
    if (animate) return
    const t = setTimeout(() => setAnimate(true), 20)
    return () => clearTimeout(t)
  }, [animate])

  // Past the end of the real list, the track is showing the copy: wait for
  // the slide to finish, then snap back a whole list width without animating.
  // On a timer rather than transitionend, which a background tab withholds.
  useEffect(() => {
    if (index < count || count === 0) return
    const t = setTimeout(() => {
      setAnimate(false)
      setIndex((i) => i - count)
    }, DURATION)
    return () => clearTimeout(t)
  }, [index, count])

  const next = useCallback(() => setIndex((i) => i + 1), [])

  const previous = useCallback(() => {
    setIndex((i) => {
      if (i > 0) return i - 1
      // At the first card there is nothing to the left, so hop silently to
      // the copy of it further along and slide back from there.
      setAnimate(false)
      return count
    })
  }, [count])

  // The silent hop above lands on `count`; step left once the track is there.
  const pendingBack = useRef(false)
  useEffect(() => {
    if (!pendingBack.current) return
    pendingBack.current = false
    const t = setTimeout(() => setIndex((i) => i - 1), 20)
    return () => clearTimeout(t)
  })

  function handlePrevious() {
    if (index === 0) pendingBack.current = true
    previous()
  }

  // Autoplay, unless the reader is busy with it.
  useEffect(() => {
    if (!slides || held) return
    const t = setInterval(next, DELAY)
    return () => clearInterval(t)
  }, [slides, held, next])

  // Swipe. Pointer events cover finger, pen and mouse drag alike.
  const start = useRef(null)
  function onPointerDown(e) {
    start.current = { x: e.clientX, index }
    setHeld(true)
  }
  function onPointerUp(e) {
    const from = start.current
    start.current = null
    setHeld(false)
    if (!from || !slides) return
    const moved = e.clientX - from.x
    if (Math.abs(moved) < 40) return
    if (moved < 0) next()
    else handlePrevious()
  }

  if (count === 0) return null

  const offset = cardWidth ? index * (cardWidth + GAP) : 0

  const card = (o, key, clone) => (
    <div className="off" key={key} style={{ width: cardWidth || undefined }} aria-hidden={clone || undefined}>
      <PngSlot
        name="official-placeholder.png"
        src={publicPhotoUrl(o.photo_path)}
        caption={false}
        className="av"
        pill
        quiet
      />
      <b>{o.position}</b>
      <span>{o.name}</span>
    </div>
  )

  return (
    <div
      className="carousel"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlurCapture={() => setHeld(false)}
    >
      {slides && (
        <button
          type="button"
          className="carousel-arrow prev"
          aria-label="Previous officials"
          onClick={handlePrevious}
        >
          <Icon name="chev" size="sm" style={{ transform: 'rotate(180deg)' }} />
        </button>
      )}

      <div
        className="carousel-viewport"
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          start.current = null
          setHeld(false)
        }}
      >
        <div
          className="carousel-track"
          style={{
            gap: GAP,
            transform: `translate3d(${-offset}px, 0, 0)`,
            transition: animate ? `transform ${DURATION}ms ease` : 'none',
          }}
        >
          {officials.map((o) => card(o, o.id, false))}
          {/* The second pass is what makes the loop seamless. It is hidden
              from screen readers, which read the five real cards once. */}
          {slides && officials.map((o) => card(o, `${o.id}-again`, true))}
        </div>
      </div>

      {slides && (
        <button type="button" className="carousel-arrow next" aria-label="Next officials" onClick={next}>
          <Icon name="chev" size="sm" />
        </button>
      )}
    </div>
  )
}

export default OfficialsCarousel
