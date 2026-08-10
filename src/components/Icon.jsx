/**
 * Icon system — ported from the prototype's inline SVG sprite.
 *
 * <IconSprite /> is rendered exactly once, at the app root. It defines every
 * <symbol>. <Icon name="scan" /> then references one by id, so the same path
 * data is downloaded once and reused everywhere.
 *
 * Adding an icon: add a <symbol id="i-yourname"> below and it is immediately
 * available as <Icon name="yourname" />.
 */

export const ICON_NAMES = [
  'scan', 'shield', 'lock', 'doc', 'home', 'dash', 'alert', 'incognito',
  'cal', 'search', 'mega', 'bell', 'user', 'pin', 'cam', 'check', 'x',
  'arrow', 'chev', 'menu', 'clock', 'brief', 'heart', 'users', 'print',
  'fp', 'logout', 'info',
]

export function Icon({ name, size, className = '', ...rest }) {
  const sizeClass = size === 'sm' ? ' ic-sm' : size === 'lg' ? ' ic-lg' : ''
  return (
    <svg className={`ic${sizeClass} ${className}`.trim()} aria-hidden="true" {...rest}>
      <use href={`#i-${name}`} />
    </svg>
  )
}

export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <symbol id="i-scan" viewBox="0 0 24 24">
          <path d="M3.4 8.4V6.2a2.8 2.8 0 0 1 2.8-2.8h2.2" />
          <path d="M15.6 3.4h2.2a2.8 2.8 0 0 1 2.8 2.8v2.2" />
          <path d="M20.6 15.6v2.2a2.8 2.8 0 0 1-2.8 2.8h-2.2" />
          <path d="M8.4 20.6H6.2a2.8 2.8 0 0 1-2.8-2.8v-2.2" />
          <path d="M9.2 10.6h.01" />
          <path d="M14.8 10.6h.01" />
          <path d="M9.4 14.8c.7.9 1.6 1.3 2.6 1.3s1.9-.4 2.6-1.3" />
        </symbol>
        <symbol id="i-shield" viewBox="0 0 24 24">
          <path d="M12 2.6 4.6 5.5v6.2c0 4.4 3.1 7.7 7.4 9.4 4.3-1.7 7.4-5 7.4-9.4V5.5z" />
          <path d="M9 11.8l2.3 2.3 4.2-4.4" />
        </symbol>
        <symbol id="i-lock" viewBox="0 0 24 24">
          <rect x="4.2" y="10.4" width="15.6" height="10.2" rx="2.4" />
          <path d="M8 10.4V7.6a4 4 0 0 1 8 0v2.8" />
        </symbol>
        <symbol id="i-doc" viewBox="0 0 24 24">
          <path d="M6 2.8h6.8l5 5v13.4a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1z" />
          <path d="M12.8 2.8v5h5" />
          <path d="M9 13h6" />
          <path d="M9 16.8h4.2" />
        </symbol>
        <symbol id="i-home" viewBox="0 0 24 24">
          <path d="M3.5 10.2 12 3.2l8.5 7v9.1a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" />
          <path d="M9.5 20.8v-6.3h5v6.3" />
        </symbol>
        <symbol id="i-dash" viewBox="0 0 24 24">
          <rect x="3.2" y="3.2" width="7.2" height="7.2" rx="1.8" />
          <rect x="13.6" y="3.2" width="7.2" height="5" rx="1.8" />
          <rect x="13.6" y="12.4" width="7.2" height="8.4" rx="1.8" />
          <rect x="3.2" y="13.6" width="7.2" height="7.2" rx="1.8" />
        </symbol>
        <symbol id="i-alert" viewBox="0 0 24 24">
          <path d="M10.6 3.9 2.5 18a1.6 1.6 0 0 0 1.4 2.4h16.2A1.6 1.6 0 0 0 21.5 18L13.4 3.9a1.6 1.6 0 0 0-2.8 0z" />
          <path d="M12 9.4v4.4" />
          <path d="M12 17.2h.01" />
        </symbol>
        <symbol id="i-incognito" viewBox="0 0 24 24">
          <path d="M3 12.6h18" />
          <path d="M8.6 12.6 10.2 8a1.4 1.4 0 0 1 1.3-.9h1a1.4 1.4 0 0 1 1.3.9l1.6 4.6" />
          <circle cx="7.4" cy="16.4" r="3.2" />
          <circle cx="16.6" cy="16.4" r="3.2" />
        </symbol>
        <symbol id="i-cal" viewBox="0 0 24 24">
          <rect x="3.2" y="4.8" width="17.6" height="16" rx="2.4" />
          <path d="M3.2 9.8h17.6" />
          <path d="M8.2 2.8v4" />
          <path d="M15.8 2.8v4" />
        </symbol>
        <symbol id="i-search" viewBox="0 0 24 24">
          <circle cx="10.8" cy="10.8" r="7" />
          <path d="M16 16l4.8 4.8" />
        </symbol>
        <symbol id="i-mega" viewBox="0 0 24 24">
          <path d="M3.2 10.8v2.8l13.6 5V5.8z" />
          <path d="M16.8 8.6a3.6 3.6 0 0 1 0 7.2" />
          <path d="M7.2 13.2v5.2a2 2 0 0 0 4 0v-3.8" />
        </symbol>
        <symbol id="i-bell" viewBox="0 0 24 24">
          <path d="M18 8.6a6 6 0 1 0-12 0c0 5.6-2.4 7.2-2.4 7.2h16.8S18 14.2 18 8.6z" />
          <path d="M10.2 19.2a2.1 2.1 0 0 0 3.6 0" />
        </symbol>
        <symbol id="i-user" viewBox="0 0 24 24">
          <circle cx="12" cy="8" r="4" />
          <path d="M4.4 20.6c0-3.7 3.4-6.1 7.6-6.1s7.6 2.4 7.6 6.1" />
        </symbol>
        <symbol id="i-pin" viewBox="0 0 24 24">
          <path d="M12 21.4s7-6.2 7-11.1a7 7 0 1 0-14 0c0 4.9 7 11.1 7 11.1z" />
          <circle cx="12" cy="10.2" r="2.6" />
        </symbol>
        <symbol id="i-cam" viewBox="0 0 24 24">
          <path d="M4 8.6h2.8l1.5-2.6h7.4l1.5 2.6H20a1.6 1.6 0 0 1 1.6 1.6v8.2a1.6 1.6 0 0 1-1.6 1.6H4a1.6 1.6 0 0 1-1.6-1.6v-8.2A1.6 1.6 0 0 1 4 8.6z" />
          <circle cx="12" cy="13.8" r="3.4" />
        </symbol>
        <symbol id="i-check" viewBox="0 0 24 24">
          <path d="M4.5 12.5l5 5 10-10" />
        </symbol>
        <symbol id="i-x" viewBox="0 0 24 24">
          <path d="M6 6l12 12" />
          <path d="M18 6L6 18" />
        </symbol>
        <symbol id="i-arrow" viewBox="0 0 24 24">
          <path d="M4 12h15.2" />
          <path d="M13.4 6.2 19.2 12l-5.8 5.8" />
        </symbol>
        <symbol id="i-chev" viewBox="0 0 24 24">
          <path d="M9.6 5.4 16.2 12l-6.6 6.6" />
        </symbol>
        <symbol id="i-menu" viewBox="0 0 24 24">
          <path d="M3.4 7h17.2" />
          <path d="M3.4 12h17.2" />
          <path d="M3.4 17h17.2" />
        </symbol>
        <symbol id="i-clock" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="8.6" />
          <path d="M12 7.4V12l3.2 2" />
        </symbol>
        <symbol id="i-brief" viewBox="0 0 24 24">
          <rect x="2.8" y="7" width="18.4" height="13.8" rx="2.2" />
          <path d="M8.4 7V5.4a2 2 0 0 1 2-2h3.2a2 2 0 0 1 2 2V7" />
          <path d="M2.8 12.4h18.4" />
        </symbol>
        <symbol id="i-heart" viewBox="0 0 24 24">
          <path d="M12 20.8s-6.6-4.3-6.6-9a3.6 3.6 0 0 1 6.6-2 3.6 3.6 0 0 1 6.6 2c0 4.7-6.6 9-6.6 9z" />
        </symbol>
        <symbol id="i-users" viewBox="0 0 24 24">
          <circle cx="9.4" cy="8.2" r="3.6" />
          <path d="M2.8 20.4c0-3.4 3-5.6 6.6-5.6s6.6 2.2 6.6 5.6" />
          <path d="M16.4 5.2a3.4 3.4 0 0 1 0 6.4" />
          <path d="M18.2 14.8c2.2.7 3.4 2.5 3.4 5.4" />
        </symbol>
        <symbol id="i-print" viewBox="0 0 24 24">
          <path d="M12 4.4V16" />
          <path d="M7.6 11.6 12 16l4.4-4.4" />
          <path d="M4 20.4h16" />
        </symbol>
        <symbol id="i-fp" viewBox="0 0 24 24">
          <path d="M5.6 7.2a9 9 0 0 1 12.8 0" />
          <path d="M8 10.2a5.8 5.8 0 0 1 8 0" />
          <path d="M10.2 13.2a2.8 2.8 0 0 1 3.6 0" />
          <path d="M12 15.6v5.2" />
        </symbol>
        <symbol id="i-logout" viewBox="0 0 24 24">
          <path d="M14.6 4.4h3.6a2 2 0 0 1 2 2v11.2a2 2 0 0 1-2 2h-3.6" />
          <path d="M9.6 8 5.6 12l4 4" />
          <path d="M5.6 12h9" />
        </symbol>
        <symbol id="i-info" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11.2v5" />
          <path d="M12 7.8h.01" />
        </symbol>
      </defs>
    </svg>
  )
}

export default Icon
