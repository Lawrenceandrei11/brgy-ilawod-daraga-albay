import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { supabase, friendlyError } from '../../lib/supabase'
import { Button, Card, Check, Field, Notice } from '../../components/ui'
import { Icon } from '../../components/Icon'

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
 * The anonymous channel.
 *
 * There is no name, Resident ID, email or phone field on this form, and no
 * such column exists on the table either — the anonymity is enforced by the
 * schema, not promised by the UI. Submission goes through
 * submit_anonymous_message(), which is also what returns the one-time code,
 * because the table denies SELECT to everyone but staff.
 */
export default function Anonymous() {
  const [code, setCode] = useState(null)
  const [submitError, setSubmitError] = useState(null)
  const [copied, setCopied] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema), defaultValues: { contact_optin: false } })

  const optedIn = watch('contact_optin')
  const message = watch('message') ?? ''

  async function onSubmit(values) {
    setSubmitError(null)
    try {
      const { data, error } = await supabase.rpc('submit_anonymous_message', {
        p_category: values.category,
        p_message: values.message,
        p_contact_optin: values.contact_optin,
        p_contact_detail: values.contact_optin ? values.contact_detail : null,
      })
      if (error) throw error
      setCode(data)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setSubmitError(friendlyError(err, 'Your message could not be sent. Please try again.'))
    }
  }

  if (code) {
    return (
      <div className="section" style={{ maxWidth: 720 }}>
        <Card padded>
          <Icon name="check" size="lg" style={{ color: 'var(--success-500)', marginBottom: 14 }} />
          <h1 style={{ fontSize: 28, marginBottom: 10 }}>Your message has been sent</h1>
          <p style={{ fontSize: 15.5, color: 'var(--ink-500)', marginBottom: 22 }}>
            It reached the barangay with a reference code only. Nothing linking it to you was
            recorded.
          </p>

          <div className="refcode" style={{ marginBottom: 20 }}>
            <b>{code}</b>
            <span>Shown once · not recoverable</span>
          </div>

          <div style={{ marginBottom: 22 }}>
            <Button
              auto
              variant="secondary"
              icon={copied ? 'check' : 'doc'}
              onClick={() => {
                navigator.clipboard?.writeText(code)
                setCopied(true)
              }}
            >
              {copied ? 'Copied' : 'Copy the code'}
            </Button>
          </div>

          <Notice tone="danger" icon="alert" title="Write this down now">
            Because the message is not tied to an account, we genuinely cannot look it up for you
            later. If you lose this code there is no way for anyone — including the barangay — to
            connect you to the report.
          </Notice>

          <div style={{ marginTop: 22, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Button to="/" auto>
              Back to the home page
            </Button>
            <Button
              auto
              variant="ghost"
              onClick={() => {
                setCode(null)
                setCopied(false)
              }}
            >
              Send another message
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="section">
      <div className="section-head">
        <span className="eyebrow">Anonymous message</span>
        <h2>Report a concern without giving your name</h2>
        <p>
          No sign-in, no contact details, no account. Use this when putting your name to something
          would put you at risk.
        </p>
      </div>

      <div className="grid-2" style={{ alignItems: 'start', gap: 28 }}>
        <div className="stack" style={{ gap: 18 }}>
          {submitError && (
            <Notice tone="danger" icon="alert" title="Could not send">
              {submitError}
            </Notice>
          )}

          <Notice icon="incognito" title="This message is not linked to you">
            We don't ask who you are and we don't record it. Your message reaches the barangay with
            a reference code only — not an account, an IP address, or a device name.
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
            <h3 style={{ fontSize: 16.5, marginBottom: 14 }}>What you get back</h3>
            <p style={{ fontSize: 14, color: 'var(--ink-500)', marginBottom: 18 }}>
              A reference code appears once, on screen. Write it down — because the message isn't
              tied to an account, we cannot retrieve it for you later.
            </p>
            <div className="refcode">
              <b style={{ opacity: 0.35 }}>ANON-••••-••</b>
              <span>Shown once · not recoverable</span>
            </div>
          </Card>

          <Card padded>
            <h3 style={{ fontSize: 16.5, marginBottom: 14 }}>What we do not record</h3>
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
    </div>
  )
}
