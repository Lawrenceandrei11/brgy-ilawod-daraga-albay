/**
 * Tidying away the ID a resident has replaced.
 *
 * The old document is kept deliberately: through the upload, through the wait
 * for review, and right up until a staff member accepts the new one. Only
 * then is it superseded, and only then is it removed. That ordering means
 * there is never a moment when the barangay holds no readable ID for a
 * resident who has one on file.
 *
 * Storage and the database are not one transaction, and cannot be made into
 * one. So the order is chosen to make the survivable failure the likely one:
 *
 *   1. mark_valid_id_reviewed()  -- the database, first
 *   2. delete the superseded files -- storage, second
 *
 * If step 2 fails the review still stands, which is the fact that matters,
 * and what is left behind is an unreferenced file. That is untidy, not
 * incorrect, and running the same cleanup again fixes it. The reverse order
 * would risk deleting a document while the review failed to record, leaving
 * a resident's record pointing at a file that no longer exists.
 *
 * Nothing here decides WHICH file is current -- it is told, by the value
 * mark_valid_id_reviewed() returned, so a path that changed between reading
 * the row and reviewing it cannot cause the live document to be deleted.
 */

/** Everything in the resident's folder is theirs; only the current one stays. */
export async function cleanupSupersededIds({ client, userId, keepPath }) {
  if (!userId) return { ok: false, reason: 'no-user', removed: [] }
  // Refusing to run without a keepPath is the important guard: an empty value
  // here would mean "keep nothing", and delete the resident's only ID.
  if (!keepPath) return { ok: false, reason: 'no-keep-path', removed: [] }

  let listed
  try {
    const { data, error } = await client.storage.from('valid-ids').list(userId, { limit: 100 })
    if (error) return { ok: false, reason: 'list-failed', removed: [] }
    listed = data ?? []
  } catch {
    return { ok: false, reason: 'list-failed', removed: [] }
  }

  const stale = listed
    .map((o) => `${userId}/${o.name}`)
    .filter((p) => p !== keepPath)

  if (stale.length === 0) return { ok: true, removed: [] }

  try {
    const { error } = await client.storage.from('valid-ids').remove(stale)
    // A failed delete leaves unreferenced files and nothing else. The review
    // has already been recorded, so this is reported, not retried in a loop.
    if (error) return { ok: false, reason: 'remove-failed', removed: [] }
  } catch {
    return { ok: false, reason: 'remove-failed', removed: [] }
  }

  return { ok: true, removed: stale }
}

/**
 * Does this profile have a document waiting to be looked at?
 *
 * Mirrors the SQL the queue uses. Returns false when the columns are absent,
 * which is what happens before the migration is applied -- so the admin UI
 * can ship ahead of the database change without claiming anything.
 */
export function needsIdReview(profile) {
  const replaced = profile?.valid_id_replaced_at
  if (!replaced) return false
  const reviewed = profile?.valid_id_reviewed_at
  if (!reviewed) return true
  return new Date(reviewed) < new Date(replaced)
}

/** Whether the database has the re-review columns at all. */
export function idReviewSupported(profile) {
  return profile != null && 'valid_id_replaced_at' in profile
}
