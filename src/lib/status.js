/**
 * Request lifecycle — the single source of truth.
 *
 * These eight states are exactly the badges drawn in the prototype's
 * component sheet, and they are also the `request_status` enum in Postgres.
 * Keeping design, database and UI on one list is deliberate: if a status is
 * added, it must be added here, in the migration, and in Figma together.
 */

export const REQUEST_STATUS = {
  pending: {
    label: 'Pending review',
    badge: 'b-pending',
    resident: 'Filed and waiting for the barangay secretary to pick it up.',
  },
  processing: {
    label: 'Processing',
    badge: 'b-processing',
    resident: 'A barangay official is working on your request now.',
  },
  approved: {
    label: 'Approved',
    badge: 'b-approved',
    resident: 'Approved. The document is being prepared for release.',
  },
  ready: {
    label: 'Ready for pickup',
    badge: 'b-ready',
    resident: 'Ready to collect at the barangay hall. Bring a valid ID.',
  },
  released: {
    label: 'Released',
    badge: 'b-released',
    resident: 'Collected. This request is complete.',
  },
  rejected: {
    label: 'Needs correction',
    badge: 'b-rejected',
    resident: 'Something needs fixing — see the remarks and re-submit.',
  },
  scheduled: {
    label: 'Scheduled',
    badge: 'b-scheduled',
    resident: 'An appointment has been set for this request.',
  },
}

/** Statuses a request can move to from its current one. Enforced in the admin UI. */
export const STATUS_TRANSITIONS = {
  pending: ['processing', 'rejected'],
  processing: ['approved', 'rejected'],
  approved: ['ready', 'scheduled'],
  scheduled: ['ready'],
  ready: ['released'],
  released: [],
  rejected: ['pending'],
}

/**
 * Which desk each move belongs to (migration 28).
 *
 * STATUS_TRANSITIONS above says what a request CAN do; this says who may do
 * it. The barangay works in three hands -- the secretary checks, the Punong
 * Barangay approves, the treasurer takes payment and releases -- and the
 * captain's permissions are cumulative so one official being away cannot
 * stop the queue.
 *
 * This is the courtesy copy. The rule itself lives in guard_request_columns(),
 * so hiding a button here is not what stops anyone.
 */
const SECRETARY_MOVES = ['pending>processing', 'pending>rejected', 'rejected>pending']
const CAPTAIN_MOVES = ['processing>approved', 'processing>rejected']
const TREASURER_MOVES = [
  'approved>ready',
  'approved>scheduled',
  'scheduled>ready',
  'ready>released',
]

export const ROLE_MOVES = {
  secretary: SECRETARY_MOVES,
  treasurer: TREASURER_MOVES,
  captain: [...SECRETARY_MOVES, ...CAPTAIN_MOVES, ...TREASURER_MOVES],
}

/** The moves this role may make from this status, in the order they appear. */
export function allowedNext(status, role) {
  const mine = ROLE_MOVES[role] ?? []
  return (STATUS_TRANSITIONS[status] ?? []).filter((next) => mine.includes(`${status}>${next}`))
}

/** Whose step this is, for telling staff why there is nothing to press. */
export function whoseStep(status) {
  const next = STATUS_TRANSITIONS[status] ?? []
  if (next.length === 0) return null
  if (next.some((n) => CAPTAIN_MOVES.includes(`${status}>${n}`))) return 'the Punong Barangay'
  if (next.some((n) => TREASURER_MOVES.includes(`${status}>${n}`))) return 'the barangay treasurer'
  return 'the barangay secretary'
}

/** Only the treasurer takes money; the captain may cover that desk. */
export function canRecordPayment(role) {
  return role === 'treasurer' || role === 'captain'
}

/** Where each role's work waits, so the queue opens on their own stage. */
export const ROLE_HOME_TAB = {
  secretary: 'pending',
  captain: 'processing',
  treasurer: 'approved',
}

/** Statuses that still need someone to act. Drives the dashboard counts. */
export const OPEN_STATUSES = ['pending', 'processing', 'approved', 'scheduled', 'ready']

export function statusLabel(status) {
  return REQUEST_STATUS[status]?.label ?? status
}

export function statusBadge(status) {
  return REQUEST_STATUS[status]?.badge ?? 'b-released'
}

/** Identity-verification badge used on the dashboard and login result. */
export const VERIFIED_BADGE = { label: 'Identity verified', badge: 'b-verified' }
