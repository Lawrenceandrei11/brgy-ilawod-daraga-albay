/**
 * Photos staff upload for the public site: officials' portraits and notice
 * covers. They live in the `public-assets` bucket, which migration 08 made
 * readable by anyone and writable by staff only (is_staff() on insert, update
 * and delete) — so the permission check is the database's, not this file's.
 */
import { supabase } from './supabase'

const BUCKET = 'public-assets'

// The bucket also accepts SVG, which can carry script. A photograph never
// needs it, so the picker does not offer it.
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const EXTENSION = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

// The bucket's own limit. Checked here so staff hear it before an upload.
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024

/** A sentence to show staff, or null when the file is fine to upload. */
export function photoError(file) {
  if (!PHOTO_TYPES.includes(file.type)) return 'Choose a JPEG, PNG or WebP photo.'
  if (file.size > PHOTO_MAX_BYTES) return 'That photo is larger than 5 MB. Try a smaller one.'
  return null
}

export function publicPhotoUrl(path) {
  return path ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null
}

/**
 * A new name every time rather than overwriting the old file: a replaced
 * photo at an unchanged URL would keep being served from browser and CDN
 * caches, and residents would see the old face for days.
 */
export async function uploadPhoto(file, folder) {
  const path = `${folder}/${crypto.randomUUID()}.${EXTENSION[file.type] ?? 'jpg'}`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw error
  return path
}

/** Best effort: a leftover file costs a little storage, never correctness. */
export async function removePhoto(path) {
  if (!path) return
  await supabase.storage.from(BUCKET).remove([path])
}
