import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase, friendlyError } from '../../lib/supabase'
import { Badge, Button, Card, CardHeader, Field, Notice } from '../../components/ui'
import { EmptyState, ErrorState, LoadingRows } from '../../components/ui/States'
import { shortDate } from '../../lib/formatters'
import { needsIdReview } from '../../lib/idRetention'

const TABS = [
  { key: 'pending', label: 'To verify' },
  // Derived, not a status: these residents stay approved while the document
  // they replaced waits to be looked at. See lib/idRetention.js.
  { key: 'id-review', label: 'Needs ID review' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Not approved' },
  { key: 'all', label: 'Everyone' },
]

const STATUS_TONE = { approved: 'approved', pending: 'pending', rejected: 'rejected', suspended: 'released' }

export default function Residents() {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? 'pending'
  const [search, setSearch] = useState('')
  const queryClient = useQueryClient()
  const [deleting, setDeleting] = useState(null)
  const [deleteError, setDeleteError] = useState(null)
  const [deleted, setDeleted] = useState(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-residents', status],
    queryFn: async () => {
      let q = supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false })
      // "Needs ID review" is not a status. These residents keep whatever
      // status they had -- usually approved -- so the rows are fetched and
      // then narrowed by the same rule the database queue uses.
      if (status !== 'all' && status !== 'id-review') q = q.eq('status', status)
      const { data, error } = await q
      if (error) throw error
      return data
    },
  })

  const rows = (data ?? []).filter((p) => {
    if (status === 'id-review' && !needsIdReview(p)) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      p.full_name?.toLowerCase().includes(q) ||
      p.resident_id?.toLowerCase().includes(q) ||
      p.mobile?.includes(q)
    )
  })

  /**
   * delete_resident() in the database does the deciding: staff only, resident
   * accounts only, never your own, and never one with requests, blotter
   * reports or appointments behind it. It hands back the file paths, because
   * the uploads live in storage and are not removed by the row delete.
   */
  async function remove(p) {
    const warning =
      `Permanently delete ${p.full_name}?\n\n` +
      'This removes their account, sign-in and face enrollment for good. It cannot be undone.\n\n' +
      'Residents who have filed a request, a blotter report or an appointment cannot be deleted, ' +
      'because the barangay record is kept.'
    if (!window.confirm(warning)) return

    setDeleting(p.id)
    setDeleteError(null)
    setDeleted(null)
    try {
      const { data, error } = await supabase.rpc('delete_resident', { p_profile_id: p.id })
      if (error) throw error

      // Best effort: the account is already gone, and a leftover file costs
      // storage, not correctness.
      if (data?.valid_id_path) await supabase.storage.from('valid-ids').remove([data.valid_id_path])
      if (data?.avatar_path) await supabase.storage.from('avatars').remove([data.avatar_path])

      queryClient.invalidateQueries({ queryKey: ['admin-residents'] })
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
      setDeleted(`${data?.full_name ?? p.full_name} has been permanently deleted.`)
    } catch (err) {
      setDeleteError(friendlyError(err, 'That resident could not be deleted.'))
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="dash-body">
      <div>
        <span className="eyebrow">Residents</span>
        <h1 style={{ fontSize: 27, margin: '8px 0 0' }}>The barangay masterlist</h1>
      </div>

      {deleted && (
        <Notice icon="check" title="Resident deleted">
          {deleted}
        </Notice>
      )}
      {deleteError && (
        <Notice tone="danger" icon="alert" title="Could not delete">
          {deleteError}
        </Notice>
      )}

      <div className="filterbar">
        {TABS.map((t) => (
          <button
            key={t.key}
            className="chip"
            aria-pressed={status === t.key}
            onClick={() => {
              const next = new URLSearchParams(params)
              next.set('status', t.key)
              setParams(next)
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 380 }}>
        <Field
          label="Search"
          placeholder="Name, Resident ID or mobile number"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card flush>
        <CardHeader title={`${TABS.find((t) => t.key === status)?.label} · ${rows.length}`} />

        {isLoading ? (
          <LoadingRows rows={5} />
        ) : isError ? (
          <ErrorState onRetry={refetch} />
        ) : rows.length === 0 ? (
          <EmptyState icon="users" title="Nobody here">
            {status === 'pending'
              ? 'Every registration has been verified.'
              : 'No residents match this filter.'}
          </EmptyState>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Resident ID</th>
                <th>Purok</th>
                <th>Registered</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="clickable">
                  <td className="doc" data-label="Name">
                    <Link to={`/admin/residents/${p.id}`}>{p.full_name}</Link>
                    {p.role !== 'resident' && (
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--primary-600)', fontWeight: 600 }}>
                        {p.role}
                      </span>
                    )}
                  </td>
                  <td className="ref" data-label="Resident ID">{p.resident_id ?? '—'}</td>
                  <td className="when" data-label="Purok">{p.purok ? `Purok ${p.purok}` : '—'}</td>
                  <td className="when" data-label="Registered">{shortDate(p.created_at)}</td>
                  <td data-label="Status">
                    <Badge tone={STATUS_TONE[p.status]}>
                      {p.status === 'pending' ? 'To verify' : p.status}
                    </Badge>
                    {/* Sits beside the status rather than replacing it: the
                        resident is still approved, it is the document that
                        is waiting. */}
                    {needsIdReview(p) && (
                      <Badge tone="pending" style={{ marginLeft: 6 }}>
                        New ID
                      </Badge>
                    )}
                  </td>
                  <td data-label="Action">
                    {/* Staff accounts are not deletable here; the database
                        refuses them too. */}
                    {p.role === 'resident' && (
                      <Button
                        size="s"
                        auto
                        variant="ghost"
                        style={{ color: 'var(--danger-600)' }}
                        disabled={deleting === p.id}
                        onClick={() => remove(p)}
                      >
                        {deleting === p.id ? 'Deleting…' : 'Delete'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
