import { useEffect, useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { Button, Card, Notice, PngSlot } from './ui'
import { useAuth } from '../hooks/useAuth'
import { friendlyError } from '../lib/supabase'
import { AVATAR_TYPES, avatarError, removeMyAvatar, saveMyAvatar, useMyAvatarUrl } from '../lib/avatar'

/**
 * Choose, preview, save, change or remove your own profile picture. Shared by
 * the resident profile and the Admin portal profile: the database decides
 * whose picture can change (only your own), so one card serves both.
 *
 * Nothing is uploaded until Save. Cancel keeps the current picture.
 */
export function ProfilePictureCard({ placeholder }) {
  const { profile, refetchProfile } = useAuth()
  const queryClient = useQueryClient()
  const current = useMyAvatarUrl()
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

  function choose(e) {
    const chosen = e.target.files?.[0]
    // Cleared so that choosing the same file again still counts.
    e.target.value = ''
    if (!chosen) return
    const problem = avatarError(chosen)
    setError(problem)
    setDone(null)
    if (!problem) setFile(chosen)
  }

  async function refresh() {
    await refetchProfile()
    queryClient.invalidateQueries({ queryKey: ['my-avatar'] })
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await saveMyAvatar(profile.id, profile.avatar_path, file)
      await refresh()
      setFile(null)
      setDone('Your profile picture has been saved.')
    } catch (err) {
      setError(friendlyError(err, 'Your picture could not be saved. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm('Remove your profile picture? The default avatar will be shown instead.')) return
    setBusy(true)
    setError(null)
    try {
      await removeMyAvatar(profile.id, profile.avatar_path)
      await refresh()
      setDone('Your profile picture has been removed.')
    } catch (err) {
      setError(friendlyError(err, 'Your picture could not be removed. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  const shown = preview ?? current

  return (
    <Card padded>
      <h2 style={{ fontSize: 16.5, marginBottom: 6 }}>Profile picture</h2>
      <p style={{ fontSize: 13.5, color: 'var(--ink-500)', marginBottom: 18 }}>
        Shown only to you, next to your name. It is never used for face sign-in.
      </p>

      <div className="avatar-edit">
        {shown ? (
          <img
            src={shown}
            alt={file ? 'Preview of your new profile picture' : 'Your profile picture'}
            className="avatar-img avatar-edit-pic"
          />
        ) : (
          <PngSlot name={placeholder} caption={false} className="avatar-edit-pic" pill quiet />
        )}

        <div className="grow" style={{ minWidth: 0 }}>
          <b style={{ display: 'block', fontSize: 14.5, color: 'var(--ink-800)' }}>
            {file ? 'Preview' : current ? 'Current picture' : 'Default avatar'}
          </b>
          <span style={{ display: 'block', fontSize: 13, color: 'var(--ink-400)', marginBottom: 12 }}>
            {file ? 'Not saved yet. Save to use this picture.' : 'JPEG, PNG or WebP, up to 2 MB.'}
          </span>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {file ? (
              <>
                <Button size="s" auto icon="check" onClick={save} disabled={busy}>
                  {busy ? 'Saving…' : 'Save picture'}
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
                  {current ? 'Change picture' : 'Upload a picture'}
                </label>
                {current && (
                  <Button
                    size="s"
                    auto
                    variant="ghost"
                    style={{ color: 'var(--danger-600)' }}
                    onClick={remove}
                    disabled={busy}
                  >
                    Remove
                  </Button>
                )}
              </>
            )}
            <input
              id={inputId}
              type="file"
              accept={AVATAR_TYPES.join(',')}
              onChange={choose}
              disabled={busy}
              style={{ display: 'none' }}
            />
          </div>
        </div>
      </div>

      {error && (
        <p className="help help-err" role="alert" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}
      {done && !error && (
        <div style={{ marginTop: 14 }}>
          <Notice icon="check" title="Done">
            {done}
          </Notice>
        </div>
      )}
    </Card>
  )
}

export default ProfilePictureCard
