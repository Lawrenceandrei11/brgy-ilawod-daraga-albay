import { useEffect, useState } from 'react'

import { supabase } from '../lib/supabase'

/**
 * The valid ID a resident has on file, read from the private bucket.
 *
 * The bucket stays private. This asks for a signed URL that expires in five
 * minutes, the same window the staff review screen uses, and it asks for one
 * only when there is a path to ask about. Row Level Security is what actually
 * protects the file: `valid_ids_read_own` allows the owner and staff, so a
 * resident who somehow supplied someone else's path would get nothing back.
 *
 * A missing document says so plainly. It used to render a design placeholder
 * -- a dashed box captioned "valid-id-placeholder.png" -- which looked like a
 * real file on file and was not.
 */
export function IdDocumentView({ path, label = 'Your valid ID', height = 180, emptyText }) {
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)
  const isPdf = /\.pdf$/i.test(path ?? '')

  useEffect(() => {
    let cancelled = false
    setUrl(null)
    setFailed(false)
    if (!path) return undefined

    supabase.storage
      .from('valid-ids')
      .createSignedUrl(path, 300)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data?.signedUrl) setFailed(true)
        else setUrl(data.signedUrl)
      })

    return () => {
      cancelled = true
    }
  }, [path])

  if (!path) {
    return (
      <div className="idfile idfile-empty">
        {emptyText ?? 'No valid ID uploaded.'}
      </div>
    )
  }

  if (failed) {
    return (
      <div className="idfile idfile-empty">
        This ID could not be opened. Ask the barangay staff to check the file.
      </div>
    )
  }

  if (!url) {
    return <div className="idfile idfile-empty">Opening your ID…</div>
  }

  return isPdf ? (
    <object data={url} type="application/pdf" className="idfile" style={{ height }} aria-label={label}>
      <p style={{ fontSize: 13, color: 'var(--ink-500)', padding: 14 }}>
        This browser will not display the PDF here.
      </p>
    </object>
  ) : (
    <img src={url} alt={label} className="idfile" style={{ maxHeight: height }} />
  )
}
