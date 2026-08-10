import { Icon } from '../Icon'

/**
 * Empty, loading and error states.
 *
 * Every list in the app routes through these three so a resident never sees
 * a blank panel with no explanation of why it is blank.
 */

export function EmptyState({ icon = 'doc', title, children, action }) {
  return (
    <div className="empty">
      <Icon name={icon} size="lg" />
      <b>{title}</b>
      {children && <p>{children}</p>}
      {action && <div style={{ marginTop: 18 }}>{action}</div>}
    </div>
  )
}

export function LoadingRows({ rows = 3, height = 52 }) {
  return (
    <div className="stack" style={{ gap: 10, padding: 20 }} aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </div>
  )
}

export function ErrorState({ title = 'Something went wrong', children, onRetry }) {
  return (
    <div className="empty">
      <Icon name="alert" size="lg" style={{ color: 'var(--danger-500)' }} />
      <b>{title}</b>
      <p>{children ?? 'The barangay server did not respond. Check your connection and try again.'}</p>
      {onRetry && (
        <div style={{ marginTop: 18 }}>
          <button className="btn btn-m btn-secondary btn-auto" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
    </div>
  )
}
