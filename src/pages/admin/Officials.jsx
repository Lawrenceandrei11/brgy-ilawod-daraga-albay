import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase, friendlyError } from '../../lib/supabase'
import { Button, Card, CardHeader, Field, Notice, PngSlot } from '../../components/ui'
import { EmptyState, LoadingRows } from '../../components/ui/States'

const BLANK = { name: '', position: '', term_start: '', term_end: '', sort_order: 0, active: true }

export default function Officials() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(BLANK)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-officials'],
    queryFn: async () => {
      const { data, error } = await supabase.from('officials').select('*').order('sort_order')
      if (error) throw error
      return data
    },
  })

  function startNew() {
    setForm({ ...BLANK, sort_order: (data?.length ?? 0) + 1 })
    setEditing('new')
  }

  function startEdit(o) {
    setForm({
      name: o.name,
      position: o.position,
      term_start: o.term_start ?? '',
      term_end: o.term_end ?? '',
      sort_order: o.sort_order,
      active: o.active,
    })
    setEditing(o)
  }

  async function save() {
    if (!form.name.trim() || !form.position.trim()) {
      setError('A name and a position are both required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const payload = {
        name: form.name.trim(),
        position: form.position.trim(),
        term_start: form.term_start || null,
        term_end: form.term_end || null,
        sort_order: Number(form.sort_order) || 0,
        active: !!form.active,
      }
      const { error: writeError } =
        editing === 'new'
          ? await supabase.from('officials').insert(payload)
          : await supabase.from('officials').update(payload).eq('id', editing.id)
      if (writeError) throw writeError

      setEditing(null)
      queryClient.invalidateQueries({ queryKey: ['admin-officials'] })
      queryClient.invalidateQueries({ queryKey: ['officials'] })
    } catch (err) {
      setError(friendlyError(err, 'Could not save that official.'))
    } finally {
      setBusy(false)
    }
  }

  async function remove(o) {
    if (!window.confirm(`Remove ${o.name} from the council list?`)) return
    try {
      const { error: deleteError } = await supabase.from('officials').delete().eq('id', o.id)
      if (deleteError) throw deleteError
      queryClient.invalidateQueries({ queryKey: ['admin-officials'] })
      queryClient.invalidateQueries({ queryKey: ['officials'] })
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  return (
    <div className="dash-body">
      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <div className="grow">
          <span className="eyebrow">Officials</span>
          <h1 style={{ fontSize: 27, margin: '8px 0 0' }}>The barangay council</h1>
        </div>
        {!editing && (
          <Button size="m" auto icon="user" onClick={startNew}>
            Add an official
          </Button>
        )}
      </div>

      <Notice icon="info" title="This list is public">
        It appears on the home page so residents can see who handles their requests. The seeded
        entries say "To be confirmed" — replace them with the real council.
      </Notice>

      {error && <Notice tone="danger" icon="alert" title="Could not save">{error}</Notice>}

      {editing ? (
        <Card padded style={{ maxWidth: 640 }}>
          <h2 style={{ fontSize: 20, marginBottom: 20 }}>
            {editing === 'new' ? 'Add an official' : `Edit ${editing.name}`}
          </h2>
          <div className="stack" style={{ gap: 18 }}>
            <Field label="Full name" required value={form.name} onChange={set('name')} placeholder="Juan Dela Cruz" />
            <Field
              label="Position"
              required
              value={form.position}
              onChange={set('position')}
              placeholder="Punong Barangay"
              help="As it should appear publicly"
            />
            <div className="grid-2" style={{ gap: 18 }}>
              <Field label="Term start" type="date" value={form.term_start} onChange={set('term_start')} hint="optional" />
              <Field label="Term end" type="date" value={form.term_end} onChange={set('term_end')} hint="optional" />
            </div>
            <Field
              label="Order shown"
              type="number"
              value={form.sort_order}
              onChange={set('sort_order')}
              help="Lower numbers appear first"
            />
            <label className="check">
              <input type="checkbox" checked={form.active} onChange={set('active')} />
              <span>
                <b>Currently serving</b>
                <span>Only serving officials are shown publicly</span>
              </span>
            </label>
          </div>

          <div style={{ borderTop: '1px solid var(--ink-100)', marginTop: 22, paddingTop: 20, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Button auto icon="check" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            <Button auto variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : (
        <Card flush>
          <CardHeader title={`${data?.length ?? 0} on the list`} />
          {isLoading ? (
            <LoadingRows rows={4} />
          ) : data?.length ? (
            <div className="feed">
              {data.map((o) => (
                <div className="feed-item" key={o.id} style={{ alignItems: 'center' }}>
                  <PngSlot name="official-placeholder.png" className="thumb" pill style={{ width: 52, height: 52 }} />
                  <div className="grow">
                    <b>{o.name}</b>
                    <span>
                      {o.position}
                      {!o.active && ' · no longer serving'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Button size="s" auto variant="secondary" onClick={() => startEdit(o)}>
                      Edit
                    </Button>
                    <Button size="s" auto variant="ghost" style={{ color: 'var(--danger-600)' }} onClick={() => remove(o)}>
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="users" title="No officials listed" action={<Button size="m" auto onClick={startNew}>Add the first</Button>} />
          )}
        </Card>
      )}
    </div>
  )
}
