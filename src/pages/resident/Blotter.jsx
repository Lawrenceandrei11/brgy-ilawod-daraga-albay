import { useEffect, useState } from 'react'
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
import {
  EVIDENCE_ACCEPT_ATTR,
  MAX_EVIDENCE_IMAGES,
  attachEvidence,
  selectionProblem,
  validateEvidenceFile,
} from '../../lib/blotterEvidence'

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

/**
 * One chosen photo, shown before anything is uploaded.
 *
 * The object URL belongs to this component so it is revoked when the photo is
 * removed or the form closes, instead of leaking for the life of the page.
 */
function Thumb({ file, onRemove }) {
  const [url, setUrl] = useState(null)

  useEffect(() => {
    const made = URL.createObjectURL(file)
    setUrl(made)
    return () => URL.revokeObjectURL(made)
  }, [file])

  return (
    <div style={{ position: 'relative' }}>
      {url && (
        <img
          src={url}
          alt={file.name}
          style={{
            width: 96,
            height: 96,
            objectFit: 'cover',
            borderRadius: 'var(--r-md)',
            border: '1px solid var(--ink-200)',
            display: 'block',
          }}
        />
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${file.name}`}
        style={{
          position: 'absolute',
          top: -8,
          right: -8,
          width: 24,
          height: 24,
          borderRadius: 'var(--r-pill)',
          border: '1px solid var(--ink-200)',
          background: 'var(--surface)',
          cursor: 'pointer',
          fontSize: 14,
          lineHeight: 1,
          color: 'var(--ink-600)',
        }}
      >
        ×
      </button>
    </div>
  )
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

  // Chosen photos, still only in the browser. Nothing is uploaded until the
  // report itself has been filed.
  const [photos, setPhotos] = useState([])
  const [photoProblem, setPhotoProblem] = useState(null)

  // After filing: which attachments did not make it, and the files to retry.
  const [attachFailed, setAttachFailed] = useState([])
  const [retryFiles, setRetryFiles] = useState([])
  const [attaching, setAttaching] = useState(null)

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

  function choosePhotos(e) {
    const chosen = Array.from(e.target.files ?? [])
    // Cleared so that picking the same file again still fires onChange.
    e.target.value = ''
    if (chosen.length === 0) return

    const tooMany = selectionProblem(photos.length, chosen.length)
    if (tooMany) {
      setPhotoProblem(tooMany)
      return
    }

    const rejected = chosen.map((f) => validateEvidenceFile(f)).find(Boolean)
    setPhotoProblem(rejected ?? null)
    if (rejected) return

    setPhotos((current) => [...current, ...chosen])
  }

  function removePhoto(index) {
    setPhotoProblem(null)
    setPhotos((current) => current.filter((_, i) => i !== index))
  }

  /** Attach the photos that failed the first time, to the report already filed. */
  async function retryAttachments() {
    if (!filed?.reportId || retryFiles.length === 0) return
    setAttaching('retrying')
    const result = await attachEvidence({
      client: supabase,
      userId: profile.id,
      reportId: filed.reportId,
      files: retryFiles,
    })
    setAttachFailed(result.failed)
    setRetryFiles(result.failed.length ? retryFiles.filter((f) => result.failed.some((x) => x.name === f.name)) : [])
    setAttaching(null)
    queryClient.invalidateQueries({ queryKey: ['my-blotter'] })
  }

  /**
   * File the report, then attach the photographs.
   *
   * In that order, and the report is never rolled back. A blotter report is an
   * official record; losing it because a photograph failed to upload would be
   * the worse outcome by far. So the insert happens first, and an attachment
   * that fails is reported as a failed attachment with a retry, against a
   * report that already exists and is already on the record.
   */
  async function onSubmit(values) {
    setSubmitError(null)
    setAttachFailed([])
    setRetryFiles([])

    let report
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
        .select('id, ref_no')
        .single()
      if (error) throw error
      report = data
    } catch (err) {
      setSubmitError(friendlyError(err, 'Your report could not be filed. Please try again.'))
      return
    }

    // The report is filed. Nothing below here may undo that.
    if (photos.length > 0) {
      setAttaching('uploading')
      const result = await attachEvidence({
        client: supabase,
        userId: profile.id,
        reportId: report.id,
        files: photos,
      })
      setAttachFailed(result.failed)
      setRetryFiles(photos.filter((f) => result.failed.some((x) => x.name === f.name)))
      setAttaching(null)
    }

    setFiled({ refNo: report.ref_no, reportId: report.id })
    setFiling(false)
    setPhotos([])
    setPhotoProblem(null)
    reset()
    queryClient.invalidateQueries({ queryKey: ['my-blotter'] })
  }

  return (
    <div className="dash-body">
      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <div className="grow">
          <span className="eyebrow">Blotter</span>
          <h1 style={{ fontSize: 27, margin: '8px 0 0' }}>Incident reports</h1>
        </div>
        {!filing && isApproved && (
          <Button size="m" auto icon="alert" onClick={() => { setFiling(true); setFiled(null); setAttachFailed([]) }}>
            File a report
          </Button>
        )}
      </div>

      {filed && (
        <Notice icon="check" title="Your report has been filed">
          Reference <b>{filed.refNo}</b>. The barangay will contact you about mediation. Keep this
          reference for when you follow it up at the hall.
        </Notice>
      )}

      {filed && attachFailed.length > 0 && (
        <Notice tone="danger" icon="alert" title="Some photos were not attached">
          <p style={{ marginBottom: 10 }}>
            Your report is filed and on the record — only the photos below did not attach.
          </p>
          <ul style={{ margin: '0 0 12px 18px', fontSize: 14 }}>
            {attachFailed.map((f) => (
              <li key={f.name}>
                <b>{f.name}</b> — {f.message}
              </li>
            ))}
          </ul>
          {retryFiles.length > 0 && (
            <Button
              size="s"
              auto
              variant="secondary"
              disabled={attaching === 'retrying'}
              onClick={retryAttachments}
            >
              {attaching === 'retrying' ? 'Attaching…' : 'Try attaching them again'}
            </Button>
          )}
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

            {/* Supporting photos. Chosen here, uploaded only once the report
                itself has been filed, and never shown to anyone but the
                barangay staff reviewing the report. */}
            <div className="field" style={{ marginTop: 26 }}>
              <label htmlFor="evidence">
                Photos of the incident <em>optional</em>
              </label>
              <span className="help">
                Up to {MAX_EVIDENCE_IMAGES} photos — JPEG, PNG or WebP, 5 MB each. Only barangay
                staff reviewing this report can see them.
              </span>

              {photos.length > 0 && (
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', margin: '14px 0' }}>
                  {photos.map((file, i) => (
                    <Thumb key={`${file.name}-${i}`} file={file} onRemove={() => removePhoto(i)} />
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <label
                  className="btn btn-s btn-secondary btn-auto"
                  style={{
                    cursor: photos.length >= MAX_EVIDENCE_IMAGES ? 'not-allowed' : 'pointer',
                    opacity: photos.length >= MAX_EVIDENCE_IMAGES ? 0.5 : 1,
                  }}
                >
                  {photos.length ? 'Add another photo' : 'Choose photos'}
                  <input
                    id="evidence"
                    type="file"
                    multiple
                    accept={EVIDENCE_ACCEPT_ATTR}
                    onChange={choosePhotos}
                    disabled={photos.length >= MAX_EVIDENCE_IMAGES}
                    style={{ display: 'none' }}
                  />
                </label>
                {photos.length > 0 && (
                  <span style={{ fontSize: 13, color: 'var(--ink-400)' }}>
                    {photos.length} of {MAX_EVIDENCE_IMAGES} chosen. Nothing is uploaded until you
                    file the report.
                  </span>
                )}
              </div>

              {photoProblem && (
                <span className="help help-err" role="alert">
                  {photoProblem}
                </span>
              )}
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
              <Button type="submit" auto icon="alert" disabled={isSubmitting || !!attaching}>
                {attaching === 'uploading'
                  ? 'Attaching your photos…'
                  : isSubmitting
                    ? 'Filing…'
                    : 'File this report'}
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
          <Button to="/app/anonymous" size="s" variant="secondary" auto icon="incognito">
            Send an anonymous message
          </Button>
        </Card>
      )}
    </div>
  )
}
