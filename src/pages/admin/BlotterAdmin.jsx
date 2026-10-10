import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase, friendlyError } from '../../lib/supabase'
import { Badge, Button, Card, CardHeader, Field, Notice } from '../../components/ui'
import { EmptyState, LoadingRows } from '../../components/ui/States'
import { longDate, shortDate } from '../../lib/formatters'
import { EvidenceGallery } from '../../components/EvidenceGallery'

const STATUS = {
  filed: { label: 'Filed', tone: 'pending' },
  under_mediation: { label: 'Under mediation', tone: 'processing' },
  resolved: { label: 'Resolved', tone: 'approved' },
  referred: { label: 'Referred', tone: 'scheduled' },
  dismissed: { label: 'Dismissed', tone: 'released' },
}

const NEXT = {
  filed: ['under_mediation', 'referred', 'dismissed'],
  under_mediation: ['resolved', 'referred', 'dismissed'],
  referred: ['resolved', 'dismissed'],
  resolved: [],
  dismissed: [],
}

export default function BlotterAdmin() {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState('open')
  const [open, setOpen] = useState(null)
  const [resolution, setResolution] = useState('')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  const { data, isLoading, isError, error: loadError } = useQuery({
    queryKey: ['admin-blotter'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('blotter_reports')
        .select(
          '*, profiles!blotter_reports_complainant_id_fkey(full_name, resident_id, purok, mobile), blotter_evidence(id, storage_path, content_type, created_at)'
        )
        .order('created_at', { ascending: false })
        // Oldest photo first, so the order matches the order they were taken in.
        .order('created_at', { referencedTable: 'blotter_evidence', ascending: true })
      if (error) throw error
      return data
    },
  })

  const rows = (data ?? []).filter((b) => {
    if (filter === 'all') return true
    if (filter === 'open') return ['filed', 'under_mediation'].includes(b.status)
    return b.status === filter
  })

  async function move(report, next) {
    setBusy(report.id)
    setError(null)
    try {
      const patch = { status: next }
      if (resolution.trim()) patch.resolution = resolution.trim()
      const { error: updateError } = await supabase.from('blotter_reports').update(patch).eq('id', report.id)
      if (updateError) throw updateError
      setResolution('')
      setOpen(null)
      queryClient.invalidateQueries({ queryKey: ['admin-blotter'] })
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
        <span className="eyebrow">Blotter</span>
        <h1 style={{ fontSize: 27, margin: '8px 0 0' }}>Incident reports</h1>
      </div>

      {error && <Notice tone="danger" icon="alert" title="Could not save">{error}</Notice>}

      {/* An empty list and a failed load look identical otherwise, and the
          difference matters: one means there is nothing to review, the other
          means the reports are there but this screen could not read them. */}
      {isError && (
        <Notice tone="danger" icon="alert" title="The blotter could not be loaded">
          {friendlyError(loadError, 'The reports could not be read. Refresh the page and try again.')}
        </Notice>
      )}

      <div className="filterbar">
        {[['open', 'Open cases'], ['filed', 'Newly filed'], ['under_mediation', 'In mediation'], ['resolved', 'Resolved'], ['all', 'All']].map(
          ([k, label]) => (
            <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {label}
            </button>
          )
        )}
      </div>

      <Card flush>
        <CardHeader title={`${rows.length} report${rows.length === 1 ? '' : 's'}`} />
        {isLoading ? (
          <LoadingRows rows={4} />
        ) : isError ? (
          <EmptyState icon="alert" title="Not loaded">
            The reports could not be read just now.
          </EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState icon="alert" title="No reports">
            Nothing matches this filter.
          </EmptyState>
        ) : (
          <div className="feed">
            {rows.map((b) => {
              const expanded = open === b.id
              return (
                <div key={b.id} style={{ borderBottom: '1px solid var(--ink-100)' }}>
                  <button
                    onClick={() => setOpen(expanded ? null : b.id)}
                    style={{ width: '100%', textAlign: 'left', padding: '18px 26px', display: 'flex', gap: 14, alignItems: 'center' }}
                  >
                    <div className="grow">
                      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                        <span className="ref">{b.ref_no}</span>
                        <Badge tone={STATUS[b.status]?.tone}>{STATUS[b.status]?.label}</Badge>
                      </div>
                      <b style={{ display: 'block', fontSize: 15, color: 'var(--ink-900)', marginTop: 4 }}>
                        {b.incident_type}
                      </b>
                      <span style={{ fontSize: 13, color: 'var(--ink-400)' }}>
                        {b.profiles?.full_name} · {b.location} · filed {shortDate(b.created_at)}
                      </span>
                    </div>
                    <span style={{ color: 'var(--ink-400)', fontSize: 13 }}>{expanded ? 'Close' : 'Open'}</span>
                  </button>

                  {expanded && (
                    <div style={{ padding: '0 26px 22px' }}>
                      <div className="grid-2" style={{ gap: '14px 24px', marginBottom: 18 }}>
                        {[
                          ['Complainant', `${b.profiles?.full_name} (${b.profiles?.resident_id ?? 'no ID'})`],
                          ['Contact', b.profiles?.mobile],
                          ['Purok', b.profiles?.purok ? `Purok ${b.profiles.purok}` : '—'],
                          ['Incident date', longDate(b.incident_at)],
                          ['Location', b.location],
                          ['Person complained about', b.respondent_name || 'Not named'],
                          ['Their address', b.respondent_address || '—'],
                        ].map(([k, v]) => (
                          <div key={k}>
                            <div style={{ fontSize: 12, color: 'var(--ink-400)', fontWeight: 600 }}>{k}</div>
                            <div style={{ fontSize: 14, color: 'var(--ink-800)' }}>{v || '—'}</div>
                          </div>
                        ))}
                      </div>

                      <div style={{ marginBottom: 18 }}>
                        <div style={{ fontSize: 12, color: 'var(--ink-400)', fontWeight: 600, marginBottom: 6 }}>
                          Narrative
                        </div>
                        <p style={{ fontSize: 14.5, color: 'var(--ink-700)', whiteSpace: 'pre-wrap', background: 'var(--ink-50)', padding: 16, borderRadius: 'var(--r-md)' }}>
                          {b.narrative}
                        </p>
                      </div>

                      {/* The photographs the complainant attached, if any.
                          Private bucket, signed links, five minutes. */}
                      <EvidenceGallery evidence={b.blotter_evidence} refNo={b.ref_no} />

                      {b.resolution && (
                        <div style={{ marginBottom: 18 }}>
                          <div style={{ fontSize: 12, color: 'var(--ink-400)', fontWeight: 600, marginBottom: 6 }}>
                            Resolution
                          </div>
                          <p style={{ fontSize: 14.5, color: 'var(--ink-700)' }}>{b.resolution}</p>
                        </div>
                      )}

                      {NEXT[b.status]?.length > 0 && (
                        <>
                          <div style={{ marginBottom: 14, maxWidth: 620 }}>
                            <Field
                              as="textarea"
                              label="Note or resolution"
                              hint="optional"
                              placeholder="What was agreed, or why this is being referred."
                              value={resolution}
                              onChange={(e) => setResolution(e.target.value)}
                            />
                          </div>
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            {NEXT[b.status].map((n) => (
                              <Button
                                key={n}
                                auto
                                size="m"
                                variant={n === 'dismissed' ? 'secondary' : n === 'resolved' ? 'accent' : 'primary'}
                                disabled={busy === b.id}
                                onClick={() => move(b, n)}
                              >
                                {busy === b.id ? 'Saving…' : `Mark ${STATUS[n].label.toLowerCase()}`}
                              </Button>
                            ))}
                          </div>
                        </>
                      )}
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
