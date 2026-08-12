import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase, friendlyError } from '../../lib/supabase'
import { Badge, Button, Card, CardHeader, Field, Notice } from '../../components/ui'
import { EmptyState, LoadingRows } from '../../components/ui/States'
import { Icon } from '../../components/Icon'
import { relative, shortDate, timeOnly } from '../../lib/formatters'

const STATUS = {
  new: { label: 'Unread', tone: 'pending' },
  reviewing: { label: 'Being looked at', tone: 'processing' },
  actioned: { label: 'Acted on', tone: 'approved' },
  closed: { label: 'Closed', tone: 'released' },
}

/**
 * The anonymous inbox.
 *
 * There is nothing here to identify a sender, because no such column exists
 * on the table. Staff see the category, the message, and a reference code —
 * that is the whole record.
 */
export default function AnonymousInbox() {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState('new')
  const [open, setOpen] = useState(null)
  const [response, setResponse] = useState('')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-anonymous'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('anonymous_messages')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  const rows = (data ?? []).filter((m) => (filter === 'all' ? true : m.status === filter))

  async function setStatus(msg, status) {
    setBusy(msg.id)
    setError(null)
    try {
      const patch = { status }
      if (response.trim()) patch.response = response.trim()
      if (status !== 'new') {
        patch.handled_at = new Date().toISOString()
      }
      const { error: updateError } = await supabase.from('anonymous_messages').update(patch).eq('id', msg.id)
      if (updateError) throw updateError
      setResponse('')
      queryClient.invalidateQueries({ queryKey: ['admin-anonymous'] })
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="dash-body">
      <div>
        <span className="eyebrow">Anonymous inbox</span>
        <h1 style={{ fontSize: 27, margin: '8px 0 0' }}>Concerns sent without a name</h1>
      </div>

      <Notice icon="incognito" title="You cannot reply to most of these, and that is deliberate">
        These messages carry no name, account, IP address or device. Unless the sender chose to
        leave a contact detail, there is genuinely no way to trace or answer them — so they are
        judged on what they say, not on who sent them.
      </Notice>

      {error && <Notice tone="danger" icon="alert" title="Could not save">{error}</Notice>}

      <div className="filterbar">
        {[['new', 'Unread'], ['reviewing', 'Being looked at'], ['actioned', 'Acted on'], ['closed', 'Closed'], ['all', 'All']].map(
          ([k, label]) => (
            <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {label}
              {k !== 'all' && (data ?? []).filter((m) => m.status === k).length > 0 && (
                <span className="chip-n">{(data ?? []).filter((m) => m.status === k).length}</span>
              )}
            </button>
          )
        )}
      </div>

      <Card flush>
        <CardHeader title={`${rows.length} message${rows.length === 1 ? '' : 's'}`} />
        {isLoading ? (
          <LoadingRows rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState icon="incognito" title="Nothing here">
            {filter === 'new' ? 'Every anonymous message has been read.' : 'No messages match this filter.'}
          </EmptyState>
        ) : (
          <div className="feed">
            {rows.map((m) => {
              const expanded = open === m.id
              return (
                <div key={m.id} style={{ borderBottom: '1px solid var(--ink-100)' }}>
                  <button
                    onClick={() => setOpen(expanded ? null : m.id)}
                    style={{ width: '100%', textAlign: 'left', padding: '18px 26px', display: 'flex', gap: 14, alignItems: 'flex-start' }}
                  >
                    <div className="grow">
                      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                        <span className="ref">{m.ref_code}</span>
                        <Badge tone={STATUS[m.status]?.tone}>{STATUS[m.status]?.label ?? m.status}</Badge>
                        {m.contact_optin && (
                          <Badge tone="scheduled">Wants a reply</Badge>
                        )}
                      </div>
                      <b style={{ display: 'block', fontSize: 15, color: 'var(--ink-900)', marginTop: 4 }}>
                        {m.category}
                      </b>
                      <span style={{ fontSize: 13, color: 'var(--ink-400)' }}>
                        {shortDate(m.created_at)} · {timeOnly(m.created_at)} · {relative(m.created_at)}
                      </span>
                      {!expanded && (
                        <p style={{ fontSize: 14, color: 'var(--ink-600)', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60ch' }}>
                          {m.message}
                        </p>
                      )}
                    </div>
                    <span style={{ color: 'var(--ink-400)', fontSize: 13 }}>{expanded ? 'Close' : 'Read'}</span>
                  </button>

                  {expanded && (
                    <div style={{ padding: '0 26px 22px' }}>
                      <p
                        style={{
                          fontSize: 15,
                          color: 'var(--ink-700)',
                          whiteSpace: 'pre-wrap',
                          background: 'var(--ink-50)',
                          padding: 18,
                          borderRadius: 'var(--r-md)',
                          marginBottom: 18,
                          lineHeight: 1.65,
                        }}
                      >
                        {m.message}
                      </p>

                      {m.contact_optin ? (
                        <Notice icon="info" title="The sender asked to be contacted">
                          They left: <b>{m.contact_detail}</b>. This is the only identifying detail
                          on the record, and only because they chose to give it.
                        </Notice>
                      ) : (
                        <Notice tone="quiet" icon="incognito" title="No way to reply">
                          The sender did not leave a contact detail. There is nothing on this record
                          that could identify them.
                        </Notice>
                      )}

                      {m.response && (
                        <div style={{ marginTop: 16 }}>
                          <div style={{ fontSize: 12, color: 'var(--ink-400)', fontWeight: 600, marginBottom: 6 }}>
                            Action taken
                          </div>
                          <p style={{ fontSize: 14.5, color: 'var(--ink-700)' }}>{m.response}</p>
                        </div>
                      )}

                      <div style={{ marginTop: 18, maxWidth: 620 }}>
                        <Field
                          as="textarea"
                          label="What was done about this?"
                          hint="optional"
                          placeholder="Recorded for the barangay's own file."
                          value={response}
                          onChange={(e) => setResponse(e.target.value)}
                        />
                      </div>

                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
                        {['reviewing', 'actioned', 'closed']
                          .filter((s) => s !== m.status)
                          .map((s) => (
                            <Button
                              key={s}
                              auto
                              size="m"
                              variant={s === 'closed' ? 'secondary' : s === 'actioned' ? 'accent' : 'primary'}
                              disabled={busy === m.id}
                              onClick={() => setStatus(m, s)}
                            >
                              {busy === m.id ? 'Saving…' : `Mark ${STATUS[s].label.toLowerCase()}`}
                            </Button>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
