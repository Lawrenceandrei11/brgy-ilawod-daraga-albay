import { useEffect, useId, useState } from 'react'

import { Button } from './Button'
import { PngSlot } from './PngSlot'
import { PHOTO_TYPES, photoError, publicPhotoUrl } from '../../lib/storage'

/**
 * Choose a replacement photo and see it before anything is saved.
 *
 * Nothing is uploaded here. The parent form uploads `file` only when its own
 * Save succeeds, so cancelling the form — or pressing "Keep current photo" —
 * leaves the existing photo exactly as it was.
 */
export function PhotoPicker({ label, currentPath, file, onChange, placeholder, round = false, caption = true }) {
  const id = useId()
  const [error, setError] = useState(null)
  const [preview, setPreview] = useState(null)

  // An object URL shows the chosen file without uploading it. Revoked when
  // the file changes or the form closes, so it does not leak.
  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  function choose(e) {
    const chosen = e.target.files?.[0]
    // Cleared so that picking the same file again still fires onChange.
    e.target.value = ''
    if (!chosen) return
    const problem = photoError(chosen)
    setError(problem)
    if (!problem) onChange(chosen)
  }

  const current = publicPhotoUrl(currentPath)
  const shown = preview ?? current
  const size = { width: round ? 84 : 112, height: round ? 84 : 72, flex: 'none' }

  return (
    <div className="field">
      <label htmlFor={id}>
        {label} <em>optional</em>
      </label>

      <div className="row" style={{ gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        {shown ? (
          <img
            src={shown}
            alt={file ? 'Preview of the new photo' : 'The current photo'}
            style={{
              ...size,
              objectFit: 'cover',
              borderRadius: round ? 'var(--r-pill)' : 'var(--r-md)',
              border: '1px solid var(--ink-200)',
            }}
          />
        ) : (
          <PngSlot name={placeholder} caption={caption} pill={round} quiet style={size} />
        )}

        <div className="grow" style={{ minWidth: 160 }}>
          <b style={{ display: 'block', fontSize: 14.5, color: 'var(--ink-800)' }}>
            {file ? file.name : current ? 'Current photo' : 'No photo yet'}
          </b>
          <span style={{ fontSize: 13, color: 'var(--ink-400)' }}>
            {file
              ? `Preview only. It replaces ${current ? 'the current photo' : 'the placeholder'} when you save.`
              : 'JPEG, PNG or WebP, up to 5 MB.'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label className="btn btn-s btn-secondary btn-auto" style={{ cursor: 'pointer' }}>
            {shown ? 'Change photo' : 'Choose a photo'}
            <input id={id} type="file" accept={PHOTO_TYPES.join(',')} onChange={choose} style={{ display: 'none' }} />
          </label>
          {file && (
            <Button
              type="button"
              size="s"
              auto
              variant="ghost"
              onClick={() => {
                setError(null)
                onChange(null)
              }}
            >
              {current ? 'Keep current photo' : 'Remove'}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <span className="help help-err" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

export default PhotoPicker
