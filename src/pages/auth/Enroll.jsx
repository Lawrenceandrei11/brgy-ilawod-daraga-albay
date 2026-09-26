import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'

import { supabase, friendlyError } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useFaceApi, descriptorDistance } from '../../components/biometric/useFaceApi'
import { FaceScanner, AngleStrip } from '../../components/biometric/FaceScanner'
import { Badge, Button, Card, Check, Notice, PngSlot, Stepper } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { shortDate } from '../../lib/formatters'
import { MainLogo } from '../../components/MainLogo'

const STEPS = ['Consent', 'Position', 'Capture', 'Done']

const ANGLES = [
  { key: 'center', label: 'Look straight', icon: 'user', prompt: 'Look straight at the camera and hold still.' },
  { key: 'left', label: 'Turn slightly left', icon: 'chev', prompt: 'Turn your head slightly to your left, about 15 degrees.' },
  { key: 'right', label: 'Turn slightly right', icon: 'chev', prompt: 'Now turn slightly to your right.' },
]

// A capture must agree with itself across consecutive frames before it counts.
// This is a cheap liveness signal: it rejects a hand wobbling a phone screen
// and it rejects the moment mid-blink or mid-turn. It does NOT defeat a
// steady printed photograph — see the limitation noted on screen.
const STABLE_FRAMES = 3
const STABLE_TOLERANCE = 0.34

export default function Enroll() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { profile } = useAuth()

  const [step, setStep] = useState(1)
  const [consent, setConsent] = useState(false)
  const [captured, setCaptured] = useState(0)
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState(null)
  const [saveError, setSaveError] = useState(null)

  const {
    videoRef, modelsReady, loadingModels, cameraOn,
    error: camError, startCamera, stopCamera, detectOnce,
  } = useFaceApi()

  // Live preview state, so the oval reacts while the resident lines up.
  const [faceFound, setFaceFound] = useState(false)
  const pollRef = useRef(null)

  /* ---- idle preview loop on the position and capture steps ---- */
  useEffect(() => {
    if (!cameraOn || busy || (step !== 2 && step !== 3)) return undefined

    let alive = true
    const tick = async () => {
      const r = await detectOnce()
      if (!alive) return
      setFaceFound(r.ok)
      if (!r.ok && r.reason) setHint(r.reason)
      else setHint(null)
    }
    pollRef.current = setInterval(tick, 700)
    tick()

    return () => {
      alive = false
      clearInterval(pollRef.current)
    }
  }, [cameraOn, busy, step, detectOnce])

  /* ---- move between steps ---- */
  const goStep = useCallback(
    async (n) => {
      setSaveError(null)
      setHint(null)
      if (n === 2 && !cameraOn) {
        const ok = await startCamera()
        if (!ok) return
      }
      if (n <= 2) setCaptured(0)
      if (n === 4) stopCamera()
      setStep(n)
    },
    [cameraOn, startCamera, stopCamera]
  )

  /* ---- capture one angle ---- */
  async function captureAngle() {
    if (busy || captured >= ANGLES.length) return
    setBusy(true)
    setSaveError(null)

    try {
      // Collect consecutive agreeing frames.
      const samples = []
      const deadline = Date.now() + 12000

      while (samples.length < STABLE_FRAMES && Date.now() < deadline) {
        const r = await detectOnce()

        if (!r.ok) {
          setHint(r.reason)
          samples.length = 0 // a bad frame breaks the run
          await new Promise((res) => setTimeout(res, 260))
          continue
        }

        if (samples.length > 0) {
          const drift = descriptorDistance(samples[samples.length - 1], r.descriptor)
          if (drift > STABLE_TOLERANCE) {
            setHint('Hold still for a moment longer.')
            samples.length = 0
            samples.push(r.descriptor)
            await new Promise((res) => setTimeout(res, 220))
            continue
          }
        }

        samples.push(r.descriptor)
        setHint(null)
        await new Promise((res) => setTimeout(res, 200))
      }

      if (samples.length < STABLE_FRAMES) {
        setSaveError(
          'Could not get a steady reading. Find brighter light, hold the device still, and try again.'
        )
        setBusy(false)
        return
      }

      // Average the agreeing frames — a mean descriptor is a little more
      // robust than any single frame.
      const mean = samples[0].map(
        (_, i) => samples.reduce((sum, s) => sum + s[i], 0) / samples.length
      )

      // Goes through the RPC, not a table insert: face_templates denies
      // SELECT to every client, so a direct insert could not return anything
      // and could not be validated.
      const { error } = await supabase.rpc('enroll_face', {
        p_angle: ANGLES[captured].key,
        p_descriptor: mean,
      })
      if (error) throw error

      const next = captured + 1
      setCaptured(next)

      if (next === ANGLES.length) {
        queryClient.invalidateQueries({ queryKey: ['face-enrollment'] })
        setTimeout(() => goStep(4), 700)
      }
    } catch (err) {
      setSaveError(friendlyError(err, 'That capture could not be saved. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  /* ---- scanner presentation ---- */
  const scannerState = (() => {
    if (step === 4) return 'verified'
    if (step === 1 || !cameraOn) return 'permission'
    if (busy) return 'verifying'
    if (faceFound) return 'detected'
    if (step === 3) return 'scanning'
    return 'ready'
  })()

  const scannerTitle = (() => {
    if (step === 4) return 'Enrollment complete'
    if (step === 1) return 'Camera not started'
    if (!cameraOn) return 'Camera not started'
    if (busy) return `Capturing ${ANGLES[captured]?.label.toLowerCase() ?? ''}…`
    if (hint) return hint
    if (faceFound) return 'Face detected — hold still'
    return 'Align your face inside the outline'
  })()

  const scannerSub = (() => {
    if (step === 4) return 'Template stored securely'
    if (step === 1) return 'Read the privacy notice first'
    if (busy) return 'Keep still while we take the reading'
    if (step === 3) return ANGLES[captured]?.prompt
    return 'Then start capturing'
  })()

  return (
    <div className="auth">
      <div className="auth-left">
        <Link to="/app" className="lockup">
          <MainLogo className="seal" pill quiet onDark />
          <div>
            <b>BARANGAY E-ASSIST</b>
            <span>Facial biometric enrollment</span>
          </div>
        </Link>

        <FaceScanner
          state={scannerState}
          videoRef={videoRef}
          title={scannerTitle}
          subtitle={scannerSub}
          style={{ maxWidth: 440, margin: '0 auto', width: '100%' }}
        />

        <AngleStrip angles={ANGLES} captured={captured} />

        {camError && (
          <Notice tone="danger" icon="alert" title="Camera problem">
            {camError}
          </Notice>
        )}
      </div>

      <div className="auth-right">
        <Stepper steps={STEPS} current={step} />

        {saveError && (
          <Notice tone="danger" icon="alert" title="Capture failed">
            {saveError}
          </Notice>
        )}

        {step === 1 && (
          <div>
            <h1 className="auth-h1" style={{ marginBottom: 12 }}>
              Before we turn on the camera
            </h1>
            <p className="auth-sub" style={{ marginBottom: 22 }}>
              Read this, then give your consent. You can withdraw it at any time and go back to
              signing in with your password.
            </p>

            <div className="stack" style={{ gap: 14, marginBottom: 24 }}>
              <Notice icon="shield" title="A template, not a photograph">
                Three captures are converted into a list of 128 numbers. The images are discarded
                immediately and never leave your device. The template is not a photograph and
                cannot be used to reproduce a recognisable picture of you by ordinary means.
              </Notice>
              <Notice tone="quiet" icon="lock" title="Used only to confirm it is you">
                Your template is used for signing in and for releasing documents at the barangay
                hall. It is not shared with other agencies and is not used for surveillance.
              </Notice>
              <Notice tone="quiet" icon="x" title="You can delete it">
                You can remove your enrollment yourself at any time from your profile page, and it
                is erased from the barangay record immediately.
              </Notice>
            </div>

            <div style={{ marginBottom: 22 }}>
              <Check
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                title="I consent to Barangay Ilawod enrolling my facial template"
                description="I confirm I have read how it is stored, used and deleted."
              />
            </div>

            <Button
              block
              icon="cam"
              disabled={!consent || !modelsReady}
              onClick={() => goStep(2)}
            >
              {loadingModels
                ? 'Loading face recognition…'
                : !modelsReady
                  ? 'Face recognition unavailable'
                  : 'Turn on the camera'}
            </Button>
          </div>
        )}

        {step === 2 && (
          <div>
            <h1 className="auth-h1" style={{ marginBottom: 12 }}>
              Get into position
            </h1>
            <p className="auth-sub" style={{ marginBottom: 22 }}>
              A good first capture makes every future sign-in faster. Check these four things
              before you start.
            </p>

            <div className="grid-2" style={{ marginBottom: 24 }}>
              {[
                ['cam', 'Face a light source', 'Stand facing a window or lamp, not with it behind you.'],
                ['user', 'Uncover your face', 'Remove hats, sunglasses and face masks. Clear glasses are fine.'],
                ['scan', 'Fill the outline', 'Hold the device at arm’s length so your face fills the oval.'],
                ['users', 'Be alone in frame', 'Only one face may be visible during enrollment.'],
              ].map(([icon, title, body]) => (
                <Card key={title} padded style={{ padding: 20 }}>
                  <Icon name={icon} size="lg" style={{ color: 'var(--primary-600)', marginBottom: 10 }} />
                  <b style={{ display: 'block', fontSize: 15, color: 'var(--ink-900)', marginBottom: 4 }}>
                    {title}
                  </b>
                  <span style={{ fontSize: 13.5, color: 'var(--ink-500)' }}>{body}</span>
                </Card>
              ))}
            </div>

            <div className="stack" style={{ gap: 12 }}>
              <Button block onClick={() => goStep(3)} disabled={!cameraOn}>
                I'm in position — start capturing
              </Button>
              <Button block variant="ghost" onClick={() => goStep(1)}>
                Back to the privacy notice
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h1 className="auth-h1" style={{ marginBottom: 12 }}>
              Capturing your face
            </h1>
            <p className="auth-sub" style={{ marginBottom: 22 }}>
              Three angles, so the system still recognises you when you tilt your head or the light
              changes. Follow the highlighted prompt.
            </p>

            <Card padded style={{ padding: 22, marginBottom: 22 }}>
              <div className="row" style={{ gap: 12, marginBottom: 14 }}>
                <b style={{ fontSize: 15, color: 'var(--ink-900)' }}>Capture progress</b>
                <Badge tone="processing" style={{ marginLeft: 'auto' }}>
                  {Math.min(captured + 1, ANGLES.length)} of {ANGLES.length}
                </Badge>
              </div>
              <div className="progress">
                <div style={{ width: `${Math.max((captured / ANGLES.length) * 100, 8)}%` }} />
              </div>
              <p style={{ fontSize: 13.5, color: 'var(--ink-500)', marginTop: 14 }}>
                {captured < ANGLES.length ? ANGLES[captured].prompt : 'All three angles captured.'}
              </p>
            </Card>

            <div className="stack" style={{ gap: 12 }}>
              <Button block icon="cam" onClick={captureAngle} disabled={busy || !cameraOn}>
                {busy ? 'Hold still…' : 'Capture this angle'}
              </Button>
              <Button block variant="ghost" onClick={() => goStep(2)} disabled={busy}>
                Start over
              </Button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <Badge tone="verified" style={{ marginBottom: 16 }}>
              Enrollment complete
            </Badge>
            <h1 className="auth-h1" style={{ marginBottom: 12 }}>
              Your face is enrolled
            </h1>
            <p className="auth-sub" style={{ marginBottom: 22 }}>
              You can now sign in by looking at the camera. Your enrollment is pending a one-time
              confirmation by the barangay secretary before it can be used to collect documents in
              person.
            </p>

            <Card flush style={{ marginBottom: 22 }}>
              <div className="row" style={{ gap: 14, padding: '18px 22px', borderBottom: '1px solid var(--ink-100)' }}>
                <PngSlot name="resident-placeholder.png" className="av" pill quiet style={{ width: 52, height: 52 }} />
                <div className="grow">
                  <b style={{ display: 'block', fontSize: 15, color: 'var(--ink-900)', fontFamily: 'var(--display)' }}>
                    {profile?.full_name}
                  </b>
                  <span style={{ fontSize: 13, color: 'var(--ink-400)' }}>
                    Resident ID · {profile?.resident_id ?? 'pending'}
                    {profile?.purok ? ` · Purok ${profile.purok}` : ''}
                  </span>
                </div>
              </div>
              <div className="row" style={{ gap: 14, padding: '18px 22px', flexWrap: 'wrap' }}>
                <Icon name="shield" style={{ color: 'var(--success-500)' }} />
                <span style={{ fontSize: 13.5, color: 'var(--ink-600)' }}>
                  Template stored {shortDate(new Date())} · {ANGLES.length} angles captured
                </span>
                <Badge tone="pending" style={{ marginLeft: 'auto' }}>
                  Awaiting confirmation
                </Badge>
              </div>
            </Card>

            <Notice tone="quiet" icon="info" title="One honest limitation">
              Face sign-in checks that a face matches your template. It does not prove the face is
              physically present — a steady printed photograph can defeat it. That is why
              collecting a document at the hall still needs the secretary's in-person confirmation.
            </Notice>

            <div className="stack" style={{ gap: 12, marginTop: 22 }}>
              <Button block iconRight="arrow" onClick={() => navigate('/app')}>
                Go to my dashboard
              </Button>
              <Button block variant="secondary" to="/login/face">
                Try signing in with my face
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
