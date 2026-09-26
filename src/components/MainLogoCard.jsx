import { useEffect, useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { Button, Card, CardHeader, Notice, PngSlot } from './ui'
import { useAuth } from '../hooks/useAuth'
import { friendlyError } from '../lib/supabase'
import { LOGO_TYPES, logoError, removeMainLogo, saveMainLogo, useMainLogo } from '../lib/branding'

/**
 * The system's main logo, and the one person who may change it.
 *
 * The card renders for the captain only -- but that is the courtesy, not the
 * rule. Storage refuses a write to branding/ from anyone else and settings
 * refuses the row that points at it, so a secretary who called the upload
 * directly would be turned away by the database (migration 22).
 *
 * Nothing is uploaded until Save, so cancelling leaves the current logo
 * exactly where it was.
 */
export function MainLogoCard() {
  const { isCaptain } = useAuth()
  const queryClient = useQueryClient()
  const current = useMainLogo()
  const inputId = useId()

  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)

  // Shows the chosen file without uploading it; freed when it changes.
  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  if (!isCaptain) return null

  function choose(e) {
    const chosen = e.target.files?.[0]
    // Cleared so that choosing the same file again still counts.
    e.target.value = ''
    if (!chosen) return
    const problem = logoError(chosen)
    setError(problem)
    setDone(null)
    if (!problem) setFile(chosen)
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['main-logo'] })
  }

  async function save() {
    const replacing = !!current.path
    const warning = replacing
      ? 'Replace the main logo?\n\nEvery header across the public site and both portals will use the new image, and the file it replaces is deleted.'
      : 'Use this image as the main logo?\n\nIt will appear in every header across the public site and both portals.'
    if (!window.confirm(warning)) return

    setBusy(true)
    setError(null)
    try {
      await saveMainLogo(file, current.path)
      await refresh()
      setFile(null)
      setDone('The main logo has been updated everywhere it appears.')
    } catch (err) {
      setError(friendlyError(err, 'The logo could not be saved. The current one is unchanged.'))
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    if (
      !window.confirm(
        'Remove the custom logo?\n\nThe barangay seal that came with the system is used again, and the uploaded file is deleted.'
      )
    )
      return

    setBusy(true)
    setError(null)
    try {
      await removeMainLogo(current.path)
      await refresh()
      setFile(null)
      setDone('The default barangay seal is in use again.')
    } catch (err) {
      setError(friendlyError(err, 'The logo could not be removed. The current one is unchanged.'))
    }
    setBusy(false)
  }

  const shown = preview ?? current.url

  return (
    <Card flush>
      <CardHeader title="Main logo" />

      <div style={{ padding: '18px 26px 20px' }}>
        {done && (
          <Notice icon="check" title="Done">
            {done}
          </Notice>
        )}
        {error && (
          <Notice tone="danger" icon="alert" title="Could not change the logo">
            {error}
          </Notice>
        )}

        <div className="avatar-edit">
          {shown ? (
            <img
              src={shown}
              alt={file ? 'Preview of the new logo' : 'The current main logo'}
              className="avatar-img avatar-edit-pic"
            />
          ) : (
            <PngSlot name="barangay-logo.png" caption={false} className="avatar-edit-pic" pill quiet />
          )}

          <div className="grow" style={{ minWidth: 0 }}>
            <b style={{ display: 'block', fontSize: 14.5, color: 'var(--ink-800)' }}>
              {file ? 'Preview' : current.path ? 'Custom logo' : 'Default barangay seal'}
            </b>
            <span style={{ display: 'block', fontSize: 13, color: 'var(--ink-400)', marginBottom: 12 }}>
              {file
                ? 'Not saved yet. Save to use this image.'
                : 'PNG, JPEG or WebP, up to 2 MB. Used in every header.'}
            </span>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {file ? (
                <>
                  <Button size="s" auto icon="check" onClick={save} disabled={busy}>
                    {busy ? 'Saving…' : 'Save logo'}
                  </Button>
                  <Button size="s" auto variant="ghost" onClick={() => setFile(null)} disabled={busy}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <label
                    className={`btn btn-s btn-secondary btn-auto${busy ? ' is-disabled' : ''}`}
                    htmlFor={inputId}
                    style={{ cursor: busy ? 'default' : 'pointer' }}
                  >
                    {current.path ? 'Replace logo' : 'Change main logo'}
                  </label>
                  {current.path && (
                    <Button
                      size="s"
                      auto
                      variant="ghost"
                      style={{ color: 'var(--danger-600)' }}
                      onClick={reset}
                      disabled={busy}
                    >
                      Use the default
                    </Button>
                  )}
                </>
              )}
              <input
                id={inputId}
                type="file"
                accept={LOGO_TYPES.join(',')}
                onChange={choose}
                disabled={busy}
                style={{ display: 'none' }}
              />
            </div>
          </div>
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--ink-400)', margin: '16px 0 0' }}>
          Only the Punong Barangay can change this. The barangay seal that ships with the system
          stays as the fallback, so removing a custom logo never leaves a blank header.
        </p>
      </div>
    </Card>
  )
}

export default MainLogoCard
