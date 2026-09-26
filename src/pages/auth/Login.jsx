import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { supabase, friendlyError } from '../../lib/supabase'
import { Button, Field, Notice } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { MainLogo } from '../../components/MainLogo'

const schema = z.object({
  email: z.string().min(1, 'Enter your email address').email('That does not look like an email address'),
  password: z.string().min(1, 'Enter your password'),
})

/**
 * Password sign-in.
 *
 * Face sign-in is the headline route (/login/face) and is what the landing
 * page points at. This screen is the fallback the prototype also offers:
 * it is what a resident uses when the camera, the lighting or the venue
 * network lets them down, and it is the only way staff sign in — barangay
 * officials do not enroll biometrics.
 */
export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const [formError, setFormError] = useState(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema) })

  async function onSubmit(values) {
    setFormError(null)

    const { data, error } = await supabase.auth.signInWithPassword({
      email: values.email.trim(),
      password: values.password,
    })

    if (error) {
      // Supabase returns the same message for a wrong password and an
      // unconfirmed address; separate them so a resident is not left guessing.
      if (/email not confirmed/i.test(error.message)) {
        setFormError(
          'This account has not been activated yet. The barangay secretary activates accounts once your registration is reviewed.'
        )
      } else if (/invalid login credentials/i.test(error.message)) {
        setFormError('That email and password do not match an account.')
      } else {
        setFormError(friendlyError(error, 'Could not sign you in. Please try again.'))
      }
      return
    }

    // Staff land in the admin portal; residents in their own dashboard.
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .maybeSingle()

    const staff = ['secretary', 'treasurer', 'captain'].includes(profile?.role)
    navigate(location.state?.from ?? (staff ? '/admin' : '/app'), { replace: true })
  }

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

        <div style={{ margin: 'auto 0' }}>
          <span className="eyebrow-pill">Resident sign-in</span>
          <h1
            style={{
              color: '#fff',
              fontSize: 'clamp(28px,3vw,38px)',
              lineHeight: 1.1,
              letterSpacing: '-.03em',
              margin: '20px 0 14px',
            }}
          >
            Barangay services,
            <br />
            without the queue.
          </h1>
          <p style={{ fontSize: 16, maxWidth: '40ch', color: 'var(--ink-300)' }}>
            Request clearances, file a blotter report, book an appointment, or send an anonymous
            concern — all tracked from filing to release.
          </p>

          <div className="trust" style={{ marginTop: 30 }}>
            <div>
              <Icon name="shield" size="sm" /> Face template, never a stored photo
            </div>
            <div>
              <Icon name="lock" size="sm" /> Data Privacy Act of 2012 compliant
            </div>
          </div>
        </div>

        <Notice tone="onDark" icon="scan" title="Prefer to sign in with your face?">
          If you have enrolled, you can look at the camera instead of typing a password. Face
          sign-in is available to residents; barangay staff always use a password.
        </Notice>
      </div>

      <div className="auth-right">
        <div>
          <span className="eyebrow">Sign in</span>
          <h1 className="auth-h1" style={{ margin: '14px 0 12px' }}>
            Welcome back
          </h1>
          <p className="auth-sub">
            Use the email and password you set when you registered.
          </p>
        </div>

        {formError && (
          <Notice tone="danger" icon="alert" title="Could not sign in">
            {formError}
          </Notice>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="stack" style={{ gap: 20 }} noValidate>
          <Field
            label="Email address"
            type="email"
            autoComplete="email"
            placeholder="juan.delacruz@email.com"
            error={errors.email?.message}
            {...register('email')}
          />
          <Field
            label="Password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            error={errors.password?.message}
            {...register('password')}
          />

          <Button type="submit" block icon="lock" disabled={isSubmitting}>
            {isSubmitting ? 'Signing you in…' : 'Sign in'}
          </Button>
        </form>

        <div className="auth-divider">
          <span className="rule" /> or <span className="rule" />
        </div>

        <div className="stack" style={{ gap: 12 }}>
          <Button to="/login/face" variant="secondary" block icon="scan">
            Sign in with my face
          </Button>
          <Button to="/register" variant="ghost" block>
            I don't have an account yet
          </Button>
        </div>

        <p
          style={{
            fontSize: 13,
            color: 'var(--ink-400)',
            borderTop: '1px solid var(--ink-100)',
            paddingTop: 20,
          }}
        >
          Trouble signing in? Visit the barangay hall with a valid ID and the secretary can verify
          you in person, or call the barangay hotline during office hours.
        </p>
      </div>
    </div>
  )
}
