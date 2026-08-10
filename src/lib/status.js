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
