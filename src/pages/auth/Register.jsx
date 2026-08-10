import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { supabase, friendlyError } from '../../lib/supabase'
import { Button, Card, Check, Field, Notice, PngSlot, Stepper } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { longDate } from '../../lib/formatters'

const STEPS = ['Personal details', 'Household & address', 'Review & submit']

const ID_TYPES = [
  "Philippine National ID (PhilSys)", "Driver's License", 'UMID / SSS', 'PhilHealth ID',
  'Passport', "Voter's ID", 'Postal ID', 'Senior Citizen ID', 'PWD ID', 'Student ID',
]

const CIVIL_STATUS = ['Single', 'Married', 'Widowed', 'Separated']

// Residents must be 15 or older, matching the note in the prototype.
const MIN_AGE = 15

function yearsSince(dateString) {
  const dob = new Date(dateString)
  const now = new Date()
  let age = now.getFullYear() - dob.getFullYear()
  const m = now.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1
  return age
}

const step1Schema = z
  .object({
    full_name: z.string().trim().min(4, 'Enter your full legal name as printed on your ID'),
    date_of_birth: z
      .string()
      .min(1, 'Enter your date of birth')
      .refine((v) => !Number.isNaN(Date.parse(v)), 'That is not a valid date')
      .refine((v) => new Date(v) <= new Date(), 'Date of birth cannot be in the future')
      .refine((v) => yearsSince(v) >= MIN_AGE, `You must be ${MIN_AGE} or older to register`),
    sex: z.string().min(1, 'Select your sex as recorded on your birth certificate'),
    civil_status: z.string().optional(),
    mobile: z
      .string()
      .trim()
      .regex(/^09\d{9}$/, 'Enter an 11-digit mobile number starting with 09'),
    email: z.string().trim().min(1, 'Enter your email address').email('That does not look like an email address'),
    password: z.string().min(8, 'Use at least 8 characters'),
    confirm_password: z.string(),
    valid_id_type: z.string().min(1, 'Select which ID you are presenting'),
    valid_id_number: z.string().trim().min(5, "That doesn't look like a complete ID number — check the digits and try again"),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: 'The two passwords do not match',
    path: ['confirm_password'],
  })

const step2Schema = z.object({
  purok: z.coerce.number().int().min(1, 'Select your purok').max(7, 'Barangay Ilawod has 7 puroks'),
  address_line: z.string().trim().min(6, 'Enter your house number and street'),
  years_of_residency: z.coerce.number().int().min(0, 'Enter a number').max(120, 'Enter a realistic number'),
  household_head: z.string().trim().optional(),
  household_size: z.coerce.number().int().min(1, 'A household has at least one person').max(30).optional(),
})

export default function Register() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [data, setData] = useState({})
  const [idFile, setIdFile] = useState(null)
  const [submitError, setSubmitError] = useState(null)

  const goto = (n) => {
    setStep(n)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <>
      <nav className="site-nav">
        <Link to="/" className="lockup">
          <PngSlot name="barangay-logo.png" className="seal" pill quiet />
          <div>
            <b>BARANGAY E-ASSIST</b>
            <span>Resident registration</span>
          </div>
        </Link>
        <div className="acts">
          <Button to="/login" size="m" variant="ghost">
            I already have an account
          </Button>
        </div>
      </nav>

      <div className="wrap" style={{ paddingTop: 36, paddingBottom: 56 }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <div style={{ marginBottom: 30 }}>
            <Stepper steps={STEPS} current={step} />
          </div>

          {submitError && (
            <div style={{ marginBottom: 20 }}>
              <Notice tone="danger" icon="alert" title="Registration could not be completed">
                {submitError}
              </Notice>
            </div>
          )}

          {step === 1 && (
            <StepOne
              defaults={data}
              onNext={(values) => {
                setData((d) => ({ ...d, ...values }))
                goto(2)
              }}
              idFile={idFile}
              setIdFile={setIdFile}
            />
          )}

          {step === 2 && (
            <StepTwo
              defaults={data}
              onBack={() => goto(1)}
              onNext={(values) => {
                setData((d) => ({ ...d, ...values }))
                goto(3)
              }}
            />
          )}

          {step === 3 && (
            <StepThree
              data={data}
              idFile={idFile}
              onBack={() => goto(2)}
              onError={setSubmitError}
              onDone={() => navigate('/app', { replace: true })}
            />
          )}
        </div>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */

function StepOne({ defaults, onNext, idFile, setIdFile }) {
  const [fileError, setFileError] = useState(null)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(step1Schema), defaultValues: defaults })

  function chooseFile(e) {
    const file = e.target.files?.[0]
    setFileError(null)
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setFileError('That file is larger than 5 MB. Try a smaller photo.')
      return
    }
    if (!/^(image\/(png|jpeg|webp)|application\/pdf)$/.test(file.type)) {
      setFileError('Upload a PNG, JPEG, WEBP or PDF.')
      return
    }
    setIdFile(file)
  }

  function submit(values) {
    if (!idFile) {
      setFileError('A photo of your valid ID is required.')
      return
    }
    onNext(values)
  }

  return (
    <div className="grid-2" style={{ gridTemplateColumns: '1.5fr .85fr', gap: 28, alignItems: 'start' }}>
      <Card padded>
        <span className="eyebrow">Step 1 of 3</span>
        <h1 style={{ fontSize: 30, margin: '12px 0 10px' }}>Tell us who you are</h1>
        <p style={{ fontSize: 15.5, color: 'var(--ink-500)', marginBottom: 30 }}>
          Use your name exactly as it appears on your valid ID. The barangay secretary checks this
          against the resident record before approving your account.
        </p>

        <form onSubmit={handleSubmit(submit)} noValidate>
          <div className="grid-2" style={{ gap: 20 }}>
            <div className="span-2">
              <Field
                label="Full legal name"
                required
                placeholder="Juan Miguel Dela Cruz"
                help="Family name, first name and middle name as printed on your ID"
                error={errors.full_name?.message}
                {...register('full_name')}
              />
            </div>

            <Field
              label="Date of birth"
              required
              type="date"
              help={`You must be ${MIN_AGE} or older to register`}
              error={errors.date_of_birth?.message}
              {...register('date_of_birth')}
            />

            <Field
              as="select"
              label="Sex"
              required
              help="As recorded on your birth certificate"
              error={errors.sex?.message}
              {...register('sex')}
            >
              <option value="">Select</option>
              <option>Female</option>
              <option>Male</option>
            </Field>

            <Field
              as="select"
              label="Civil status"
              hint="optional"
              help="Optional"
              error={errors.civil_status?.message}
              {...register('civil_status')}
            >
              <option value="">Select</option>
              {CIVIL_STATUS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Field>

            <Field
              label="Mobile number"
              required
              placeholder="09XX XXX XXXX"
              inputMode="numeric"
              help="We send request updates by SMS"
              error={errors.mobile?.message}
              {...register('mobile')}
            />

            <div className="span-2" style={{ borderTop: '1px solid var(--ink-100)', paddingTop: 22, marginTop: 4 }}>
              <h3 style={{ fontSize: 16, marginBottom: 4 }}>Your sign-in details</h3>
              <p style={{ fontSize: 13.5, color: 'var(--ink-500)' }}>
                You can add face sign-in later. A password is always kept as a fallback.
              </p>
            </div>

            <Field
              label="Email address"
              required
              type="email"
              autoComplete="email"
              placeholder="juan.delacruz@email.com"
              error={errors.email?.message}
              {...register('email')}
            />

            <Field
              label="Password"
              required
              type="password"
              autoComplete="new-password"
              help="At least 8 characters"
              error={errors.password?.message}
              {...register('password')}
            />

            <Field
              label="Confirm password"
              required
              type="password"
              autoComplete="new-password"
              error={errors.confirm_password?.message}
              {...register('confirm_password')}
            />

            <Field
              as="select"
              label="Type of valid ID"
              required
              error={errors.valid_id_type?.message}
              {...register('valid_id_type')}
            >
              <option value="">Select</option>
              {ID_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Field>

            <div className="span-2">
              <Field
                label="Valid ID number"
                required
                placeholder="0000-0000-0000"
                error={errors.valid_id_number?.message}
                {...register('valid_id_number')}
              />
            </div>

            <div className="span-2">
              <div className="field">
                <label htmlFor="id-upload">
                  Photograph of your valid ID <em>required</em>
                </label>
                <div
                  className="row"
                  style={{
                    gap: 16,
                    padding: 20,
                    border: `1.5px dashed ${fileError ? 'var(--danger-500)' : 'var(--ink-300)'}`,
                    borderRadius: 'var(--r-md)',
                    background: 'var(--ink-50)',
                    flexWrap: 'wrap',
                  }}
                >
                  <PngSlot name="valid-id-placeholder.png" style={{ width: 96, height: 64 }} />
                  <div className="grow">
                    <b style={{ display: 'block', fontSize: 14.5, color: 'var(--ink-800)' }}>
                      {idFile ? idFile.name : 'Upload a clear photo of your ID'}
                    </b>
                    <span style={{ fontSize: 13, color: 'var(--ink-400)' }}>
                      {idFile
                        ? `${(idFile.size / 1024).toFixed(0)} KB · ready to upload`
                        : 'PNG, JPEG or PDF, up to 5 MB. Make sure all four corners are visible.'}
                    </span>
                  </div>
                  <label className="btn btn-s btn-secondary btn-auto" style={{ cursor: 'pointer' }}>
                    {idFile ? 'Change file' : 'Choose a file'}
                    <input
                      id="id-upload"
                      type="file"
                      accept="image/png,image/jpeg,image/webp,application/pdf"
                      onChange={chooseFile}
                      style={{ display: 'none' }}
                    />
                  </label>
                </div>
                {fileError && (
                  <span className="help help-err" role="alert">
                    {fileError}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div
            style={{
              borderTop: '1px solid var(--ink-100)',
              marginTop: 28,
              paddingTop: 24,
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <Button type="submit" auto iconRight="arrow">
              Continue to household details
            </Button>
          </div>
        </form>
      </Card>

      <aside className="stack" style={{ gap: 20 }}>
        <Card padded style={{ padding: 24 }}>
          <h3 style={{ fontSize: 17, marginBottom: 14 }}>What you'll need</h3>
          <div className="stack" style={{ gap: 13 }}>
            {[
              'One valid government ID',
              'Proof of residence — a utility bill or barangay record',
              'Your purok number, if you know it',
              'A phone that can receive SMS',
            ].map((t) => (
              <div key={t} className="row" style={{ gap: 11, alignItems: 'flex-start' }}>
                <Icon name="check" size="sm" style={{ color: 'var(--success-500)', marginTop: 3 }} />
                <span style={{ fontSize: 14, color: 'var(--ink-600)' }}>{t}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card style={{ padding: 24, background: 'var(--primary-100)', borderColor: 'var(--primary-200)' }}>
          <Icon name="scan" size="lg" style={{ color: 'var(--primary-600)', marginBottom: 12 }} />
          <h3 style={{ fontSize: 16.5, marginBottom: 8 }}>Face enrollment comes next</h3>
          <p style={{ fontSize: 14, color: 'var(--primary-800)' }}>
            Once your details are submitted you'll be invited to enrol your face. You can skip it
            and use your email and password instead.
          </p>
        </Card>

        <Notice icon="lock" title="How your data is handled">
          Barangay Ilawod is the data controller. Your details are used to verify residency and
          process requests, and are kept only as long as the barangay record requires.
        </Notice>
      </aside>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function StepTwo({ defaults, onBack, onNext }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(step2Schema), defaultValues: defaults })

  return (
    <div className="grid-2" style={{ gridTemplateColumns: '1.5fr .85fr', gap: 28, alignItems: 'start' }}>
      <Card padded>
        <span className="eyebrow">Step 2 of 3</span>
        <h1 style={{ fontSize: 30, margin: '12px 0 10px' }}>Where do you live?</h1>
        <p style={{ fontSize: 15.5, color: 'var(--ink-500)', marginBottom: 30 }}>
          The wrong purok is the most common reason a clearance gets sent back, so it is worth
          checking this against a utility bill before you continue.
        </p>

        <form onSubmit={handleSubmit(onNext)} noValidate>
          <div className="grid-2" style={{ gap: 20 }}>
            <Field
              as="select"
              label="Purok"
              required
              help="Barangay Ilawod has seven puroks"
              error={errors.purok?.message}
              {...register('purok')}
            >
              <option value="">Select</option>
              {[1, 2, 3, 4, 5, 6, 7].map((p) => (
                <option key={p} value={p}>
                  Purok {p}
                </option>
              ))}
            </Field>

            <Field
              label="Years of residency"
              required
              type="number"
              min="0"
              help="How long you have lived in the barangay"
              error={errors.years_of_residency?.message}
              {...register('years_of_residency')}
            />

            <div className="span-2">
              <Field
                label="House number and street"
                required
                placeholder="123 Rizal Street"
                help="Include a landmark if the street has no numbers"
                error={errors.address_line?.message}
                {...register('address_line')}
              />
            </div>

            <Field
              label="Head of household"
              hint="optional"
              placeholder="Leave blank if that is you"
              error={errors.household_head?.message}
              {...register('household_head')}
            />

            <Field
              label="People in the household"
              hint="optional"
              type="number"
              min="1"
              error={errors.household_size?.message}
              {...register('household_size')}
            />
          </div>

          <div
            style={{
              borderTop: '1px solid var(--ink-100)',
              marginTop: 28,
              paddingTop: 24,
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <Button type="submit" auto iconRight="arrow">
              Review my registration
            </Button>
            <Button type="button" auto variant="ghost" onClick={onBack}>
              Back to personal details
            </Button>
          </div>
        </form>
      </Card>

      <aside className="stack" style={{ gap: 20 }}>
        <Notice icon="pin" title="Not sure which purok you are in?">
          The barangay map marks every purok boundary. If you are still unsure, the secretary will
          confirm it against the household record when your registration is reviewed.
        </Notice>
        <Card padded style={{ padding: 24, background: 'var(--ink-50)' }}>
          <h3 style={{ fontSize: 16.5, marginBottom: 10 }}>Why we ask</h3>
          <p style={{ fontSize: 14, color: 'var(--ink-500)' }}>
            Certificates of Residency and Indigency both state your purok and length of stay. Having
            it on file means the secretary does not have to ring you to ask.
          </p>
        </Card>
      </aside>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function StepThree({ data, idFile, onBack, onError, onDone }) {
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pendingActivation, setPendingActivation] = useState(false)

  async function submit() {
    setBusy(true)
    onError(null)

    try {
      // 1. Create the account. handle_new_user() writes the profile row.
      const { data: signUp, error: signUpError } = await supabase.auth.signUp({
        email: data.email.trim(),
        password: data.password,
        options: { data: { full_name: data.full_name.trim(), mobile: data.mobile.trim() } },
      })
      if (signUpError) throw signUpError

      // 2. A session is only returned when email confirmation is switched off.
      //    Without one we cannot write the profile or upload the ID, because
      //    both are gated on auth.uid() by Row Level Security.
      let session = signUp.session
      if (!session) {
        const { data: signIn } = await supabase.auth.signInWithPassword({
          email: data.email.trim(),
          password: data.password,
        })
        session = signIn?.session ?? null
      }

      if (!session) {
        setPendingActivation(true)
        setBusy(false)
        return
      }

      const userId = session.user.id

      // 3. Upload the ID into the private bucket, namespaced by owner.
      let validIdPath = null
      if (idFile) {
        const ext = idFile.name.split('.').pop()?.toLowerCase() ?? 'jpg'
        const path = `${userId}/valid-id.${ext}`
        const { error: uploadError } = await supabase.storage
          .from('valid-ids')
          .upload(path, idFile, { upsert: true, contentType: idFile.type })
        if (uploadError) throw uploadError
        validIdPath = path
      }

      // 4. Fill in the rest of the profile. Role and status are untouched —
      //    the guard trigger would reject any attempt to set them here.
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          full_name: data.full_name.trim(),
          date_of_birth: data.date_of_birth,
          sex: data.sex,
          civil_status: data.civil_status || null,
          mobile: data.mobile.trim(),
          email: data.email.trim(),
          purok: Number(data.purok),
          address_line: data.address_line.trim(),
          years_of_residency: Number(data.years_of_residency),
          household_head: data.household_head?.trim() || null,
          household_size: data.household_size ? Number(data.household_size) : null,
          valid_id_type: data.valid_id_type,
          valid_id_number: data.valid_id_number.trim(),
          valid_id_path: validIdPath,
        })
        .eq('id', userId)
      if (profileError) throw profileError

      onDone()
    } catch (err) {
      if (/already registered|already been registered/i.test(err.message ?? '')) {
        onError('An account already exists for that email address. Try signing in instead.')
      } else {
        onError(friendlyError(err, 'Your registration could not be saved. Please try again.'))
      }
      setBusy(false)
    }
  }

  if (pendingActivation) {
    return (
      <Card padded style={{ maxWidth: 640, margin: '0 auto' }}>
        <Icon name="clock" size="lg" style={{ color: 'var(--primary-600)', marginBottom: 14 }} />
        <h1 style={{ fontSize: 26, marginBottom: 10 }}>Your registration has been received</h1>
        <p style={{ fontSize: 15.5, color: 'var(--ink-500)', marginBottom: 20 }}>
          Your account still needs to be activated before you can sign in. The barangay secretary
          activates accounts once your details have been checked against the resident record.
        </p>
        <Notice icon="info" title="What happens next">
          Visit the barangay hall with the ID you registered, or wait for the secretary to confirm
          your account. Once activated you can sign in and enrol your face.
        </Notice>
        <div style={{ marginTop: 22 }}>
          <Button to="/" auto variant="secondary">
            Back to the home page
          </Button>
        </div>
      </Card>
    )
  }

  const rows = [
    ['Full legal name', data.full_name],
    ['Date of birth', data.date_of_birth ? longDate(data.date_of_birth) : '—'],
    ['Sex', data.sex],
    ['Civil status', data.civil_status || 'Not given'],
    ['Mobile number', data.mobile],
    ['Email address', data.email],
    ['Valid ID', `${data.valid_id_type} · ${data.valid_id_number}`],
    ['ID photograph', idFile?.name ?? 'Not attached'],
    ['Purok', `Purok ${data.purok}`],
    ['Address', data.address_line],
    ['Years of residency', String(data.years_of_residency)],
    ['Head of household', data.household_head || 'Self'],
    ['People in household', data.household_size ? String(data.household_size) : 'Not given'],
  ]

  return (
    <div className="grid-2" style={{ gridTemplateColumns: '1.5fr .85fr', gap: 28, alignItems: 'start' }}>
      <Card padded>
        <span className="eyebrow">Step 3 of 3</span>
        <h1 style={{ fontSize: 30, margin: '12px 0 10px' }}>Check your details</h1>
        <p style={{ fontSize: 15.5, color: 'var(--ink-500)', marginBottom: 26 }}>
          These go straight onto your barangay record. Anything wrong here will send your first
          clearance back for correction, so it is worth a second read.
        </p>

        <dl style={{ margin: 0 }}>
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="row"
              style={{
                gap: 16,
                padding: '13px 0',
                borderBottom: '1px solid var(--ink-100)',
                alignItems: 'flex-start',
              }}
            >
              <dt style={{ fontSize: 13, color: 'var(--ink-400)', width: 190, flex: 'none', fontWeight: 600 }}>
                {label}
              </dt>
              <dd style={{ margin: 0, fontSize: 14.5, color: 'var(--ink-800)' }}>{value || '—'}</dd>
            </div>
          ))}
        </dl>

        <div style={{ marginTop: 26 }}>
          <Check
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            title="I confirm these details are true and correct"
            description="I understand the barangay will verify them against the resident record, and that giving false information may void any document issued to me."
          />
        </div>

        <div
          style={{
            borderTop: '1px solid var(--ink-100)',
            marginTop: 26,
            paddingTop: 24,
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <Button auto onClick={submit} disabled={!consent || busy} icon={busy ? undefined : 'check'}>
            {busy ? 'Submitting your registration…' : 'Submit my registration'}
          </Button>
          <Button auto variant="ghost" onClick={onBack} disabled={busy}>
            Back to household details
          </Button>
        </div>
      </Card>

      <aside className="stack" style={{ gap: 20 }}>
        <Notice icon="shield" title="What happens after you submit">
          Your account is created straight away, but it stays <b>pending</b> until the barangay
          secretary checks your ID against the resident record. You can sign in and follow your
          own approval while you wait.
        </Notice>
        <Card padded style={{ padding: 24, background: 'var(--ink-50)' }}>
          <h3 style={{ fontSize: 16.5, marginBottom: 10 }}>Why approval is manual</h3>
          <p style={{ fontSize: 14, color: 'var(--ink-500)' }}>
            A barangay clearance is a legal document. A person is checked against the household
            record by a named official before their account can request one — the system does not
            make that decision on its own.
          </p>
        </Card>
      </aside>
    </div>
  )
}
