import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase, friendlyError } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { SERVICE_FIELDS, buildSchema, summarisePurpose } from '../../lib/serviceFields'
import { Button, Card, Field, Notice, PngSlot } from '../../components/ui'
import { LoadingRows } from '../../components/ui/States'
import { Icon } from '../../components/Icon'
import { peso, turnaround } from '../../lib/formatters'

/**
 * One form, four document types.
 *
 * The questions come from SERVICE_FIELDS; the identity block is read-only
 * because it comes from the barangay record. The fee and the reference number
 * are never sent by the client — the database stamps both, so a resident
 * cannot file under someone else's number or set their own fee.
 */
export default function NewRequest() {
  const { code } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { profile, isApproved } = useAuth()

  const [submitError, setSubmitError] = useState(null)

  const { data: service, isLoading } = useQuery({
    queryKey: ['service', code],
    queryFn: async () => {
      const { data, error } = await supabase.from('services').select('*').eq('code', code).maybeSingle()
      if (error) throw error
      return data
    },
  })

  const spec = SERVICE_FIELDS[code]

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(buildSchema(code)) })

  const values = watch()

  if (isLoading) return <div className="dash-body"><Card flush><LoadingRows rows={5} /></Card></div>

  if (!service || !spec) {
    return (
      <div className="dash-body">
        <Card padded style={{ maxWidth: 560 }}>
          <h1 style={{ fontSize: 24, marginBottom: 10 }}>That service does not exist</h1>
          <p style={{ fontSize: 15, color: 'var(--ink-500)', marginBottom: 20 }}>
            The link may be out of date. Pick a service from your dashboard instead.
          </p>
          <Button to="/app" auto variant="secondary">Back to my dashboard</Button>
        </Card>
      </div>
    )
  }

  async function onSubmit(formValues) {
    setSubmitError(null)
    try {
      // Only profile_id, service_code, purpose and details are sent.
      // ref_no and fee are stamped by the stamp_request() trigger.
      const { data, error } = await supabase
        .from('document_requests')
        .insert({
          profile_id: profile.id,
          service_code: code,
          purpose: summarisePurpose(code, formValues),
          details: formValues,
        })
        .select('ref_no')
        .single()

      if (error) throw error

      queryClient.invalidateQueries({ queryKey: ['my-requests'] })
      queryClient.invalidateQueries({ queryKey: ['nav-counts'] })
      navigate(`/app/requests/${data.ref_no}?filed=1`)
    } catch (err) {
      setSubmitError(
        friendlyError(err, 'Your request could not be filed. Please try again in a moment.')
      )
    }
  }

  return (
    <div className="dash-body">
      <div>
        <Link
          to="/app"
          style={{ fontSize: 13.5, color: 'var(--ink-500)', display: 'inline-flex', gap: 6, alignItems: 'center' }}
        >
          <Icon name="chev" size="sm" style={{ transform: 'rotate(180deg)' }} /> Back to dashboard
        </Link>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: '1.5fr .85fr', gap: 24, alignItems: 'start' }}>
        <Card padded>
          <div className="row" style={{ gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
            <PngSlot name={service.icon} style={{ width: 56, height: 56, flex: 'none' }} />
            <div className="grow">
              <span className="eyebrow">Request a document</span>
              <h1 style={{ fontSize: 28, margin: '6px 0 0' }}>{service.name}</h1>
            </div>
          </div>

          <p style={{ fontSize: 15.5, color: 'var(--ink-500)', marginBottom: 26 }}>{spec.intro}</p>

          {!isApproved && (
            <div style={{ marginBottom: 22 }}>
              <Notice tone="danger" icon="clock" title="Your account is still being reviewed">
                You can fill this in, but it cannot be filed until the barangay secretary approves
                your registration.
              </Notice>
            </div>
          )}

          {submitError && (
            <div style={{ marginBottom: 22 }}>
              <Notice tone="danger" icon="alert" title="Could not file the request">
                {submitError}
              </Notice>
            </div>
          )}

          {/* Identity comes from the barangay record, not from this form. */}
          <div
            style={{
              background: 'var(--ink-50)',
              border: '1px solid var(--ink-200)',
              borderRadius: 'var(--r-lg)',
              padding: 20,
              marginBottom: 26,
            }}
          >
            <div className="row" style={{ gap: 10, marginBottom: 14 }}>
              <Icon name="user" size="sm" style={{ color: 'var(--primary-600)' }} />
              <b style={{ fontSize: 14, color: 'var(--ink-800)' }}>Filed by</b>
              <Link
                to="/app/profile"
                style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600 }}
              >
                Something wrong? Update my details
              </Link>
            </div>
            <div className="grid-2" style={{ gap: '10px 20px' }}>
              {[
                ['Name', profile?.full_name],
                ['Resident ID', profile?.resident_id ?? 'Pending approval'],
                ['Address', profile?.address_line],
                ['Purok', profile?.purok ? `Purok ${profile.purok}` : '—'],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 12, color: 'var(--ink-400)', fontWeight: 600 }}>{k}</div>
                  <div style={{ fontSize: 14.5, color: 'var(--ink-800)' }}>{v || '—'}</div>
                </div>
              ))}
            </div>
          </div>

          {spec.notice && (
            <div style={{ marginBottom: 22 }}>
              <Notice icon={spec.notice.icon} title={spec.notice.title}>
                {spec.notice.body}
              </Notice>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="stack" style={{ gap: 20 }}>
              {spec.fields.map((f) => {
                if (f.showWhen && !f.showWhen(values)) return null

                const common = {
                  key: f.name,
                  label: f.label,
                  required: f.required,
                  hint: f.required ? undefined : 'optional',
                  help: f.help,
                  error: errors[f.name]?.message,
                  placeholder: f.placeholder,
                  ...register(f.name),
                }

                if (f.type === 'select') {
                  return (
                    <Field as="select" {...common}>
                      <option value="">Select</option>
                      {f.options.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </Field>
                  )
                }

                return (
                  <Field
                    {...common}
                    type={f.type === 'number' ? 'number' : 'text'}
                    min={f.min}
                    max={f.max}
                  />
                )
              })}
            </div>

            <div
              style={{
                borderTop: '1px solid var(--ink-100)',
                marginTop: 26,
                paddingTop: 22,
                display: 'flex',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <Button type="submit" auto icon="doc" disabled={isSubmitting || !isApproved}>
                {isSubmitting ? 'Filing your request…' : 'File this request'}
              </Button>
              <Button type="button" auto variant="ghost" to="/app">
                Cancel
              </Button>
            </div>
          </form>
        </Card>

        <aside className="stack" style={{ gap: 20 }}>
          <Card padded style={{ padding: 24 }}>
            <h3 style={{ fontSize: 17, marginBottom: 16 }}>This request</h3>
            <div className="stack" style={{ gap: 14 }}>
              <div className="row" style={{ gap: 12 }}>
                <Icon name="doc" size="sm" style={{ color: 'var(--primary-600)' }} />
                <span style={{ fontSize: 14, color: 'var(--ink-600)' }}>Fee</span>
                <b style={{ marginLeft: 'auto', fontSize: 15, color: 'var(--primary-900)' }}>
                  {peso(service.fee)}
                </b>
              </div>
              <div className="row" style={{ gap: 12 }}>
                <Icon name="clock" size="sm" style={{ color: 'var(--primary-600)' }} />
                <span style={{ fontSize: 14, color: 'var(--ink-600)' }}>Processing</span>
                <b style={{ marginLeft: 'auto', fontSize: 15, color: 'var(--primary-900)' }}>
                  {turnaround(service.processing_days)}
                </b>
              </div>
              {service.requires_council_review && (
                <div className="row" style={{ gap: 12 }}>
                  <Icon name="users" size="sm" style={{ color: 'var(--accent-600)' }} />
                  <span style={{ fontSize: 14, color: 'var(--ink-600)' }}>Council review</span>
                  <b style={{ marginLeft: 'auto', fontSize: 13.5, color: 'var(--accent-700)' }}>
                    Required
                  </b>
                </div>
              )}
            </div>
          </Card>

          <Card padded style={{ padding: 24 }}>
            <h3 style={{ fontSize: 17, marginBottom: 14 }}>Bring these when you collect</h3>
            <div className="stack" style={{ gap: 13 }}>
              {(service.requirements ?? []).map((r) => (
                <div key={r} className="row" style={{ gap: 11, alignItems: 'flex-start' }}>
                  <Icon name="check" size="sm" style={{ color: 'var(--success-500)', marginTop: 3 }} />
                  <span style={{ fontSize: 14, color: 'var(--ink-600)' }}>{r}</span>
                </div>
              ))}
            </div>
          </Card>

          <Notice icon="info" title="What happens next">
            You get a reference number straight away. The secretary picks the request up, and you
            can follow every change from filed to released.
          </Notice>
        </aside>
      </div>
    </div>
  )
}
