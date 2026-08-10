import { useCallback, useEffect, useRef, useState } from 'react'
import * as faceapi from '@vladmandic/face-api'

/**
 * Webcam + face recognition.
 *
 * What actually happens here: the browser reads frames from the camera,
 * face-api locates a face and converts it into a 128-number descriptor, and
 * that array of numbers is all that ever leaves this hook. The video frames
 * are never uploaded, never written to disk, and are discarded as soon as the
 * next frame replaces them.
 *
 * Models are served from /public/models rather than a CDN so the system still
 * works with no internet — which is the realistic condition in a barangay
 * hall, and on defence day.
 */

const MODEL_URL = '/models'

// Tuned for a laptop webcam at arm's length. 416 is the accuracy/speed
// sweet spot for tiny_face_detector; 224 misses faces that are slightly off
// centre, 608 costs frame rate for no real gain at this distance.
const DETECTOR_OPTIONS = new faceapi.TinyFaceDetectorOptions({
  inputSize: 416,
  scoreThreshold: 0.5,
})

let modelsPromise = null

/** Loads the three models once per page load, no matter how many components ask. */
function loadModels() {
  if (!modelsPromise) {
    modelsPromise = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]).catch((err) => {
      // Let a later attempt retry rather than caching the failure forever.
      modelsPromise = null
      throw err
    })
  }
  return modelsPromise
}

/**
 * Why a face was rejected. These are shown to residents, so they say what to
 * do rather than what went wrong internally.
 */
export const REJECT = {
  NO_FACE: 'No face in the frame — move into the outline.',
  MANY_FACES: 'More than one face is visible. Only you should be in frame.',
  TOO_SMALL: 'Move closer, so your face fills the outline.',
  OFF_CENTRE: 'Centre your face inside the outline.',
  LOW_CONFIDENCE: 'Hold still and make sure your whole face is lit.',
}

export function useFaceApi() {
  const videoRef = useRef(null)
  const streamRef = useRef(null)

  const [modelsReady, setModelsReady] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const [error, setError] = useState(null)
  const [loadingModels, setLoadingModels] = useState(false)

  /* ---------------- models ---------------- */
  useEffect(() => {
    let cancelled = false
    setLoadingModels(true)
    loadModels()
      .then(() => {
        if (!cancelled) setModelsReady(true)
      })
      .catch(() => {
        if (!cancelled) {
          setError(
            'The face recognition models could not be loaded. Reload the page, and if it keeps happening use your password to sign in.'
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingModels(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  /* ---------------- camera ---------------- */
  const startCamera = useCallback(async () => {
    setError(null)

    // getUserMedia only exists in a secure context. localhost counts as
    // secure; a plain-HTTP LAN address like http://192.168.1.5 does not, and
    // the API is simply absent rather than failing with a useful message.
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        window.isSecureContext
          ? 'This browser does not support camera access. Try Chrome or Edge.'
          : 'The camera only works over a secure connection. Open the site over HTTPS, or use localhost during testing.'
      )
      return false
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }

      setCameraOn(true)
      return true
    } catch (err) {
      // These names are the DOMException values the spec defines.
      const map = {
        NotAllowedError:
          'Camera access was blocked. Open the padlock icon in the address bar, set Camera to Allow, then reload.',
        PermissionDeniedError:
          'Camera access was blocked. Open the padlock icon in the address bar, set Camera to Allow, then reload.',
        NotFoundError:
          'No camera was found on this device. You can still sign in with your password.',
        DevicesNotFoundError:
          'No camera was found on this device. You can still sign in with your password.',
        NotReadableError:
          'The camera is already being used by another app. Close it and try again.',
        OverconstrainedError: 'This camera does not support the required video size.',
      }
      setError(map[err.name] ?? 'The camera could not be started. Please try again.')
      setCameraOn(false)
      return false
    }
  }, [])

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraOn(false)
  }, [])

  // Releasing the camera on unmount matters: the browser keeps the recording
  // indicator lit otherwise, which is exactly the kind of thing that makes
  // people distrust a biometric system.
  useEffect(() => () => stopCamera(), [stopCamera])

  /* ---------------- detection ---------------- */
  /**
   * Reads one frame and returns
   *   { ok: true, descriptor, score, box }
   *   { ok: false, reason }
   */
  const detectOnce = useCallback(async () => {
    const video = videoRef.current
    if (!video || video.readyState < 2 || !modelsReady) {
      return { ok: false, reason: REJECT.NO_FACE }
    }

    const results = await faceapi
      .detectAllFaces(video, DETECTOR_OPTIONS)
      .withFaceLandmarks()
      .withFaceDescriptors()

    if (results.length === 0) return { ok: false, reason: REJECT.NO_FACE }

    // Enrolling or verifying with two faces in shot is how you end up with a
    // template that belongs to nobody in particular.
    if (results.length > 1) return { ok: false, reason: REJECT.MANY_FACES }

    const [face] = results
    const { box, score } = face.detection

    if (score < 0.6) return { ok: false, reason: REJECT.LOW_CONFIDENCE }

    // The face should fill a reasonable share of the frame. Too small and the
    // descriptor is being computed from very few pixels, which is where false
    // matches come from.
    const frameArea = video.videoWidth * video.videoHeight
    if (frameArea > 0 && (box.width * box.height) / frameArea < 0.045) {
      return { ok: false, reason: REJECT.TOO_SMALL }
    }

    const cx = (box.x + box.width / 2) / video.videoWidth
    const cy = (box.y + box.height / 2) / video.videoHeight
    if (cx < 0.2 || cx > 0.8 || cy < 0.15 || cy > 0.85) {
      return { ok: false, reason: REJECT.OFF_CENTRE }
    }

    return { ok: true, descriptor: Array.from(face.descriptor), score, box }
  }, [modelsReady])

  return {
    videoRef,
    modelsReady,
    loadingModels,
    cameraOn,
    error,
    setError,
    startCamera,
    stopCamera,
    detectOnce,
  }
}

/** Euclidean distance between two descriptors. Lower means more alike. */
export function descriptorDistance(a, b) {
  let sum = 0
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i] - b[i]
    sum += d * d
  }
  return Math.sqrt(sum)
}
