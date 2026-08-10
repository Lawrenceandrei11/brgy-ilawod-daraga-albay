import { statusBadge, statusLabel } from '../../lib/status'

/**
 * Badge — request lifecycle and identity states.
 *
 * The written label is never dropped. Colour alone must not carry the
 * meaning, so the badge still reads in greyscale and for colour-blind users.
 * Pass either `status` (looked up in REQUEST_STATUS) or an explicit `tone`.
 */
export function Badge({ status, tone, children, className = '', ...rest }) {
  const cls = status ? statusBadge(status) : `b-${tone ?? 'released'}`
  return (
    <span className={`badge ${cls} ${className}`.trim()} {...rest}>
      <i />
      {children ?? statusLabel(status)}
    </span>
  )
}

export default Badge
