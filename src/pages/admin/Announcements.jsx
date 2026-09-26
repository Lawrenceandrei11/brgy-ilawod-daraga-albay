import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase, friendlyError } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Badge, Button, Card, CardHeader, Check, Field, Notice, PhotoPicker } from '../../components/ui'
import { EmptyState, LoadingRows } from '../../components/ui/States'
import { longDate } from '../../lib/formatters'
import { announcementSmsPreview, broadcastDuration } from '../../lib/sms'
import { removePhoto, uploadPhoto } from '../../lib/storage'

const CATEGORIES = ['Health & sanitation', 'Utilities', 'Governance', 'Peace & order', 'Events', 'Emergency']

const schema = z.object({
  title: z.string().trim().min(6, 'Give the notice a clear title'),
  category: z.string().min(1, 'Choose a category'),
  excerpt: z.string().trim().max(200, 'Keep the summary under 200 characters').optional(),
  body: z.string().trim().min(20, 'Write the notice itself'),
  publish: z.boolean().default(true),
  // Never on by default. A text costs the barangay's daily allowance and
  // arrives on a handset at whatever hour it is written.
  sms: z.boolean().default(false),
})

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

export default function AnnouncementsAdmin() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(null) // null | 'new' | row
  const [error, setError] = useState(null)
  // Kept apart from `error` on purpose: a notice that saved but could not be
  // texted has still been published, and saying otherwise would be a lie.
  const [smsNotice, setSmsNotice] = useState(null)
  // Ids, not rows: a row object goes stale the moment the list refetches.
  const [selected, setSelected] = useState(() => new Set())
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
  // A chosen replacement cover, not yet uploaded. Null keeps the current one.
  const [coverFile, setCoverFile] = useState(null)

  const { data: recipients } = useQuery({
    queryKey: ['sms-recipient-count'],
    enabled: !!editing,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('sms_recipient_count')
      if (error) throw error
      return data
    },
  })

  const { data, isLoading } = useQuery({
    queryKey: ['admin-announcements'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  // Only ids still on screen count. Another staff member may have removed a
  // notice since it was ticked, and "delete 3 selected" must mean these 3.
  const visibleIds = (data ?? []).map((a) => a.id)
  const selectedIds = visibleIds.filter((id) => selected.has(id))
  const allSelected = visibleIds.length > 0 && selectedIds.length === visibleIds.length
  const someSelected = selectedIds.length > 0 && !allSelected

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(visibleIds))
  }

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema) })

  function startNew() {
    reset({ title: '', category: '', excerpt: '', body: '', publish: true, sms: false })
    setEditing('new')
    setCoverFile(null)
    setSmsNotice(null)
  }

  function startEdit(row) {
    reset({
      title: row.title,
      category: row.category ?? '',
      excerpt: row.excerpt ?? '',
      body: row.body,
      publish: !!row.published_at,
      sms: false,
    })
    setEditing(row)
    setCoverFile(null)
    setSmsNotice(null)
  }

  async function onSubmit(values) {
    setError(null)
    setSmsNotice(null)

    // Asked before anything is written, so declining leaves the notice
    // publishable rather than losing what was typed.
    let alsoText = values.publish && values.sms
    if (alsoText) {
      const n = recipients?.reachable ?? 0
      alsoText = window.confirm(
        `${n} ${n === 1 ? 'resident' : 'residents'} will be texted:\n\n` +
          `${announcementSmsPreview(values.title)}\n\n` +
          `The network allows one text every ten seconds, so this takes ${broadcastDuration(n)} ` +
          `to finish. Send it?`
      )
    }

    let savedId = editing === 'new' ? null : editing.id
    // Uploaded first so the row can point at it, and removed again below if
    // the notice itself cannot be saved.
    let uploadedCover = null

    try {
      if (coverFile) uploadedCover = await uploadPhoto(coverFile, 'announcements')

      const payload = {
        title: values.title,
        category: values.category,
        excerpt: values.excerpt || values.body.slice(0, 160),
        body: values.body,
        published_at: values.publish ? new Date().toISOString() : null,
        author_id: profile.id,
      }
      if (uploadedCover) payload.cover_path = uploadedCover

      if (editing === 'new') {
        payload.slug = `${slugify(values.title)}-${Date.now().toString(36).slice(-4)}`
        // .select() is not decoration: the id is what the SMS fan-out needs.
        const { data: created, error: insertError } = await supabase
          .from('announcements')
          .insert(payload)
          .select('id')
          .single()
        if (insertError) throw insertError
        savedId = created.id
      } else {
        // Keep the original publish date if it was already live.
        if (values.publish && editing.published_at) payload.published_at = editing.published_at
        const { error: updateError } = await supabase.from('announcements').update(payload).eq('id', editing.id)
        if (updateError) throw updateError
      }

      // Only now is the old cover unused.
      if (uploadedCover && editing !== 'new') removePhoto(editing.cover_path)

      setEditing(null)
      setCoverFile(null)
      queryClient.invalidateQueries({ queryKey: ['admin-announcements'] })
      queryClient.invalidateQueries({ queryKey: ['announcements'] })
    } catch (err) {
      if (uploadedCover) removePhoto(uploadedCover)
      setError(friendlyError(err, 'The notice could not be saved.'))
      return
    }

    // From here the notice is saved and committed. Everything below is about
    // the text messages alone, in its own try, reported in its own notice.
    if (!alsoText || !savedId) return

    try {
      const { data: result, error: rpcError } = await supabase.rpc('queue_announcement_sms', {
        p_announcement_id: savedId,
      })
      if (rpcError) throw rpcError

      setSmsNotice(
        result?.queued > 0
          ? {
              tone: 'info',
              title: `Texting ${result.queued} ${result.queued === 1 ? 'resident' : 'residents'}`,
              body:
                `They will arrive over ${broadcastDuration(result.queued)}. ` +
                [
                  result.no_mobile > 0 && `${result.no_mobile} have no mobile number on file`,
                  result.opted_out > 0 && `${result.opted_out} have turned texts off`,
                ]
                  .filter(Boolean)
                  .join(' and ') || 'Every approved resident is being reached.',
            }
          : {
              tone: 'quiet',
              title: 'No texts queued',
              body:
                result?.already_sent > 0
                  ? 'This notice has already been texted to the barangay. Residents are not sent it twice.'
                  : 'No approved resident has a mobile number the network will accept.',
            }
      )
      queryClient.invalidateQueries({ queryKey: ['admin-sms'] })
    } catch (err) {
      setSmsNotice({
        tone: 'danger',
        title: 'The notice is live, but the texts were not queued',
        body: friendlyError(err, 'The text messages could not be queued. The notice itself is saved.'),
      })
    }
  }

  async function remove(row) {
    if (!window.confirm(`Delete "${row.title}"? Residents will no longer see it.`)) return
    try {
      const { error: deleteError } = await supabase.from('announcements').delete().eq('id', row.id)
      if (deleteError) throw deleteError
      queryClient.invalidateQueries({ queryKey: ['admin-announcements'] })
      queryClient.invalidateQueries({ queryKey: ['announcements'] })
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  async function removeSelected() {
    const ids = selectedIds
    if (!ids.length) return
    if (!window.confirm('Are you sure you want to delete the selected announcements?')) return

    setDeleteError(null)
    setDeleting(true)
    try {
      // One statement, so it is all or nothing -- the same delete remove()
      // does, and like it, it takes any texts queued for these notices with
      // it (sms_messages cascades). RLS is the real gate: for anyone who is
      // not staff it deletes nothing and raises no error, which is why the
      // rows that came back are counted rather than trusted.
      const { data: deleted, error: deleteErr } = await supabase
        .from('announcements')
        .delete()
        .in('id', ids)
        .select('id')
      if (deleteErr) throw deleteErr

      const count = deleted?.length ?? 0
      if (count < ids.length) {
        setDeleteError(
          count === 0
            ? 'None of the selected notices were deleted. You may not have permission to delete them.'
            : `${count} of ${ids.length} notices were deleted. The rest may already have been removed, or you may not have permission.`
        )
      }

      setSelected(new Set())
      queryClient.invalidateQueries({ queryKey: ['admin-announcements'] })
      queryClient.invalidateQueries({ queryKey: ['announcements'] })
    } catch (err) {
      // Nothing was deleted, so the ticks are kept for another try.
      setDeleteError(friendlyError(err, 'The selected notices could not be deleted.'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="dash-body">
      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <div className="grow">
          <span className="eyebrow">Announcements</span>
          <h1 style={{ fontSize: 27, margin: '8px 0 0' }}>Notices to the barangay</h1>
        </div>
        {!editing && (
          <Button size="m" auto icon="mega" onClick={startNew}>
            Write a notice
          </Button>
        )}
      </div>

      {error && <Notice tone="danger" icon="alert" title="Could not save">{error}</Notice>}

      {deleteError && <Notice tone="danger" icon="alert" title="Could not delete">{deleteError}</Notice>}

      {smsNotice && (
        <Notice
          tone={smsNotice.tone}
          icon={smsNotice.tone === 'danger' ? 'alert' : 'bell'}
          title={smsNotice.title}
        >
          {smsNotice.body}
        </Notice>
      )}

      {editing ? (
        <Card padded>
          <h2 style={{ fontSize: 21, marginBottom: 20 }}>
            {editing === 'new' ? 'New notice' : 'Edit notice'}
          </h2>

          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="stack" style={{ gap: 20 }}>
              <Field
                label="Title"
                required
                placeholder="Free anti-rabies vaccination at the barangay hall"
                error={errors.title?.message}
                {...register('title')}
              />

              <div className="grid-2" style={{ gap: 20 }}>
                <Field as="select" label="Category" required error={errors.category?.message} {...register('category')}>
                  <option value="">Select</option>
                  {CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Field>

                <div className="field">
                  <label style={{ marginBottom: 8 }}>Visibility</label>
                  <label className="check" style={{ marginTop: 6 }}>
                    <input type="checkbox" {...register('publish')} />
                    <span>
                      <b>Publish now</b>
                      <span>Unpublished notices are only visible to staff</span>
                    </span>
                  </label>
                </div>
              </div>

              <PhotoPicker
                label="Cover photo"
                currentPath={editing === 'new' ? null : editing.cover_path}
                file={coverFile}
                onChange={setCoverFile}
                placeholder="announcement-placeholder.png"
              />

              <div className="field">
                <label style={{ marginBottom: 8 }}>Text messages</label>
                <Check
                  title="Also text residents"
                  description={
                    recipients
                      ? `${recipients.reachable} of ${recipients.eligible} approved residents can be reached, ` +
                        `taking ${broadcastDuration(recipients.reachable)}. Leave this unticked to post quietly.`
                      : 'Off unless you tick it. Leave it unticked to post the notice quietly.'
                  }
                  {...register('sms')}
                />
              </div>

              <Field
                label="One-line summary"
                hint="optional"
                placeholder="Shown on the announcement card"
                help="Left blank, the first line of the notice is used"
                error={errors.excerpt?.message}
                {...register('excerpt')}
              />

              <Field
                as="textarea"
                label="The notice"
                required
                placeholder="Write it as you would post it on the barangay noticeboard."
                error={errors.body?.message}
                {...register('body')}
                style={{ minHeight: 220 }}
              />
            </div>

            <div style={{ borderTop: '1px solid var(--ink-100)', marginTop: 24, paddingTop: 22, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Button type="submit" auto icon="check" disabled={isSubmitting}>
                {isSubmitting ? 'Saving…' : editing === 'new' ? 'Post this notice' : 'Save changes'}
              </Button>
              <Button
                type="button"
                auto
                variant="ghost"
                onClick={() => {
                  setEditing(null)
                  setCoverFile(null)
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <Card flush>
          {/* In the card header, not the table's <thead>: on phones the head
              row is hidden and the table becomes stacked cards. */}
          <CardHeader title={`${data?.length ?? 0} notices`}>
            {data?.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <label className="check" style={{ alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected
                    }}
                    onChange={toggleAll}
                    disabled={deleting}
                  />
                  <span style={{ fontSize: 14, color: 'var(--ink-800)' }}>Select all</span>
                </label>
                {selectedIds.length > 0 && (
                  <Button size="s" auto variant="danger" onClick={removeSelected} disabled={deleting}>
                    {deleting ? 'Deleting…' : `Delete Selected (${selectedIds.length})`}
                  </Button>
                )}
              </div>
            )}
          </CardHeader>
          {isLoading ? (
            <LoadingRows rows={3} />
          ) : data?.length ? (
            <table className="tbl">
              <thead>
                <tr>
                  <th aria-label="Select" style={{ width: 1, paddingRight: 0 }} />
                  <th>Title</th>
                  <th>Category</th>
                  <th>Published</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.map((a) => (
                  <tr key={a.id}>
                    <td style={{ paddingRight: 0 }}>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={selected.has(a.id)}
                          onChange={() => toggle(a.id)}
                          disabled={deleting}
                          aria-label={`Select "${a.title}"`}
                        />
                      </label>
                    </td>
                    <td className="doc" data-label="Title">{a.title}</td>
                    <td className="when" data-label="Category">{a.category}</td>
                    <td className="when" data-label="Published">
                      {a.published_at ? longDate(a.published_at) : '—'}
                    </td>
                    <td data-label="Status">
                      <Badge tone={a.published_at ? 'approved' : 'pending'}>
                        {a.published_at ? 'Live' : 'Draft'}
                      </Badge>
                    </td>
                    <td data-label="Action">
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <Button size="s" auto variant="secondary" onClick={() => startEdit(a)}>
                          Edit
                        </Button>
                        <Button size="s" auto variant="ghost" style={{ color: 'var(--danger-600)' }} onClick={() => remove(a)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState
              icon="mega"
              title="No notices yet"
              action={<Button size="m" auto onClick={startNew}>Write the first one</Button>}
            >
              Notices appear on the public home page and on every resident's dashboard.
            </EmptyState>
          )}
        </Card>
      )}
    </div>
  )
}
