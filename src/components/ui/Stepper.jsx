/**
 * Stepper — the numbered progress rail used by registration and enrollment.
 *
 * `steps` is an array of labels; `current` is the 1-based active step.
 * Labels hide below 900px (the dots remain), matching the prototype.
 */
export function Stepper({ steps, current }) {
  return (
    <div className="stepper" role="list" aria-label={`Step ${current} of ${steps.length}`}>
      {steps.map((label, i) => {
        const n = i + 1
        const state = n < current ? 'done' : n === current ? 'now' : ''
        return (
          <div key={label} style={{ display: 'contents' }}>
            <div
              className={`s ${state}`.trim()}
              role="listitem"
              aria-current={n === current ? 'step' : undefined}
            >
              <span className="dot">{n < current ? '✓' : n}</span>
              <b>{label}</b>
            </div>
            {n < steps.length && <span className="bar" aria-hidden="true" />}
          </div>
        )
      })}
    </div>
  )
}

export default Stepper
