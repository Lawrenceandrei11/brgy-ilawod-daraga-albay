import { useEffect, useState } from 'react'

/**
 * PngSlot — image with a labelled placeholder fallback.
 *
 * Carried over from the prototype on purpose. Artwork for this project is
 * still being produced, so a missing file renders a dashed slot captioned
 * with the filename it expects, rather than a broken image. Drop the real
 * file into /public/assets/ and it appears with no code change.
 *
 * `caption={false}` keeps the empty slot but drops the filename. Use it where
 * the placeholder is what people actually see, such as a default avatar,
 * where a filename would read as a broken image.
 *
 *   <PngSlot name="service-clearance.png" className="slot" />
 *   <PngSlot name="official-placeholder.png" caption={false} />
 */
export function PngSlot({ name, alt = '', caption = true, className = '', pill = false, onDark = false, quiet = false, style, ...rest }) {
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
      // Empty for caption={false}, and once an image is showing: .has-img::after
      // zeroes the caption's opacity, but .quiet::after sets it back to 0.75 at
      // the same specificity and wins on order, so the filename would otherwise
      // sit on top of the artwork.
      data-caption={caption && !src ? undefined : ''}
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
