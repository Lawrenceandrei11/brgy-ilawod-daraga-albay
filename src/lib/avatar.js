/**
 * Profile pictures -- the signed-in user's own, and nobody else's.
 *
 * They live in the private `avatars` bucket under avatars/<user id>/. The
 * database enforces the rules (migration 17): each user can read and write
 * only their own folder, and only the owner can set or clear
 * profiles.avatar_path -- staff included. Nothing here is trusted to do that.
 *
 * A profile picture is never used for face sign-in, which matches against
 * face_templates alone.
 */
import { useQuery } from '@tanstack/react-query'

import { supabase } from './supabase'
import { useAuth } from '../hooks/useAuth'

const BUCKET = 'avatars'

// The bucket enforces these too; checking first means a plain message
// instead of a failed upload.
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const EXTENSION = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024

// A private bucket needs signed links. An hour is plenty for a page view;
// the query refreshes before the link runs out.
const SIGNED_URL_SECONDS = 60 * 60

/** A sentence to show the user, or null when the file is fine. */
export function avatarError(file) {
  if (!AVATAR_TYPES.includes(file.type)) return 'Choose a JPEG, PNG or WebP photo.'
  if (file.size > AVATAR_MAX_BYTES) return 'That photo is larger than 2 MB. Try a smaller one.'
  return null
}

/** The signed-in user's picture as a viewable URL, or null for the default avatar. */
export function useMyAvatarUrl() {
  const { profile } = useAuth()
  const path = profile?.avatar_path ?? null

  const { data } = useQuery({
    queryKey: ['my-avatar', path],
    enabled: !!path,
    staleTime: (SIGNED_URL_SECONDS - 10 * 60) * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS)
      if (error) throw error
      return data.signedUrl
    },
  })

  return path ? data ?? null : null
}

/**
 * Upload a new picture and point the profile at it. A new file name every
 * time, so browsers never show the old picture from cache. The previous
 * file is removed only once the profile points at the new one.
 */
export async function saveMyAvatar(profileId, oldPath, file) {
  const path = `${profileId}/${crypto.randomUUID()}.${EXTENSION[file.type] ?? 'jpg'}`
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })
  if (uploadError) throw uploadError

  const { error: updateError } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', profileId)
  if (updateError) {
    await supabase.storage.from(BUCKET).remove([path])
    throw updateError
  }

  if (oldPath) await supabase.storage.from(BUCKET).remove([oldPath])
}

/** Back to the default avatar. The file goes too; a picture is not kept once removed. */
export async function removeMyAvatar(profileId, oldPath) {
  const { error } = await supabase.from('profiles').update({ avatar_path: null }).eq('id', profileId)
  if (error) throw error
  if (oldPath) await supabase.storage.from(BUCKET).remove([oldPath])
}
