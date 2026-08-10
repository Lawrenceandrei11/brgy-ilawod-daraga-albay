import { useEffect, useState } from 'react'

/**
 * PngSlot — image with a labelled placeholder fallback.
 *
 * Carried over from the prototype on purpose. Artwork for this project is
 * still being produced, so a missing file renders a dashed slot captioned
 * with the filename it expects, rather than a broken image. Drop the real
 * file into /public/assets/ and it appears with no code change.
 *
 *   <PngSlot name="service-clearance.png" className="slot" />
 */
export function PngSlot({ name, alt = '', className = '', pill = false, onDark = false, quiet = false, style, ...rest }) {
  const [src, setSrc] = useState(null)

  useEffect(() => {
    let cancelled = false
    const url = `/assets/${name}`
    const img = new Image()
    img.onload = () => {
      if (!cancelled) setSrc(url)
    }
    img.onerror = () => {
      if (!cancelled) setSrc(null)
    }
    img.src = url
    return () => {
      cancelled = true
    }
  }, [name])

  const classes = [
    className,
    pill ? 'pill' : '',
    onDark ? 'on-dark-slot' : '',
    quiet ? 'quiet' : '',
    src ? 'has-img' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      data-png={name}
      className={classes}
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : 'true'}
      style={src ? { '--img': `url("${src}")`, ...style } : style}
      {...rest}
    />
  )
}

export default PngSlot
