/**
 * Which way a head is turned, from the face landmarks that detection already
 * computes. Pure arithmetic and no imports, so it can be reasoned about and
 * tested on its own.
 *
 * Enrollment wants three genuinely different views of a face. Without a check
 * on the turn, an automatic capture would take three readings of whatever the
 * resident happened to be doing -- most likely three near-identical
 * straight-on shots, which is a worse template than one good one. This is
 * what lets the left and right steps wait for an actual turn.
 *
 * ---------------------------------------------------------------------------
 * A note on which way is left, because it is easy to get backwards.
 *
 * The preview is mirrored in CSS so that moving left moves left on screen,
 * but face-api reads the video element's own frames, which are NOT mirrored.
 * In those raw frames the resident's left side appears on the right of the
 * image. So when a resident turns their head to their own left, the nose
 * moves towards the right of the image, and the number below goes up.
 *
 *   yaw > 0  ->  turned to the resident's own LEFT
 *   yaw < 0  ->  turned to the resident's own RIGHT
 * ---------------------------------------------------------------------------
 */

/** Facing the camera is never perfectly 0, so "straight" is a band. */
export const YAW_CENTRE_MAX = 0.12

/** A turn has to be deliberate to count; a glance should not trigger it. */
export const YAW_TURN_MIN = 0.16

/**
 * Past roughly this, one eye is disappearing behind the nose and the landmark
 * positions -- and with them the descriptor -- get unreliable. A profile shot
 * is a worse enrollment than a three-quarter one, so it is refused.
 */
export const YAW_TURN_MAX = 0.8

/** Mean of a list of {x, y} landmark points. */
export function centre(points) {
  const n = points.length
  if (!n) return { x: 0, y: 0 }
  let x = 0
  let y = 0
  for (const p of points) {
    x += p.x
    y += p.y
  }
  return { x: x / n, y: y / n }
}

/**
 * How far the nose sits from the midpoint between the eyes, measured in
 * eye-widths so it does not change with how close the resident is sitting or
 * how large their face is.
 */
export function faceYaw(noseTip, leftEyePoints, rightEyePoints) {
  const left = centre(leftEyePoints)
  const right = centre(rightEyePoints)
  const span = Math.abs(right.x - left.x)
  // Two eyes on top of each other means the landmarks are nonsense; call it
  // straight ahead rather than dividing by nearly zero and reporting a wild
  // turn that would hold up the capture forever.
  if (span < 1) return 0
  const eyeMidX = (left.x + right.x) / 2
  return (noseTip.x - eyeMidX) / span
}

/** Is the head being held at the angle this step is asking for? */
export function angleHeld(key, yaw) {
  if (typeof yaw !== 'number' || Number.isNaN(yaw)) return false
  if (key === 'centre' || key === 'center') return Math.abs(yaw) <= YAW_CENTRE_MAX
  if (key === 'left') return yaw >= YAW_TURN_MIN && yaw <= YAW_TURN_MAX
  if (key === 'right') return yaw <= -YAW_TURN_MIN && yaw >= -YAW_TURN_MAX
  return false
}

/**
 * What to tell a resident whose face is detected but not yet at the angle
 * being asked for. Says what to do, never what is wrong.
 */
export function turnHint(key, yaw) {
  if (key === 'center' || key === 'centre') {
    return 'Look straight at the camera.'
  }
  if (key === 'left') {
    if (yaw > YAW_TURN_MAX) return 'A little less — turn back towards the camera slightly.'
    return 'Turn your head slightly to the left.'
  }
  if (key === 'right') {
    if (yaw < -YAW_TURN_MAX) return 'A little less — turn back towards the camera slightly.'
    return 'Turn your head slightly to the right.'
  }
  return null
}
