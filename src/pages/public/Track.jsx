import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { supabase, friendlyError } from '../../lib/supabase'
import { Badge, Button, Card, Field, Notice } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { REQUEST_STATUS } from '../../lib/status'
import { longDate, shortDate, timeOnly } from '../../lib/formatters'

const schema = z.object({
  ref: z.string().trim().min(4, 'Enter the reference number from your receipt'),
  surname: z.string().trim().min(2, 'Enter the surname the request was filed under'),
})

/**
 * Public request tracking.
 *
 * Reference numbers run in sequence, so asking for the reference alone would
 * let anyone count upward and discover who requested what. Requiring the
 * surname as well means a guess needs two facts, and the RPC returns progress
 * only — never the address, purpose or ID number.
 */
export default function Track() {
  const [result, setResult] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema) })

  async function onSubmit(values) {
    setError(null)
    setNotFound(false)
    setResult(null)

    try {
      // Try a document request first, then a blotter report — residents do
      // not necessarily remember which kind of reference they are holding.
      const isBlotter = /^BLT/i.test(values.ref.trim())
      const fn = isBlotter ? 'track_blotter' : 'track_request'

      const { data, error: rpcError } = await supabase.rpc(fn, {
        p_ref: values.ref,
        p_surname: values.surname,
      })
      if (rpcError) throw rpcError

      if (!data || data.length === 0) {
        setNotFound(true)
        return
      }
      setResult({ ...data[0], kind: isBlotter ? 'blotter' : 'request' })
    } catch (err) {
      setError(friendlyError(err, 'Could not look that up right now. Please try again.'))
    }
  }

  return (
    <div className="section" style={{ maxWidth: 900 }}>
      <div className="section-head">
        <span className="eyebrow">Track a request</span>
        <h2>Check where your request has got to</h2>
        <p>
          You don't need an account. Enter the reference number from your receipt and the surname
          it was filed under.
        </p>
      </div>

      <div className="grid-2" style={{ alignItems: 'start', gap: 28 }}>
        <div className="stack" style={{ gap: 18 }}>
          <Card padded>
            <form onSubmit={handleSubmit(onSubmit)} className="stack" style={{ gap: 18 }} noValidate>
              <Field
                label="Reference number"
                required
                placeholder="ILW-2026-00841"
                help="Printed on your receipt, or shown when you filed"
                error={errors.ref?.message}
                {...register('ref')}
              />
              <Field
                label="Surname on the request"
                required
                placeholder="Dela Cruz"
                help="The family name the request was filed under"
                error={errors.surname?.message}
                {...register('surname')}
              />
              <div>
                <Button type="submit" auto icon="search" disabled={isSubmitting}>
                  {isSubmitting ? 'Looking it up…' : 'Track this request'}
                </Button>
              </div>
            </form>
          </Card>

          {error && (
            <Notice tone="danger" icon="alert" title="Something went wrong">
              {error}
            </Notice>
          )}

          {notFound && (
            <Notice tone="danger" icon="search" title="No matching request">
              Nothing matches that reference number and surname together. Check both — the surname
              must be the one on the barangay record, not a nickname.
            </Notice>
          )}

          {result && (
            <Card flush>
              <div style={{ padding: '22px 26px', borderBottom: '1px solid var(--ink-100)' }}>
                <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
                  <div className="grow">
                    <div className="ref" style={{ fontSize: 15, marginBottom: 4 }}>
                      {result.ref_no}
                    </div>
                    <h3 style={{ fontSize: 19 }}>
                      {result.kind === 'blotter' ? result.incident_type : result.service_name}
                    </h3>
                  </div>
                  {result.kind === 'request' ? (
                    <Badge status={result.status} />
                  ) : (
                    <Badge tone="processing">{String(result.status).replace(/_/g, ' ')}</Badge>
                  )}
                </div>
              </div>

              <div style={{ padding: '20px 26px' }}>
                {result.kind === 'request' && (
                  <p style={{ fontSize: 14.5, color: 'var(--ink-600)', marginBottom: 18 }}>
                    {REQUEST_STATUS[result.status]?.resident}
                  </p>
                )}

                <div className="stack" style={{ gap: 12 }}>
                  {[
                    ['Filed by', result.applicant],
                    ['Filed on', longDate(result.filed_at)],
                    ['Last updated', `${shortDate(result.updated_at)} · ${timeOnly(result.updated_at)}`],
                    result.released_at ? ['Released', longDate(result.released_at)] : null,
                  ]
                    .filter(Boolean)
                    .map(([k, v]) => (
                      <div key={k} className="row" style={{ gap: 12 }}>
                        <span style={{ fontSize: 14, color: 'var(--ink-500)' }}>{k}</span>
                        <b style={{ marginLeft: 'auto', fontSize: 14.5, color: 'var(--ink-900)' }}>{v}</b>
                      </div>
                    ))}
                </div>
              </div>

              {result.status === 'ready' && (
                <div style={{ padding: '18px 26px', background: 'var(--primary-100)', borderTop: '1px solid var(--primary-200)' }}>
                  <div className="row" style={{ gap: 10 }}>
                    <Icon name="check" style={{ color: 'var(--primary-700)' }} />
                    <span style={{ fontSize: 14, color: 'var(--primary-800)' }}>
                      Ready to collect at the barangay hall, Monday to Friday, 8:00 AM – 5:00 PM.
                      Bring a valid ID.
                    </span>
                  </div>
                </div>
              )}
            </Card>
          )}
        </div>

        <aside className="stack" style={{ gap: 18 }}>
          <Notice icon="lock" title="Why we ask for the surname">
            Reference numbers run in order. If the number alone were enough, anyone could count
            through them and see who had requested what. Asking for the surname as well means a
            stranger cannot browse other people's business.
          </Notice>

          <Card padded style={{ background: 'var(--ink-50)' }}>
            <h3 style={{ fontSize: 16.5, marginBottom: 12 }}>What this page shows</h3>
            <p style={{ fontSize: 14, color: 'var(--ink-500)' }}>
              Only the progress of the request: which document, what stage, and the dates. It never
              shows an address, a purpose, an ID number or a contact detail.
            </p>
          </Card>

          <Card padded>
            <h3 style={{ fontSize: 16.5, marginBottom: 12 }}>Lost your reference number?</h3>
            <p style={{ fontSize: 14, color: 'var(--ink-500)', marginBottom: 16 }}>
              Sign in and every request you have filed is listed with its reference, or visit the
              barangay hall with a valid ID.
            </p>
            <Button to="/login" size="s" variant="secondary" block>
              Sign in to see my requests
            </Button>
          </Card>
        </aside>
      </div>
    </div>
  )
}
