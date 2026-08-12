import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase, friendlyError } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Badge, Button, Card, CardHeader, Field, Notice } from '../../components/ui'
import { EmptyState, LoadingRows } from '../../components/ui/States'
import { longDate } from '../../lib/formatters'

const CATEGORIES = ['Health & sanitation', 'Utilities', 'Governance', 'Peace & order', 'Events', 'Emergency']

const schema = z.object({
  title: z.string().trim().min(6, 'Give the notice a clear title'),
  category: z.string().min(1, 'Choose a category'),
  excerpt: z.string().trim().max(200, 'Keep the summary under 200 characters').optional(),
  body: z.string().trim().min(20, 'Write the notice itself'),
  publish: z.boolean().default(true),
})

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

export default function AnnouncementsAdmin() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(null) // null | 'new' | row
  const [error, setError] = useState(null)

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

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema) })

  function startNew() {
    reset({ title: '', category: '', excerpt: '', body: '', publish: true })
    setEditing('new')
  }

  function startEdit(row) {
    reset({
      title: row.title,
      category: row.category ?? '',
      excerpt: row.excerpt ?? '',
      body: row.body,
      publish: !!row.published_at,
    })
    setEditing(row)
  }

  async function onSubmit(values) {
    setError(null)
    try {
      const payload = {
        title: values.title,
        category: values.category,
        excerpt: values.excerpt || values.body.slice(0, 160),
        body: values.body,
        published_at: values.publish ? new Date().toISOString() : null,
        author_id: profile.id,
      }

      if (editing === 'new') {
        payload.slug = `${slugify(values.title)}-${Date.now().toString(36).slice(-4)}`
        const { error: insertError } = await supabase.from('announcements').insert(payload)
        if (insertError) throw insertError
      } else {
        // Keep the original publish date if it was already live.
        if (values.publish && editing.published_at) payload.published_at = editing.published_at
        const { error: updateError } = await supabase.from('announcements').update(payload).eq('id', editing.id)
        if (updateError) throw updateError
      }

      setEditing(null)
      queryClient.invalidateQueries({ queryKey: ['admin-announcements'] })
      queryClient.invalidateQueries({ queryKey: ['announcements'] })
    } catch (err) {
      setError(friendlyError(err, 'The notice could not be saved.'))
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
              <Button type="button" auto variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <Card flush>
          <CardHeader title={`${data?.length ?? 0} notices`} />
          {isLoading ? (
            <LoadingRows rows={3} />
          ) : data?.length ? (
            <table className="tbl">
              <thead>
                <tr>
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
