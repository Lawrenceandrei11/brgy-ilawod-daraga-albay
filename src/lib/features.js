/**
 * Feature gates that must stay shut until someone deliberately opens them.
 *
 * Default-disabled on purpose: anything that reads "is this switched on?" has
 * to answer "no" unless a human has said otherwise, so that applying a
 * database migration can never be the thing that turns a workflow on.
 */

/**
 * Resident-side ID re-upload.
 *
 * Two independent conditions have to hold, and this is only the first:
 *
 *   1. VITE_ID_REUPLOAD === 'true'  -- a deliberate deployment decision
 *   2. the profiles table actually has valid_id_replaced_at, so a replacement
 *      can be queued for the secretary (see lib/idRetention.js)
 *
 * The migration satisfies (2) on its own. Without (1) it still stays shut,
 * which is the point: the schema change and the workflow going live are
 * separate decisions, taken at separate times.
 *
 * Anything other than the exact string 'true' is off -- '1', 'yes', 'TRUE '
 * and a missing variable all mean no.
 */
export function idReuploadEnabled(env = import.meta.env) {
  return String(env?.VITE_ID_REUPLOAD ?? '') === 'true'
}
