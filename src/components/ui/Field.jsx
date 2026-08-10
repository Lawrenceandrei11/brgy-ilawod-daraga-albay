import { forwardRef, useId } from 'react'

/**
 * Field — mirrors the Figma Field / Text Input component.
 *
 * Wraps a label, control, and either help text or an error message. The error
 * replaces the help text rather than stacking below it, matching the
 * prototype, and it is announced to screen readers via role="alert".
 *
 * Designed to work with react-hook-form: spread `register('name')` onto it.
 */
export const Field = forwardRef(function Field(
  {
    label,
    hint,
    help,
    error,
    required = false,
    as = 'input',
    children,
    className = '',
    id: idProp,
    ...rest
  },
  ref
) {
  const autoId = useId()
  const id = idProp ?? autoId
  const Control = as
  const describedBy = `${id}-desc`

  return (
    <div className={`field ${error ? 'has-error' : ''} ${className}`.trim()}>
      {label && (
        <label htmlFor={id}>
          {label}
          {(required || hint) && (
            <em style={required ? { color: error ? 'var(--danger-500)' : undefined } : undefined}>
              {hint ?? 'required'}
            </em>
          )}
        </label>
      )}

      <Control
        id={id}
        ref={ref}
        className="control"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error || help ? describedBy : undefined}
        {...rest}
      >
        {children}
      </Control>

      {(error || help) && (
        <span
          id={describedBy}
          className={`help ${error ? 'help-err' : ''}`.trim()}
          role={error ? 'alert' : undefined}
        >
          {error || help}
        </span>
      )}
    </div>
  )
})

/** Checkbox with a bold headline and a quieter explanatory line beneath it. */
export const Check = forwardRef(function Check({ title, description, ...rest }, ref) {
  return (
    <label className="check">
      <input type="checkbox" ref={ref} {...rest} />
      <span>
        <b>{title}</b>
        {description && <span>{description}</span>}
      </span>
    </label>
  )
})

export default Field
