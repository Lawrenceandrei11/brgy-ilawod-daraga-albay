import { Icon } from '../Icon'

/**
 * Notice — the boxed callout used for privacy notices, consent explanations
 * and inline warnings.
 *
 * tone: info (default) | quiet | onDark | danger
 */
export function Notice({ icon = 'info', title, tone = 'info', children, className = '', ...rest }) {
  const toneClass =
    tone === 'onDark' ? 'on-dark' : tone === 'quiet' ? 'quiet' : tone === 'danger' ? 'danger' : ''
  return (
    <div className={`notice ${toneClass} ${className}`.trim()} {...rest}>
      <Icon name={icon} />
      <div>
        {title && <b>{title}</b>}
        {typeof children === 'string' ? <p>{children}</p> : children}
      </div>
    </div>
  )
}

export default Notice
