/**
 * SMS notifications — the client's half.
 *
 * The message copy is NOT here. It is built in Postgres, in migration 16
 * (`sms_message_for_request` and `queue_announcement_sms`), because the body
 * is rendered once at queue time so the delivery log shows exactly what was
 * sent. A JavaScript twin of those sentences would drift within a month.
 *
 * What lives here is what only the browser needs: labels for the log, and the
 * arithmetic behind the confirmation dialog.
 */

/** Statuses that text the resident. Mirrors the trigger in migration 16. */
export const SMS_TRIGGER_STATUSES = ['approved', 'ready', 'released', 'rejected', 'scheduled']

/**
 * Written in the barangay's language rather than the queue's. Staff asking
 * "did it go out?" should not have to learn what `queued` means.
 */
export const SMS_STATUS = {
  queued: { label: 'Waiting to send', tone: 'pending' },
  sending: { label: 'Sending', tone: 'processing' },
  sent: { label: 'Sent', tone: 'approved' },
  failed: { label: 'Not delivered', tone: 'rejected' },
  skipped: { label: 'Not sent', tone: 'released' },
}

export function smsStatusLabel(status) {
  return SMS_STATUS[status]?.label ?? status
}

export function smsStatusTone(status) {
  return SMS_STATUS[status]?.tone ?? 'released'
}

/** The provider's hard limit. Everything about the pacing follows from it. */
export const SECONDS_PER_MESSAGE = 10

/**
 * How long a broadcast will actually take, in words.
 *
 * Staff need this before they tick the box, not after: one text every ten
 * seconds means a notice to five hundred residents is still going out an hour
 * and a half later.
 */
export function broadcastDuration(count) {
  const seconds = count * SECONDS_PER_MESSAGE
  if (seconds < 90) return 'under two minutes'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `about ${minutes} minutes`
  const hours = seconds / 3600
  return hours < 1.6 ? 'about an hour and a half' : `about ${Math.round(hours)} hours`
}

/**
 * A preview of the announcement text. This one sentence genuinely does need a
 * client twin so staff can see what they are about to send — keep it in step
 * with `queue_announcement_sms` in migration 16.
 */
export function announcementSmsPreview(title, label = 'Brgy Ilawod') {
  return `${label}: ${String(title ?? '').slice(0, 105)}. Full notice on the E-Assist app.`
}
