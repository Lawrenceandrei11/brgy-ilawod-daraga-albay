import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { supabase } from '../../lib/supabase'
import { useFaceApi, descriptorDistance } from '../../components/biometric/useFaceApi'
import { FaceScanner } from '../../components/biometric/FaceScanner'
import { Badge, Button, Card, Notice, PngSlot } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { MainLogo } from '../../components/MainLogo'

/**
 * Face sign-in.
 *
 * The seven states from the prototype are all here, but each transition is
 * caused by something real: `detected` means a face was actually found in the
 * frame, `verifying` means the descriptor is in flight to the Edge Function,
 * and `verified` means Postgres returned a match inside the distance
 * threshold and a session was minted.
 */

const STABLE_FRAMES = 3
const STABLE_TOLERANCE = 0.34

export default function FaceLogin() {
  const navigate = useNavigate()

  const {
    videoRef, modelsReady, loadingModels, cameraOn,
    error: camError, setError: setCamError, startCamera, stopCamera, detectOnce,
  } = useFaceApi()

  const [state, setState] = useState('permission')
  const [hint, setHint] = useState(null)
  const [result, setResult] = useState(null)   // { full_name, resident_id, confidence }
  const [failure, setFailure] = useState(null) // { message, attempts, maxAttempts, locked }

  const scanningRef = useRef(false)
  const pollRef = useRef(null)

  /* ---- idle preview: look for a face, but do not verify yet ---- */
  useEffect(() => {
    if (!cameraOn || state !== 'scanning') return undefined

    let alive = true
    const tick = async () => {
      if (scanningRef.current) return
      const r = await detectOnce()
      if (!alive) return
      if (r.ok) {
        setHint(null)
        setState('detected')
      } else {
        setHint(r.reason)
      }
    }
    pollRef.current = setInterval(tick, 600)
    tick()

    return () => {
      alive = false
      clearInterval(pollRef.current)
    }
  }, [cameraOn, state, detectOnce])

  /* ---- once a face is detected, verify it ---- */
  useEffect(() => {
    if (state !== 'detected' || scanningRef.current) return
    const t = setTimeout(() => verify(), 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const begin = useCallback(async () => {
    setFailure(null)
    setResult(null)
    const ok = await startCamera()
    if (ok) setState('scanning')
  }, [startCamera])

  async function verify() {
    if (scanningRef.current) return
    scanningRef.current = true
    setState('verifying')
    setHint(null)

    try {
      // Same multi-frame stability check as enrollment. It rejects motion
      // blur and half-turned heads; it does not defeat a printed photo.
      const samples = []
      const deadline = Date.now() + 10000

      while (samples.length < STABLE_FRAMES && Date.now() < deadline) {
        const r = await detectOnce()
        if (!r.ok) {
          samples.length = 0
          await new Promise((res) => setTimeout(res, 240))
          continue
        }
        if (samples.length && descriptorDistance(samples[samples.length - 1], r.descriptor) > STABLE_TOLERANCE) {
          samples.length = 0
          samples.push(r.descriptor)
          await new Promise((res) => setTimeout(res, 200))
          continue
        }
        samples.push(r.descriptor)
        await new Promise((res) => setTimeout(res, 180))
      }

      if (samples.length < STABLE_FRAMES) {
        setFailure({ message: 'Could not get a steady reading. Find better light and try again.' })
        setState('failed')
        return
      }

      const mean = samples[0].map((_, i) => samples.reduce((s, v) => s + v[i], 0) / samples.length)

      // Matching happens server-side. Only these 128 numbers leave the device.
      const { data, error } = await supabase.functions.invoke('face-login', {
        body: { descriptor: mean },
      })

      if (error) {
        // Non-2xx responses land here; read the body for the real message.
        let body = null
        try {
          body = await error.context?.json()
        } catch {
          /* keep the generic message */
        }
        setFailure({
          message: body?.error ?? 'Face sign-in is unavailable right now. Please use your password.',
          locked: body?.locked,
          attempts: body?.attempts,
          maxAttempts: body?.maxAttempts,
        })
        setState('failed')
        return
      }

      if (!data?.matched) {
        setFailure({
          message: data?.error ?? 'That face does not match any enrolled resident.',
          attempts: data?.attempts,
          maxAttempts: data?.maxAttempts,
        })
        setState('failed')
        return
      }

      // Exchange the one-time token for a real Supabase session.
      const { error: otpError } = await supabase.auth.verifyOtp({
        token_hash: data.token_hash,
        type: 'magiclink',
      })
      if (otpError) throw otpError

      setResult({ ...data.resident, confidence: data.confidence })
      setState('verified')
      stopCamera()
      setTimeout(() => navigate('/app', { replace: true }), 1400)
    } catch (err) {
      setFailure({ message: 'Face sign-in is unavailable right now. Please use your password.' })
      setState('failed')
      console.error(err)
    } finally {
      scanningRef.current = false
    }
  }

  function retry() {
    setFailure(null)
    setResult(null)
    setCamError(null)
    setState(cameraOn ? 'scanning' : 'permission')
  }

  /* ---- captions ---- */
  const COPY = {
    permission: ['Camera access needed', 'Nothing is recorded until you allow it'],
    scanning: [hint ?? 'Align your face inside the outline', 'Verification takes about two seconds'],
    detected: ['Face detected', 'Stay where you are'],
    verifying: ['Verifying your identity', 'Matching against the barangay record'],
    verified: ['Identity verified', 'Opening your dashboard'],
    failed: ['Face not recognised', 'Try again or sign in another way'],
  }
  const [capTitle, capSub] = COPY[state] ?? COPY.permission

  return (
    <div className="auth">
      <div className="auth-left">
        <Link to="/" className="lockup">
          <MainLogo className="seal" pill quiet onDark />
          <div>
            <b>BARANGAY E-ASSIST</b>
            <span>Barangay Ilawod</span>
          </div>
        </Link>

        <FaceScanner
          state={state}
          videoRef={videoRef}
          title={capTitle}
          subtitle={capSub}
          style={{ maxWidth: 440, margin: '0 auto', width: '100%' }}
        />

        <Notice tone="onDark" icon="shield" title="Your photograph is never stored">
          The camera produces a list of 128 numbers that is compared with the one held in your
          barangay record. The images themselves never leave this device, and are discarded the
          moment matching finishes.
        </Notice>
      </div>

      <div className="auth-right">
        <div>
          <span className="eyebrow">Resident sign-in</span>
          <h1 className="auth-h1" style={{ margin: '14px 0 12px' }}>
            {state === 'verified'
              ? `Welcome back, ${result?.full_name?.split(' ')[0] ?? ''}.`
              : state === 'failed'
                ? "We couldn't recognise your face"
                : state === 'verifying'
                  ? 'Verifying your identity'
                  : state === 'permission'
                    ? 'Look at the camera to sign in'
                    : 'Scanning your face'}
          </h1>
          <p className="auth-sub">
            {state === 'verified'
              ? 'Opening your dashboard now.'
              : state === 'failed'
                ? failure?.message
                : state === 'verifying'
                  ? 'Comparing your face template with the one held in the Barangay Ilawod resident record.'
                  : 'Barangay E-Assist recognises you from your enrolled face. Keep your whole face inside the outline, with nothing covering it.'}
          </p>
        </div>

        {camError && (
          <Notice tone="danger" icon="alert" title="Camera problem">
            {camError}
          </Notice>
        )}

        {state === 'verified' && result && (
          <Card padded style={{ padding: '18px 20px', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <PngSlot name="resident-placeholder.png" pill quiet style={{ width: 52, height: 52 }} />
            <div style={{ flex: 1, minWidth: 140 }}>
              <b style={{ display: 'block', fontFamily: 'var(--display)', fontSize: 15.5, color: 'var(--ink-900)' }}>
                {result.full_name}
              </b>
              <span style={{ fontSize: 13, color: 'var(--ink-400)' }}>
                Resident ID · {result.resident_id}
              </span>
            </div>
            <Badge tone="verified">Match {result.confidence}%</Badge>
          </Card>
        )}

        {state === 'failed' && failure?.attempts != null && (
          <Notice
            tone="danger"
            icon="alert"
            title={
              failure.locked
                ? 'Face sign-in temporarily locked'
                : `Attempt ${failure.attempts} of ${failure.maxAttempts}`
            }
          >
            {failure.locked
              ? 'Use your password to sign in. Nothing has happened to your account.'
              : `After ${failure.maxAttempts} failed attempts, face sign-in locks for a while and you'll need your password. Nothing happens to your account.`}
          </Notice>
        )}

        <div className="stack" style={{ gap: 12 }}>
          {state === 'permission' && (
            <Button block icon="cam" onClick={begin} disabled={!modelsReady}>
              {loadingModels
                ? 'Loading face recognition…'
                : !modelsReady
                  ? 'Face recognition unavailable'
                  : 'Allow camera access'}
            </Button>
          )}

          {(state === 'scanning' || state === 'detected') && (
            <Button block variant="secondary" icon="x" onClick={() => { stopCamera(); setState('permission') }}>
              Stop scanning
            </Button>
          )}

          {state === 'verifying' && (
            <Button block variant="secondary" disabled>
              Verifying…
            </Button>
          )}

          {state === 'failed' && (
            <Button block icon="scan" onClick={retry}>
              Try scanning again
            </Button>
          )}

          {state === 'verified' && (
            <Button block iconRight="arrow" to="/app">
              Go to my dashboard
            </Button>
          )}
        </div>

        {state !== 'verified' && (
          <>
            <div className="auth-divider">
              <span className="rule" /> or <span className="rule" />
            </div>

            <div className="stack" style={{ gap: 12 }}>
              <Button to="/login" variant="secondary" block icon="lock">
                Sign in with my password
              </Button>
              <Button to="/register" variant="ghost" block>
                I don't have an account yet
              </Button>
            </div>
          </>
        )}

        <p style={{ fontSize: 13, color: 'var(--ink-400)', borderTop: '1px solid var(--ink-100)', paddingTop: 20 }}>
          <Icon name="info" size="sm" style={{ verticalAlign: '-3px', marginRight: 6 }} />
          Face sign-in confirms your face matches your enrolled template. Collecting a document at
          the barangay hall still requires the secretary's in-person check.
        </p>
      </div>
    </div>
  )
}
