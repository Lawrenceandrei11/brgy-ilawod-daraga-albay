import { Link } from 'react-router-dom'
import { Icon } from '../Icon'

/**
 * Button — mirrors the Figma Button component set.
 *
 * variant: primary | secondary | ghost | accent | danger | onDark
 * size:    lg (default, 52px) | m (44px) | s (36px)
 *
 * Pass `to` to render a react-router <Link> that still looks like a button,
 * or `href` for an external anchor.
 */
export function Button({
  variant = 'primary',
  size,
  icon,
  iconRight,
  block = false,
  auto = false,
  to,
  href,
  children,
  className = '',
  ...rest
}) {
  const classes = [
    'btn',
    `btn-${variant}`,
    size === 'm' ? 'btn-m' : size === 's' ? 'btn-s' : '',
    block ? 'btn-block' : '',
    auto ? 'btn-auto' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const content = (
    <>
      {icon && <Icon name={icon} size={size === 's' ? 'sm' : undefined} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === 's' ? 'sm' : undefined} />}
    </>
  )

  if (to) {
    return (
      <Link to={to} className={classes} {...rest}>
        {content}
      </Link>
    )
  }
  if (href) {
    return (
      <a href={href} className={classes} {...rest}>
        {content}
      </a>
    )
  }
  return (
    <button type="button" className={classes} {...rest}>
      {content}
    </button>
  )
}

export default Button
