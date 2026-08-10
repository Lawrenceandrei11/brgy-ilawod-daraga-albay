import { Icon } from '../Icon'
import { PngSlot } from '../ui'

/**
 * The signature element — the facial biometric scanner.
 *
 * This is a presentational component. It owns none of the logic; the parent
 * drives `state` from real detection results. The seven states and all their
 * styling come straight from the approved prototype, so the built screen and
 * the Figma file still agree.
 *
 *   permission → ready → scanning → detected → verifying → verified
 *                                                        ↘ failed
 */

// Decorative mesh points, as a share of the face oval. Copied from the
// prototype so the lit-up mesh lands in the same places.
const MESH = [
  [50, 14], [26, 26], [74, 26], [18, 44], [82, 44], [50, 40], [36, 52], [64, 52],
  [24, 64], [76, 64], [50, 68], [38, 80], [62, 80], [50, 88], [30, 38], [70, 38],
]

const CAM_LABEL = {
  permission: ['Camera off', true],
  ready: ['Camera live', false],
  scanning: ['Scanning', false],
  detected: ['Face detected', false],
  verifying: ['Verifying', false],
  verified: ['Verified', false],
  failed: ['No match', false],
}

export function FaceScanner({
  state = 'permission',
  videoRef,
  title,
  subtitle,
  showMesh = true,
  className = '',
  style,
}) {
  const [camText, camOff] = CAM_LABEL[state] ?? CAM_LABEL.permission
  const cameraLive = !camOff

  return (
    <div
      className={`scanner ${cameraLive ? 'cam-on' : ''} ${className}`.trim()}
      data-state={state}
      style={style}
      role="img"
      aria-label={`${title}. ${subtitle ?? ''}`}
    >
      {/* The live feed sits beneath every overlay. muted + playsInline are
          both required for autoplay to be allowed on mobile Safari. */}
      <video ref={videoRef} autoPlay muted playsInline />

      <div className="grid-bg" />

      <div className={`cam-label ${camOff ? 'off' : ''}`.trim()}>
        <span className="live" />
        <span>{camText}</span>
      </div>

      {/* Stands in for the feed before the camera is allowed to start. */}
      {!cameraLive && (
        <PngSlot name="biometric-face.png" className="face-slot" onDark quiet />
      )}

      {showMesh && (
        <div className="mesh">
          {MESH.map(([left, top], i) => (
            <span
              key={`${left}-${top}`}
              style={{
                left: `${left}%`,
                top: `${top}%`,
                animation: 'meshIn .5s ease both',
                animationDelay: `${i * 28}ms`,
              }}
            />
          ))}
        </div>
      )}

      <div className="guide" />

      <div className="brackets">
        <i />
        <i />
        <i />
        <i />
      </div>

      <div className="scanline" />

      <div className="ring">
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="46" />
        </svg>
      </div>

      <div className="stamp">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <use href={state === 'failed' ? '#i-x' : '#i-check'} />
        </svg>
      </div>

      {/* aria-live so a screen-reader user hears the scan progressing rather
          than sitting in silence waiting for something to happen. */}
      <div className="caption" aria-live="polite">
        <b>{title}</b>
        {subtitle && <span>{subtitle}</span>}
      </div>
    </div>
  )
}

/**
 * The three-angle capture strip used during enrollment.
 * `captured` is how many angles are done; `angles` is the ordered list.
 */
export function AngleStrip({ angles, captured }) {
  return (
    <div className="angles">
      {angles.map((a, i) => {
        const done = i < captured
        const now = i === captured && captured < angles.length
        return (
          <div key={a.key} className={`angle ${done ? 'done' : ''} ${now ? 'now' : ''}`.trim()}>
            <div className="tick">
              <Icon name={done ? 'check' : a.icon} size="sm" />
            </div>
            {a.label}
          </div>
        )
      })}
    </div>
  )
}

export default FaceScanner
