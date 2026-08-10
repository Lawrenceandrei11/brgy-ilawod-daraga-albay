import { format, formatDistanceToNow, parseISO } from 'date-fns'

/** "06 Aug 2026" — the compact form used in tables. */
export function shortDate(value) {
  if (!value) return '—'
  const d = typeof value === 'string' ? parseISO(value) : value
  return format(d, 'dd MMM yyyy')
}

/** "14 August 2026" — the long form used on announcements. */
export function longDate(value) {
  if (!value) return '—'
  const d = typeof value === 'string' ? parseISO(value) : value
  return format(d, 'dd MMMM yyyy')
}

/** "10:00 AM" */
export function timeOnly(value) {
  if (!value) return '—'
  const d = typeof value === 'string' ? parseISO(value) : value
  return format(d, 'h:mm a')
}

/** "3 days ago" */
export function relative(value) {
  if (!value) return '—'
  const d = typeof value === 'string' ? parseISO(value) : value
  return formatDistanceToNow(d, { addSuffix: true })
}

/** Splits a date into the two lines the appointment chip renders. */
export function dayParts(value) {
  if (!value) return { day: '—', month: '' }
  const d = typeof value === 'string' ? parseISO(value) : value
  return { day: format(d, 'dd'), month: format(d, 'MMM') }
}

/** "₱50.00", or "Free" when there is no fee. */
export function peso(amount) {
  const n = Number(amount ?? 0)
  if (!n) return 'Free'
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** "₱50" — the shorter form used on service cards. */
export function pesoShort(amount) {
  const n = Number(amount ?? 0)
  if (!n) return 'Free'
  return `₱${n.toLocaleString('en-PH')}`
}

/** "Juan Miguel Dela Cruz" -> "Juan M. Dela Cruz" for tight spaces. */
export function shortName(full) {
  if (!full) return ''
  const parts = full.trim().split(/\s+/)
  if (parts.length < 3) return full
  const [first, middle, ...rest] = parts
  return `${first} ${middle[0]}. ${rest.join(' ')}`
}

/** First name only, for the dashboard greeting. */
export function firstName(full) {
  if (!full) return ''
  return full.trim().split(/\s+/)[0]
}

/** "1–2 days" from a processing_days integer. */
export function turnaround(days) {
  const n = Number(days ?? 0)
  if (!n) return 'Same day'
  return n === 1 ? '1 day' : `${n} days`
}
