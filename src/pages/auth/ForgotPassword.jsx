import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { supabase } from '../../lib/supabase'
import { Button, Card, Field, Notice } from '../../components/ui'
import { MainLogo } from '../../components/MainLogo'
import { requestPasswordReset } from '../../lib/passwordReset'

const schema = z.object({
  email: z
    .string()
    .min(1, 'Enter your email address')
    .email('That does not look like an email address'),
})

/**
 * Asking for a password reset link.
 *
 * The answer is the same sentence whichever address is typed. A form that
 * said "no account found" would let anyone check which of their neighbours
 * had registered with the barangay, so the only thing the screen reveals is
 * that the form was submitted.
 *
 * Nothing here knows anything about tokens. Supabase sends the email; the
 * link it contains is handled by ResetPassword.jsx.
 */
export default function ForgotPassword() {
  const [sent, setSent] = useState(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema) })

  async function onSubmit(values) {
    const result = await requestPasswordReset({
      client: supabase,
      email: values.email,
      origin: window.location.origin,
    })
    // `ok` is false only for an empty address, which the schema already
    // catches; every real outcome lands on the same message.
    setSent(result.message)
  }

  return (
    <>
      <nav className="site-nav">
        <Link to="/" className="lockup">
          <MainLogo className="seal" pill quiet />
          <div>
            <b>BARANGAY E-ASSIST</b>
            <span>Reset your password</span>
          </div>
        </Link>
      </nav>

      <div className="wrap" style={{ paddingTop: 48, paddingBottom: 64 }}>
        <Card padded style={{ maxWidth: 480, margin: '0 auto' }}>
          <h1 style={{ fontSize: 26, marginBottom: 8 }}>Forgot your password?</h1>

          {sent ? (
            <>
              <Notice icon="check" title="Check your email">
                {sent}
              </Notice>
              <p style={{ fontSize: 13.5, color: 'var(--ink-500)', margin: '16px 0' }}>
                The link is only good for a short while. If it has stopped working by the time you
                open it, come back here and ask for another.
              </p>
              <Button to="/login" variant="secondary" block>
                Back to sign in
              </Button>
            </>
          ) : (
            <>
              <p style={{ fontSize: 15, color: 'var(--ink-500)', marginBottom: 24 }}>
                Type the email address you registered with. We will send a link you can use to set
                a new password.
              </p>

              <form onSubmit={handleSubmit(onSubmit)} className="stack" style={{ gap: 20 }} noValidate>
                <Field
                  label="Email address"
                  type="email"
                  autoComplete="email"
                  placeholder="juan.delacruz@email.com"
                  error={errors.email?.message}
                  {...register('email')}
                />

                <Button type="submit" block icon="lock" disabled={isSubmitting}>
                  {isSubmitting ? 'Sending the link…' : 'Send me a reset link'}
                </Button>
              </form>

              <div style={{ marginTop: 20 }}>
                <Button to="/login" variant="ghost" block>
                  Back to sign in
                </Button>
              </div>

              <p
                style={{
                  marginTop: 22,
                  paddingTop: 18,
                  borderTop: '1px solid var(--ink-100)',
                  fontSize: 13,
                  color: 'var(--ink-400)',
                }}
              >
                No email after a few minutes? Check the spam folder. If it still has not arrived,
                visit the barangay hall and the staff will help you.
              </p>
            </>
          )}
        </Card>
      </div>
    </>
  )
}
