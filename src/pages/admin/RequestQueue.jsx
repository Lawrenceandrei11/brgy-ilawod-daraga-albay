import { useEffect, useRef, useState } from 'react'
import { Link, useOutletContext, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase, friendlyError } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Badge, Button, Card, CardHeader, Notice } from '../../components/ui'
import { EmptyState, ErrorState, LoadingRows } from '../../components/ui/States'
import { REQUEST_STATUS, ROLE_HOME_TAB } from '../../lib/status'
import { peso, relative, shortDate } from '../../lib/formatters'

// One chip per value of the request_status enum, plus "all", and which desks
// each belongs to.
//
// The chips follow the workflow in migration 28: the secretary checks new
// requests and handles returned ones, the treasurer takes payment and sees a
// document through to release, and the Punong Barangay has every tab because
// their permissions are cumulative -- a chip that led nowhere the captain
// could act, or stopped short of somewhere they can, would be lying about the
// job.
//
// "All" stays on every role so the whole queue is always one tap away. Hiding
// a chip is about what a role works on, not what it may see: reading is open
// to all staff, which is what the reports, the search and the dashboard
// counts rely on.
const TABS = [
  { key: 'all', label: 'All', roles: ['secretary', 'captain', 'treasurer'] },
  { key: 'pending', label: 'Awaiting review', roles: ['secretary', 'captain'] },
  { key: 'processing', label: 'In progress', roles: ['captain'] },
  { key: 'approved', label: 'Approved', roles: ['captain', 'treasurer'] },
  { key: 'scheduled', label: 'Scheduled', roles: ['captain', 'treasurer'] },
  { key: 'ready', label: 'Ready for pickup', roles: ['captain', 'treasurer'] },
  { key: 'rejected', label: 'Returned', roles: ['secretary', 'captain'] },
  { key: 'released', label: 'Released', roles: ['captain', 'treasurer'] },
]

export default function RequestQueue() {
  const { role } = useAuth()
  const [params, setParams] = useSearchParams()
  // An unknown role (the moment before auth resolves) shows every chip
  // rather than none, so the bar never flashes empty.
  const tabs = TABS.filter((t) => !ROLE_HOME_TAB[role] || t.roles.includes(role))

  const requested = params.get('status')
  // Each role opens on the stage its own work waits at: the secretary on new
  // requests, the Punong Barangay on checked ones, the treasurer on approved.
  // A status this role has no chip for -- an old bookmark, a typo, a link
  // from another desk -- falls back there too, so the bar never shows a
  // selection with no chip to match it.
  const status = tabs.some((t) => t.key === requested)
    ? requested
    : (ROLE_HOME_TAB[role] ?? 'pending')
  const service = params.get('service') ?? 'all'

  const { data: services } = useQuery({
    queryKey: ['services'],
    queryFn: async () => {
      const { data, error } = await supabase.from('services').select('code, name').eq('kind', 'document').order('sort_order')
      if (error) throw error
      return data
    },
  })

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-requests', status, service],
    queryFn: async () => {
      let q = supabase
        .from('document_requests')
        .select('*, services(name), profiles!document_requests_profile_id_fkey(full_name, resident_id, purok)')
        // Newest first, under every status and document filter. filed_at is
        // the creation time (default now()); ref_no breaks ties because it
        // comes from a sequential yearly counter.
        .order('filed_at', { ascending: false })
        .order('ref_no', { ascending: false })

      if (status !== 'all') q = q.eq('status', status)
      if (service !== 'all') q = q.eq('service_code', service)

      const { data, error } = await q
      if (error) throw error
      return data
    },
  })

  // The layout already fetches admin_stats for the sidebar badges. Reading it
  // from there, rather than caching a different shape under the same
  // ['admin-stats'] key, stops these counts and the sidebar overwriting each
  // other. Invalidating ['admin-stats'] after a status change refreshes both.
  const { stats } = useOutletContext() ?? {}
  const counts = { ...stats?.requests_by_status, all: stats?.requests_total }

  // ---- clearing out released requests ---------------------------------
  //
  // Only under the Released filter. A request in any other status is the
  // barangay's working record, and delete_released_requests() refuses one
  // regardless of what this page sends.
  const queryClient = useQueryClient()
  const clearable = status === 'released'
  const [picked, setPicked] = useState([])
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
  const [deleted, setDeleted] = useState(null)

  // A different filter, or a list that has moved on, must not leave stale ids
  // selected: they would be sent to the server on the next click.
  useEffect(() => {
    setPicked([])
    setDeleteError(null)
  }, [status, service])

  const rows = data ?? []
  const shownIds = rows.map((r) => r.id)
  const selected = picked.filter((id) => shownIds.includes(id))
  const allShownPicked = shownIds.length > 0 && selected.length === shownIds.length
  const somePicked = selected.length > 0 && !allShownPicked

  // "Some of them" is a property of the element, not an attribute React can
  // render, so it is set on the node itself.
  const selectAllRef = useRef(null)
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = somePicked
  }, [somePicked])

  const toggleOne = (id) =>
    setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))
  const toggleAll = () => setPicked(allShownPicked ? [] : shownIds)

  async function removeSelected() {
    if (selected.length === 0) return
    const warning =
      `Permanently delete ${selected.length} released ${selected.length === 1 ? 'request' : 'requests'}?\n\n` +
      'These records are removed from the database for good and cannot be recovered.\n\n' +
      'The residents who filed them, their accounts and their other records are not affected.'
    if (!window.confirm(warning)) return

    setDeleting(true)
    setDeleteError(null)
    setDeleted(null)
    try {
      const { data: count, error } = await supabase.rpc('delete_released_requests', {
        p_ids: selected,
      })
      if (error) throw error

      await refetch()
      // The Released count on the chip, and the sidebar badges, come from
      // admin_stats.
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
      setPicked([])

      // The database says how many it actually removed. Fewer than asked for
      // means something changed underneath -- someone reopened a request, or
      // another member of staff got there first.
      setDeleted(
        count === selected.length
          ? `${count} released ${count === 1 ? 'request has' : 'requests have'} been permanently deleted.`
          : `${count} of ${selected.length} selected requests were deleted. The rest are no longer released, so they were left alone.`
      )
    } catch (err) {
      setDeleteError(friendlyError(err, 'Those requests could not be deleted. Nothing was removed.'))
    } finally {
      setDeleting(false)
    }
  }

  function setParam(key, value) {
    const next = new URLSearchParams(params)
    if (value === 'all' && key === 'service') next.delete(key)
    else next.set(key, value)
    setParams(next)
  }

  return (
    <div className="dash-body">
      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <div className="grow">
          <span className="eyebrow">Document requests</span>
          <h1 style={{ fontSize: 27, margin: '8px 0 0' }}>The queue</h1>
        </div>
      </div>

      <div className="filterbar">
        {tabs.map((t) => (
          <button
            key={t.key}
            className="chip"
            aria-pressed={status === t.key}
            onClick={() => setParam('status', t.key)}
          >
            {t.label}
            {counts?.[t.key] > 0 && <span className="chip-n">{counts[t.key]}</span>}
          </button>
        ))}
      </div>

      {/* One control rather than a second row of pills. The status pills
          carry counts and earn their space; the document is just a choice of
          one, and the list grows whenever a service is added. */}
      <div className="filter-select">
        <select
          className="control"
          aria-label="Filter by document type"
          value={service}
          onChange={(e) => setParam('service', e.target.value)}
        >
          <option value="all">Every document</option>
          {(services ?? []).map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {deleted && (
        <Notice icon="check" title="Requests deleted">
          {deleted}
        </Notice>
      )}
      {deleteError && (
        <Notice tone="danger" icon="alert" title="Could not delete">
          {deleteError}
        </Notice>
      )}

      <Card flush>
        <CardHeader title={`${TABS.find((t) => t.key === status)?.label ?? 'All'} · ${data?.length ?? 0}`}>
          {clearable && rows.length > 0 && (
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: 'var(--ink-500)' }}>
                {selected.length > 0
                  ? `${selected.length} selected`
                  : 'Select released requests to delete'}
              </span>
              <Button
                size="s"
                auto
                variant="ghost"
                style={{ color: 'var(--danger-600)' }}
                disabled={selected.length === 0 || deleting}
                onClick={removeSelected}
              >
                {deleting ? 'Deleting…' : 'Delete selected'}
              </Button>
            </div>
          )}
        </CardHeader>

        {isLoading ? (
          <LoadingRows rows={5} />
        ) : isError ? (
          <ErrorState onRetry={refetch} />
        ) : data.length === 0 ? (
          <EmptyState icon="check" title="Nothing here">
            {status === 'pending'
              ? 'Every request has been picked up. The queue is clear.'
              : 'No requests match this filter.'}
          </EmptyState>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                {clearable && (
                  <th style={{ width: 120 }}>
                    {/* The label makes the whole "Select All" clickable, and
                        says out loud what the bare checkbox only implied. */}
                    <label
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        cursor: deleting ? 'default' : 'pointer',
                      }}
                    >
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        checked={allShownPicked}
                        onChange={toggleAll}
                        disabled={deleting}
                      />
                      Select All
                    </label>
                  </th>
                )}
                <th>Reference</th>
                <th>Resident</th>
                <th>Document</th>
                <th>Waiting</th>
                <th>Fee</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} className="clickable">
                  {clearable && (
                    <td data-label="">
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.ref_no}`}
                        checked={picked.includes(r.id)}
                        onChange={() => toggleOne(r.id)}
                        disabled={deleting}
                      />
                    </td>
                  )}
                  <td className="ref" data-label="Reference">
                    <Link to={`/admin/requests/${r.ref_no}`}>{r.ref_no}</Link>
                  </td>
                  <td className="doc" data-label="Resident">
                    {r.profiles?.full_name}
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-400)' }}>
                      {r.profiles?.resident_id}
                      {r.profiles?.purok ? ` · Purok ${r.profiles.purok}` : ''}
                    </span>
                  </td>
                  <td className="when" data-label="Document">{r.services?.name}</td>
                  <td className="when" data-label="Waiting">
                    {shortDate(r.filed_at)}
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-400)' }}>
                      {relative(r.filed_at)}
                    </span>
                  </td>
                  <td className="when" data-label="Fee">
                    {peso(r.fee)}
                    {r.fee > 0 && (
                      <span
                        style={{
                          display: 'block',
                          fontSize: 12,
                          color: r.fee_paid ? 'var(--success-600)' : 'var(--warning-600)',
                        }}
                      >
                        {r.fee_paid ? 'paid' : 'unpaid'}
                      </span>
                    )}
                  </td>
                  <td data-label="Status"><Badge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {status !== 'all' && REQUEST_STATUS[status] && (
        <p style={{ fontSize: 13.5, color: 'var(--ink-400)' }}>
          <b>{REQUEST_STATUS[status].label}:</b> {REQUEST_STATUS[status].resident}
        </p>
      )}
    </div>
  )
}
