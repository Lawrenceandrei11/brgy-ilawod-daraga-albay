import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { supabase, friendlyError } from '../lib/supabase'
import { Button, Card, Check, Field, Notice } from './ui'
import { Icon } from './Icon'

const CATEGORIES = [
  'Safety or crime concern',
  'Noise or nuisance',
  'Sanitation',
  'Official misconduct',
  'Something else',
]

const MAX = 1000

const schema = z
  .object({
    category: z.string().min(1, 'Choose a category so the message can be routed'),
    message: z
      .string()
      .trim()
      .min(10, 'Please describe the concern in at least 10 characters')
      .max(MAX, `Please keep it under ${MAX} characters`),
    contact_optin: z.boolean().default(false),
    contact_detail: z.string().trim().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.contact_optin && !v.contact_detail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contact_detail'],
        message: 'Add one way to reach you, or switch the option back off',
      })
    }
  })

/**
 * The anonymous channel — the form, and what comes back from it.
 *
 * There is no name, Resident ID, email or phone field on this form, and no
 * such column exists on the table either — the anonymity is enforced by the
 * schema, not promised by the UI. Submission goes through
 * submit_anonymous_message(), because the table denies SELECT to everyone but
 * staff. That function still mints a reference for the barangay's own inbox;
 * what changed is that the sender is never shown it, so there is nothing to
 * carry away, lose, or be asked to produce later.
 *
 * It lives here rather than on a page because two places show it: the public
 * page, for anyone with no account, and the Resident portal, which keeps a
 * signed-in resident inside their dashboard. Both render this one component,
 * so there is a single form, a single set of rules and a single call to the
 * database — only the heading above it and where "back" leads differ.
 *
 * Signing in changes nothing about what is sent: no session, account or
 * resident ID goes with the message from either place.
 */
export function AnonymousMessage({
  heading = null,
  backTo = '/',
  backLabel = 'Back to the home page',
}) {
  const [sent, setSent] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema), defaultValues: { contact_optin: false } })

  const optedIn = watch('contact_optin')
  const message = watch('message') ?? ''

  async function onSubmit(values) {
    setSubmitError(null)
    try {
      // The function's return value is deliberately not read: the reference
      // it mints belongs to the barangay's inbox, not to the sender.
      const { error } = await supabase.rpc('submit_anonymous_message', {
        p_category: values.category,
        p_message: values.message,
        p_contact_optin: values.contact_optin,
        p_contact_detail: values.contact_optin ? values.contact_detail : null,
      })
      if (error) throw error
      setSent(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setSubmitError(friendlyError(err, 'Your message could not be sent. Please try again.'))
    }
  }

  if (sent) {
    return (
      <Card padded style={{ maxWidth: 720 }}>
        <Icon name="check" size="lg" style={{ color: 'var(--success-500)', marginBottom: 14 }} />
        <h1 style={{ fontSize: 28, marginBottom: 10 }}>Your message has been sent</h1>
        <p style={{ fontSize: 15.5, color: 'var(--ink-500)', marginBottom: 22 }}>
          Your anonymous message was successfully submitted to the barangay. No personal
          information is attached to your message.
        </p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Button to={backTo} auto>
            {backLabel}
          </Button>
          <Button
            auto
            variant="ghost"
            onClick={() => {
              // Empty fields, not the last report still sitting in them: it
              // could be sent twice by accident, and it is nobody's business
              // that it is on this screen.
              reset({ category: '', message: '', contact_optin: false, contact_detail: '' })
              setSent(false)
            }}
          >
            Send another message
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <>
      {heading}

      <div className="grid-2" style={{ alignItems: 'start', gap: 28 }}>
        <div className="stack" style={{ gap: 18 }}>
          {submitError && (
            <Notice tone="danger" icon="alert" title="Could not send">
              {submitError}
            </Notice>
          )}

          <Notice icon="incognito" title="This message is not linked to you">
            We don't ask who you are and we don't record it. Nothing travels with your message —
            not an account, an IP address, or a device name.
          </Notice>

          <form onSubmit={handleSubmit(onSubmit)} className="stack" style={{ gap: 18 }} noValidate>
            <Field
              as="select"
              label="What is this about?"
              required
              help="This is the only detail we need to route your message"
              error={errors.category?.message}
              {...register('category')}
            >
              <option value="">Select a category</option>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Field>

            <div>
              <Field
                as="textarea"
                label="Your message"
                required
                placeholder="What happened, where, and when? Include anything that would help the barangay respond."
                error={errors.message?.message}
                maxLength={MAX}
                {...register('message')}
              />
              <div className="row" style={{ marginTop: 6 }}>
                <span className="help grow">
                  Avoid including your own name unless you want it known
                </span>
                <span className="help" style={{ color: message.length > MAX * 0.9 ? 'var(--warning-600)' : undefined }}>
                  {message.length} / {MAX}
                </span>
              </div>
            </div>

            <Check
              {...register('contact_optin')}
              title="I would like the barangay to contact me about this report"
              description="Optional — leaving this off keeps your message fully anonymous."
            />

            {optedIn && (
              <div>
                <Field
                  label="One way to reach you"
                  required
                  placeholder="A mobile number or email address"
                  help="This is the only identifying thing we will store, and only because you asked"
                  error={errors.contact_detail?.message}
                  {...register('contact_detail')}
                />
                <div style={{ marginTop: 12 }}>
                  <Notice tone="quiet" icon="info" title="You are no longer fully anonymous">
                    Providing a contact detail means the barangay can reach you. Everything else
                    about the report stays unlinked to any account.
                  </Notice>
                </div>
              </div>
            )}

            <div>
              <Button type="submit" auto icon="incognito" disabled={isSubmitting}>
                {isSubmitting ? 'Sending…' : 'Send anonymously'}
              </Button>
            </div>
          </form>
        </div>

        <aside className="stack" style={{ gap: 18 }}>
          <Card padded style={{ background: 'var(--ink-50)' }}>
            <h2 style={{ fontSize: 16.5, marginBottom: 14 }}>What happens next</h2>
            <p style={{ fontSize: 14, color: 'var(--ink-500)' }}>
              Your message goes to the barangay's inbox and is read during office hours. There is
              nothing for you to keep afterwards and nothing to hand over: the report carries no
              trace of who sent it.
            </p>
          </Card>

          <Card padded>
            <h2 style={{ fontSize: 16.5, marginBottom: 14 }}>What we do not record</h2>
            <div className="stack" style={{ gap: 12 }}>
              {['Your name or Resident ID', 'Your email or phone number', 'Your IP address', 'Your device or browser'].map(
                (t) => (
                  <div key={t} className="row" style={{ gap: 11, alignItems: 'flex-start' }}>
                    <Icon name="x" size="sm" style={{ color: 'var(--danger-500)', marginTop: 3 }} />
                    <span style={{ fontSize: 14, color: 'var(--ink-600)' }}>{t}</span>
                  </div>
                )
              )}
            </div>
            <p style={{ fontSize: 13, color: 'var(--ink-400)', marginTop: 16, lineHeight: 1.6 }}>
              These columns do not exist on the table at all, so there is nothing to hand over even
              if the barangay were asked for it.
            </p>
          </Card>

          <Notice tone="danger" icon="alert" title="If you are in immediate danger">
            Do not use this form. Call the barangay emergency hotline or the police. This inbox is
            read during office hours.
          </Notice>
        </aside>
      </div>
    </>
  )
}

export default AnonymousMessage
