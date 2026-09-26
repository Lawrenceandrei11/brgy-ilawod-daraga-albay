import { useQuery } from '@tanstack/react-query'

import { supabase } from './supabase'

/**
 * The system's main logo.
 *
 * The file lives in public-assets under branding/, beside the officials'
 * portraits and notice covers but in a folder of its own. Which file is
 * current is one row in settings, whose policies already say only the captain
 * may write a setting -- so the permission is the one the system already has,
 * not a new one.
 *
 * Nothing here decides whether the caller may change the logo. The database
 * does: storage refuses a write to branding/ from anyone but the captain, and
 * settings refuses the row. The page only avoids offering what would fail.
 */

const BUCKET = 'public-assets'
const FOLDER = 'branding'
const SETTING = 'main_logo_path'

export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const EXTENSION = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

// A seal is small artwork. Well under the bucket's own 5 MB ceiling.
export const LOGO_MAX_BYTES = 2 * 1024 * 1024

/** A sentence to show, or null when the file is fine to upload. */
export function logoError(file) {
  if (!LOGO_TYPES.includes(file.type)) return 'Choose a PNG, JPEG or WebP image.'
  if (file.size > LOGO_MAX_BYTES) return 'That image is larger than 2 MB. Try a smaller one.'
  return null
}

function publicUrl(path) {
  return path ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null
}

/**
 * The logo every header reads: { path, url }, or nulls for "use the default
 * artwork". A failure here is deliberately quiet -- the barangay seal shipped
 * with the app is the fallback, so a database hiccup costs nobody their
 * header.
 */
export function useMainLogo() {
  const { data } = useQuery({
    queryKey: ['main-logo'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('main_logo_path')
      if (error) return { path: null, url: null }
      return { path: data ?? null, url: publicUrl(data) }
    },
  })
  return data ?? { path: null, url: null }
}

/**
 * Upload, then point the setting at the new file, then drop the old one.
 *
 * In that order on purpose: if the upload fails nothing has changed, and if
 * the setting fails the old logo is still the one on record. The previous
 * file is removed last so the folder holds one logo, not a pile of them.
 */
export async function saveMainLogo(file, previousPath) {
  const problem = logoError(file)
  if (problem) throw new Error(problem)

  const path = `${FOLDER}/logo-${crypto.randomUUID()}.${EXTENSION[file.type] ?? 'png'}`

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })
  if (uploadError) throw uploadError

  const { error: settingError } = await supabase
    .from('settings')
    .upsert({ key: SETTING, value: path, updated_at: new Date().toISOString() })
  if (settingError) {
    // Leave nothing half-done: the file nobody is pointing at goes away.
    await supabase.storage.from(BUCKET).remove([path])
    throw settingError
  }

  if (previousPath && previousPath !== path) {
    await supabase.storage.from(BUCKET).remove([previousPath])
  }
  return path
}

/** Back to the artwork that ships with the app, and the old file deleted. */
export async function removeMainLogo(currentPath) {
  const { error } = await supabase
    .from('settings')
    .upsert({ key: SETTING, value: null, updated_at: new Date().toISOString() })
  if (error) throw error
  if (currentPath) await supabase.storage.from(BUCKET).remove([currentPath])
}
