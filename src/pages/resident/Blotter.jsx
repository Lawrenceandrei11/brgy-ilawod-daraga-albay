import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase, friendlyError } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Badge, Button, Card, CardHeader, Field, Notice } from '../../components/ui'
import { EmptyState, LoadingRows } from '../../components/ui/States'
import { Icon } from '../../components/Icon'
import { shortDate } from '../../lib/formatters'

const INCIDENT_TYPES = [
  'Physical injury or assault',
  'Threat or intimidation',
  'Theft',
  'Property damage',
  'Boundary or land dispute',
  'Neighbour dispute',
  'Noise complaint',
  'Domestic dispute',
  'Scam or estafa',
  'Other',
]

const BLOTTER_STATUS_LABEL = {
  filed: 'Filed',
  under_mediation: 'Under mediation',
  resolved: 'Resolved',
  referred: 'Referred',
  dismissed: 'Dismissed',
}

const BLOTTER_STATUS_TONE = {
  filed: 'pending',
  under_mediation: 'processing',
  resolved: 'approved',
  referred: 'scheduled',
  dismissed: 'released',
}

const schema = z.object({
  incident_type: z.string().min(1, 'Choose the kind of incident'),
  incident_at: z
    .string()
    .min(1, 'When did this happen?')
    .refine((v) => new Date(v) <= new Date(), 'The incident cannot be in the future'),
  location: z.string().trim().min(4, 'Where did it happen?'),
  respondent_name: z.string().trim().optional(),
  respondent_address: z.string().trim().optional(),
  narrative: z.string().trim().min(20, 'Please describe what happened in at least 20 characters'),
})

export default function Blotter() {
  const { profile, isApproved } = useAuth()
  const queryClient = useQueryClient()
  const [filing, setFiling] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [filed, setFiled] = useState(null)

  const { data: reports, isLoading } = useQuery({
    queryKey: ['my-blotter', profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('blotter_reports')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema) })

  async function onSubmit(values) {
    setSubmitError(null)
    try {
      const { data, error } = await supabase
        .from('blotter_reports')
        .insert({
          complainant_id: profile.id,
          incident_type: values.incident_type,
          incident_at: new Date(values.incident_at).toISOString(),
          location: values.location,
          respondent_name: values.respondent_name || null,
          respondent_address: values.respondent_address || null,
          narrative: values.narrative,
        })
        .select('ref_no')
        .single()
      if (error) throw error

      setFiled(data.ref_no)
      setFiling(false)
      reset()
      queryClient.invalidateQueries({ queryKey: ['my-blotter'] })
    } catch (err) {
      setSubmitError(friendlyError(err, 'Your report could not be filed. Please try again.'))
    }
  }

  return (
    <div className="dash-body">
      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <div className="grow">
          <span className="eyebrow">Blotter</span>
          <h1 style={{ fontSize: 27, margin: '8px 0 0' }}>Incident reports</h1>
        </div>
        {!filing && isApproved && (
          <Button size="m" auto icon="alert" onClick={() => { setFiling(true); setFiled(null) }}>
            File a report
          </Button>
        )}
      </div>

      {filed && (
        <Notice icon="check" title="Your report has been filed">
          Reference <b>{filed}</b>. The barangay will contact you about mediation. Keep this
          reference — you can also track it publicly using your surname.
        </Notice>
      )}

      <Notice tone="danger" icon="alert" title="If this is an emergency">
        Do not file it here. Call the barangay emergency hotline or the police. The blotter is read
        during office hours.
      </Notice>

      {filing ? (
        <Card padded>
          <h2 style={{ fontSize: 22, marginBottom: 8 }}>File a blotter report</h2>
          <p style={{ fontSize: 15, color: 'var(--ink-500)', marginBottom: 24 }}>
            This creates an official barangay record. Give as much detail as you can — what
            happened, where, and when.
          </p>

          {submitError && (
            <div style={{ marginBottom: 20 }}>
              <Notice tone="danger" icon="alert" title="Could not file the report">
                {submitError}
              </Notice>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="grid-2" style={{ gap: 20 }}>
              <Field
                as="select"
                label="Kind of incident"
                required
                error={errors.incident_type?.message}
                {...register('incident_type')}
              >
                <option value="">Select</option>
                {INCIDENT_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Field>

              <Field
                label="When did it happen?"
                required
                type="datetime-local"
                error={errors.incident_at?.message}
                {...register('incident_at')}
              />

              <div className="span-2">
                <Field
                  label="Where did it happen?"
                  required
                  placeholder="Street, purok, or a landmark"
                  error={errors.location?.message}
                  {...register('location')}
                />
              </div>

              <Field
                label="Person complained about"
                hint="optional"
                placeholder="Leave blank if unknown"
                help="You do not have to name anyone"
                error={errors.respondent_name?.message}
                {...register('respondent_name')}
              />

              <Field
                label="Their address"
                hint="optional"
                placeholder="If you know it"
                error={errors.respondent_address?.message}
                {...register('respondent_address')}
              />

              <div className="span-2">
                <Field
                  as="textarea"
                  label="What happened?"
                  required
                  placeholder="Describe the incident in your own words. Include anything that would help the barangay understand and respond."
                  help="This becomes part of the official barangay record"
                  error={errors.narrative?.message}
                  {...register('narrative')}
                />
              </div>
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
              <Button type="submit" auto icon="alert" disabled={isSubmitting}>
                {isSubmitting ? 'Filing…' : 'File this report'}
              </Button>
              <Button type="button" auto variant="ghost" onClick={() => setFiling(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <Card flush>
          <CardHeader title="My reports" />
          {isLoading ? (
            <LoadingRows rows={3} />
          ) : reports?.length ? (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Incident</th>
                  <th>Filed</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((b) => (
                  <tr key={b.id}>
                    <td className="ref" data-label="Reference">{b.ref_no}</td>
                    <td className="doc" data-label="Incident">{b.incident_type}</td>
                    <td className="when" data-label="Filed">{shortDate(b.created_at)}</td>
                    <td data-label="Status">
                      <Badge tone={BLOTTER_STATUS_TONE[b.status]}>
                        {BLOTTER_STATUS_LABEL[b.status] ?? b.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState
              icon="alert"
              title="No reports filed"
              action={
                isApproved ? (
                  <Button size="m" auto onClick={() => setFiling(true)}>
                    File a report
                  </Button>
                ) : null
              }
            >
              A blotter report puts an incident on the official barangay record and lets you follow
              what the barangay does about it.
            </EmptyState>
          )}
        </Card>
      )}

      {!filing && (
        <Card padded style={{ background: 'var(--ink-50)' }}>
          <div className="row" style={{ gap: 12, marginBottom: 10 }}>
            <Icon name="incognito" style={{ color: 'var(--primary-600)' }} />
            <h3 style={{ fontSize: 16.5 }}>Would you rather not give your name?</h3>
          </div>
          <p style={{ fontSize: 14, color: 'var(--ink-500)', marginBottom: 16 }}>
            A blotter report is an official record filed in your name. If naming yourself would put
            you at risk, send an anonymous message instead — nothing about it is linked to you.
          </p>
          <Button to="/anonymous" size="s" variant="secondary" auto icon="incognito">
            Send an anonymous message
          </Button>
        </Card>
      )}
    </div>
  )
}
