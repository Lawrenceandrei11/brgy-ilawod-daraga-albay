import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase, friendlyError } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Badge, Button, Card, CardHeader, Check, Field, Notice, PngSlot } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { ProfilePictureCard } from '../../components/ProfilePictureCard'
import { longDate, shortDate } from '../../lib/formatters'

const schema = z.object({
  mobile: z.string().trim().regex(/^09\d{9}$/, 'Enter an 11-digit mobile number starting with 09'),
  civil_status: z.string().optional(),
  purok: z.coerce.number().int().min(1).max(7),
  address_line: z.string().trim().min(6, 'Enter your house number and street'),
  years_of_residency: z.coerce.number().int().min(0).max(120),
  household_head: z.string().trim().optional(),
  household_size: z.coerce.number().int().min(1).max(30).optional(),
  sms_opt_in: z.boolean().default(true),
})

export default function Profile() {
  const { profile, refetchProfile, status } = useAuth()
  const queryClient = useQueryClient()

  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const { data: enrollment, refetch: refetchEnrollment } = useQuery({
    queryKey: ['face-enrollment', profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('face_enrollment_status')
      if (error) throw error
      return data?.[0] ?? null
    },
  })

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({
    resolver: zodResolver(schema),
    values: {
      mobile: profile?.mobile ?? '',
      civil_status: profile?.civil_status ?? '',
      purok: profile?.purok ?? '',
      address_line: profile?.address_line ?? '',
      years_of_residency: profile?.years_of_residency ?? 0,
      household_head: profile?.household_head ?? '',
      household_size: profile?.household_size ?? '',
      sms_opt_in: profile?.sms_opt_in ?? true,
    },
  })

  async function onSubmit(values) {
    setSaveError(null)
    setSaved(false)
    try {
      // role, status and resident_id are deliberately absent. The
      // guard_profile_columns trigger would reject them anyway.
      const { error } = await supabase
        .from('profiles')
        .update({
          mobile: values.mobile,
          civil_status: values.civil_status || null,
          purok: Number(values.purok),
          address_line: values.address_line,
          years_of_residency: Number(values.years_of_residency),
          household_head: values.household_head || null,
          household_size: values.household_size ? Number(values.household_size) : null,
          // guard_profile_columns deliberately leaves this one alone, which is
          // what lets a resident switch their own texts off.
          sms_opt_in: values.sms_opt_in,
        })
        .eq('id', profile.id)
      if (error) throw error

      await refetchProfile()
      setSaved(true)
    } catch (err) {
      setSaveError(friendlyError(err, 'Your details could not be saved.'))
    }
  }

  async function deleteEnrollment() {
    setDeleting(true)
    try {
      // The RLS delete policy permits the owner. This is the promise the
      // consent notice makes, so it has to actually work.
      const { error } = await supabase.from('face_templates').delete().eq('profile_id', profile.id)
      if (error) throw error
      await refetchEnrollment()
      queryClient.invalidateQueries({ queryKey: ['face-enrollment'] })
      setConfirmDelete(false)
    } catch (err) {
      setSaveError(friendlyError(err, 'Your enrollment could not be deleted.'))
    } finally {
      setDeleting(false)
    }
  }

  const enrolled = (enrollment?.angles ?? 0) > 0

  return (
    <div className="dash-body">
      <div>
        <span className="eyebrow">My profile</span>
        <h1 style={{ fontSize: 27, margin: '8px 0 0' }}>Your barangay record</h1>
      </div>

      {saved && (
        <Notice icon="check" title="Saved">
          Your details have been updated on the barangay record.
        </Notice>
      )}
      {saveError && (
        <Notice tone="danger" icon="alert" title="Could not save">
          {saveError}
        </Notice>
      )}

      <div className="grid-2 split" style={{ gap: 24, alignItems: 'start' }}>
        <div className="stack" style={{ gap: 24 }}>
          <ProfilePictureCard placeholder="resident-placeholder.png" />

          <Card flush>
            <CardHeader title="Identity">
              <Badge tone={status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'pending'}>
                {status === 'approved' ? 'Approved' : status === 'rejected' ? 'Not approved' : 'Pending review'}
              </Badge>
            </CardHeader>
            <div style={{ padding: '20px 26px' }}>
              <Notice tone="quiet" icon="lock" title="These can only be changed by the barangay">
                Your name, date of birth and Resident ID are on the official record. Visit the
                barangay hall with a valid ID if any of them is wrong.
              </Notice>
              <div className="grid-2" style={{ gap: '14px 20px', marginTop: 20 }}>
                {[
                  ['Full legal name', profile?.full_name],
                  ['Resident ID', profile?.resident_id ?? 'Issued on approval'],
                  ['Date of birth', profile?.date_of_birth ? longDate(profile.date_of_birth) : '—'],
                  ['Sex', profile?.sex],
                  ['Email', profile?.email],
                  ['Valid ID', profile?.valid_id_type],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div style={{ fontSize: 12, color: 'var(--ink-400)', fontWeight: 600 }}>{k}</div>
                    <div style={{ fontSize: 14.5, color: 'var(--ink-800)' }}>{v || '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card padded>
            <h3 style={{ fontSize: 18, marginBottom: 6 }}>Details you can update</h3>
            <p style={{ fontSize: 14.5, color: 'var(--ink-500)', marginBottom: 22 }}>
              Keeping your address and purok current is what stops a clearance being sent back.
            </p>

            <form onSubmit={handleSubmit(onSubmit)} noValidate>
              <div className="grid-2" style={{ gap: 20 }}>
                <Field
                  label="Mobile number"
                  required
                  inputMode="numeric"
                  error={errors.mobile?.message}
                  {...register('mobile')}
                />
                <Field
                  as="select"
                  label="Civil status"
                  hint="optional"
                  error={errors.civil_status?.message}
                  {...register('civil_status')}
                >
                  <option value="">Select</option>
                  {['Single', 'Married', 'Widowed', 'Separated'].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Field>

                <Field as="select" label="Purok" required error={errors.purok?.message} {...register('purok')}>
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
                  error={errors.years_of_residency?.message}
                  {...register('years_of_residency')}
                />

                <div className="span-2">
                  <Field
                    label="House number and street"
                    required
                    error={errors.address_line?.message}
                    {...register('address_line')}
                  />
                </div>

                <Field
                  label="Head of household"
                  hint="optional"
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

                <div className="span-2">
                  <div className="field">
                    <label style={{ marginBottom: 8 }}>Text messages</label>
                    <Check
                      title="Text me about my requests"
                      description="We text the number above when a request is approved, ready for pickup, released, returned for correction or scheduled, and when the barangay sends an urgent notice. Untick this to stop them."
                      {...register('sms_opt_in')}
                    />
                  </div>
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--ink-100)', marginTop: 24, paddingTop: 22 }}>
                <Button type="submit" auto icon="check" disabled={isSubmitting || !isDirty}>
                  {isSubmitting ? 'Saving…' : 'Save my details'}
                </Button>
              </div>
            </form>
          </Card>
        </div>

        <aside className="stack" style={{ gap: 24 }}>
          <Card padded>
            <div className="row" style={{ gap: 12, marginBottom: 14 }}>
              <Icon name="fp" size="lg" style={{ color: 'var(--primary-600)' }} />
              <h3 style={{ fontSize: 16.5, flex: 1 }}>Face enrollment</h3>
            </div>

            {enrolled ? (
              <>
                <Badge tone={enrollment.confirmed ? 'verified' : 'pending'} style={{ marginBottom: 14 }}>
                  {enrollment.confirmed ? 'Enrolled & confirmed' : 'Awaiting confirmation'}
                </Badge>
                <p style={{ fontSize: 13.5, color: 'var(--ink-500)', marginBottom: 16 }}>
                  Enrolled {shortDate(enrollment.enrolled_at)}, {enrollment.angles}{' '}
                  {enrollment.angles === 1 ? 'angle' : 'angles'}.
                  {!enrollment.confirmed &&
                    ' The secretary confirms this in person before it can be used to collect documents.'}
                </p>

                <div className="stack" style={{ gap: 10 }}>
                  <Button to="/app/enroll" size="s" variant="secondary" block icon="scan">
                    Re-enrol my face
                  </Button>

                  {!confirmDelete ? (
                    <Button
                      size="s"
                      variant="ghost"
                      block
                      onClick={() => setConfirmDelete(true)}
                      style={{ color: 'var(--danger-600)' }}
                    >
                      Delete my enrollment
                    </Button>
                  ) : (
                    <div
                      style={{
                        background: 'var(--danger-100)',
                        border: '1px solid #F3C9C7',
                        borderRadius: 'var(--r-md)',
                        padding: 16,
                      }}
                    >
                      <b style={{ display: 'block', fontSize: 14, color: 'var(--danger-600)', marginBottom: 6 }}>
                        Delete your facial template?
                      </b>
                      <p style={{ fontSize: 13, color: 'var(--danger-600)', marginBottom: 14 }}>
                        It is erased from the barangay record immediately and cannot be recovered.
                        You will sign in with your password instead, and can enrol again any time.
                      </p>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <Button size="s" variant="danger" auto onClick={deleteEnrollment} disabled={deleting}>
                          {deleting ? 'Deleting…' : 'Yes, delete it'}
                        </Button>
                        <Button size="s" variant="ghost" auto onClick={() => setConfirmDelete(false)}>
                          Keep it
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: 13.5, color: 'var(--ink-500)', marginBottom: 16 }}>
                  You have not enrolled your face. Enrolling lets you sign in by looking at the
                  camera instead of typing a password.
                </p>
                <Button to="/app/enroll" size="s" block icon="scan">
                  Enrol my face
                </Button>
              </>
            )}
          </Card>

          <Card padded>
            <h3 style={{ fontSize: 16.5, marginBottom: 12 }}>Your ID on file</h3>
            <PngSlot
              name="valid-id-placeholder.png"
              style={{ width: '100%', height: 120, marginBottom: 12 }}
            />
            <p style={{ fontSize: 13.5, color: 'var(--ink-500)' }}>
              {profile?.valid_id_path
                ? 'Held privately. Only you and barangay staff can see it.'
                : 'No ID photograph on file. Visit the barangay hall to add one.'}
            </p>
          </Card>

          <Notice icon="lock" title="Your rights over this data">
            Barangay Ilawod is the data controller. You may ask to see, correct or erase what is
            held about you, and you can delete your facial template yourself at any time.
          </Notice>
        </aside>
      </div>
    </div>
  )
}
