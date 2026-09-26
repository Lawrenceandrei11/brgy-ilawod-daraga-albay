import { useEffect, useState } from 'react'

/**
 * PngSlot — image with a labelled placeholder fallback.
 *
 * Carried over from the prototype on purpose. Artwork for this project is
 * still being produced, so a missing file renders a dashed slot captioned
 * with the filename it expects, rather than a broken image. Drop the real
 * file into /public/assets/ and it appears with no code change.
 *
 * `src` is for a photo staff have uploaded — an official's portrait, a
 * notice's cover. It is tried first and falls back to the /assets/ artwork,
 * so a record with no photo, or whose file has gone, looks exactly as it did
 * before photos existed.
 *
 * `caption={false}` keeps the empty slot but drops the filename. Use it where
 * the placeholder is what the public actually sees — a council member with no
 * portrait yet should look like a blank avatar, not a missing file.
 *
 *   <PngSlot name="service-clearance.png" className="slot" />
 *   <PngSlot name="official-placeholder.png" src={publicPhotoUrl(o.photo_path)} caption={false} />
 */
export function PngSlot({
  name,
  src: photo = null,
  alt = '',
  caption = true,
  className = '',
  pill = false,
  onDark = false,
  quiet = false,
  style,
  ...rest
}) {
  const [url, setUrl] = useState(null)

  useEffect(() => {
    let cancelled = false
    const artwork = `/assets/${name}`

    function load(candidate, next) {
      const img = new Image()
      img.onload = () => {
        if (!cancelled) setUrl(candidate)
      }
      img.onerror = () => {
        if (cancelled) return
        if (next) load(next, null)
        else setUrl(null)
      }
      img.src = candidate
    }

    load(photo ?? artwork, photo ? artwork : null)
    return () => {
      cancelled = true
    }
  }, [name, photo])

  // Artwork is drawn to fit its slot; a photograph is cropped to fill it,
  // the way any portrait or cover image is.
  const isPhoto = !!url && url === photo

  const classes = [
    className,
    pill ? 'pill' : '',
    onDark ? 'on-dark-slot' : '',
    quiet ? 'quiet' : '',
    url ? 'has-img' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      data-png={name}
      // Also empty once an image is showing: .has-img::after zeroes the
      // caption's opacity, but .quiet::after sets it back to 0.75 at the same
      // specificity and wins on order, so the filename would otherwise sit on
      // top of the artwork.
      data-caption={caption && !url ? undefined : ''}
      className={classes}
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : 'true'}
      style={url ? { '--img': `url("${url}")`, ...(isPhoto ? { backgroundSize: 'cover' } : null), ...style } : style}
      {...rest}
    />
  )
}

export default PngSlot
