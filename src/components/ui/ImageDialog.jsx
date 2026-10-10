import { useEffect, useRef } from 'react'

import { Icon } from '../Icon'

/**
 * One image, larger, over the page.
 *
 * The behaviour is the accessible-dialog behaviour the admin ID viewer already
 * established, extracted so that evidence photographs get it too rather than a
 * second, worse copy: Escape closes, the page behind does not scroll, focus
 * moves to the close button on open and returns to whatever opened it on
 * close, Tab cannot wander into the page underneath, and only the backdrop
 * closes on click -- never the image itself.
 *
 * It takes a URL that the caller already holds. It never mints one: a signed
 * link that expires in five minutes should not be re-signed just because
 * someone wanted a closer look, and the URL never reaches the address bar.
 *
 * ResidentReview.jsx keeps its own inline copy for now; this is deliberately
 * not a refactor of that screen.
 */
export function ImageDialog({ url, title, subtitle, alt, onClose, openerRef }) {
  const closeRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab') {
        // Only one control in here, so the trap is simply "stay on it".
        e.preventDefault()
        closeRef.current?.focus()
      }
    }

    const scrollY = window.scrollY
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      window.scrollTo(0, scrollY)
      openerRef?.current?.focus()
    }
  }, [onClose, openerRef])

  if (!url) return null

  return (
    <div
      className="idmodal"
      role="dialog"
      aria-modal="true"
      aria-label={alt ?? title ?? 'Photograph'}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="idmodal-box">
        <div className="idmodal-bar">
          <b>
            {title}
            {subtitle ? ` · ${subtitle}` : ''}
          </b>
          <button
            type="button"
            ref={closeRef}
            className="idmodal-close"
            onClick={onClose}
            aria-label="Close the photo viewer"
          >
            <Icon name="x" />
          </button>
        </div>

        <img src={url} alt={alt ?? title ?? 'Photograph'} className="idmodal-doc" />
      </div>
    </div>
  )
}

export default ImageDialog
