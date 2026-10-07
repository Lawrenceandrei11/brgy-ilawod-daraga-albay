import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useOutletContext, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase, friendlyError } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Badge, Button, Card, CardHeader, Notice } from '../../components/ui'
import { EmptyState, ErrorState, LoadingRows } from '../../components/ui/States'
import { REQUEST_STATUS, ROLE_HOME_TAB, whoseStep } from '../../lib/status'
import { Icon } from '../../components/Icon'
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

// What has to happen next, in the words staff use. Derived from whoseStep()
// so the queue cannot say one thing here and the request screen another.
//
// A returned request is the exception: the workflow says the secretary picks
// it up again, but nothing happens until the resident resubmits, so that is
// what the queue says.
function nextAction(status) {
  if (status === 'released') return null
  if (status === 'rejected') return { label: 'Returned to resident', icon: 'user' }
  const who = whoseStep(status)
  if (who === 'the Punong Barangay') return { label: 'For Captain approval', icon: 'shield' }
  if (who === 'the barangay treasurer') return { label: 'For Treasurer payment', icon: 'brief' }
  if (who === 'the barangay secretary') return { label: 'For Secretary review', icon: 'user' }
  return null
}

// The statuses each desk is actually waiting on, which is what "my work"
// means. Returned requests are left out: they are the resident's move.
const MY_WORK = {
  secretary: ['pending'],
  captain: ['processing'],
  treasurer: ['approved', 'scheduled', 'ready'],
}

// The figures above the chips, one set per desk.
//
// Role-filtered for the same reason the chips are: a card that counts work
// another desk does is noise, and -- worse -- it is a dead button. The status
// resolver below only accepts a status this role has a chip for, so a card
// pointing anywhere else would bounce back to the home tab and leave a figure
// nobody can open. The check below keeps that from creeping back in.
//
// Two optional fields carry the one card that is not a single status:
//   of  -- the statuses to add up, defaulting to [key]
//   to  -- the tab to open, defaulting to key
const WORK_CARDS = [
  // The secretary checks what comes in. Returned requests are shown because
  // they are this desk's to pick up again, even though the next move is the
  // resident's -- which is why they are not in MY_WORK.
  { key: 'pending', roles: ['secretary'], label: 'For checking', icon: 'clock', tone: 'warn' },
  { key: 'rejected', roles: ['secretary'], label: 'Returned', icon: 'user', tone: 'plain' },

  // The Punong Barangay approves, and may cover either of the other two
  // desks. One figure for everything that is not their own step, opening the
  // whole queue, says that without pretending it is a single stage.
  { key: 'processing', roles: ['captain'], label: 'For approval', icon: 'shield', tone: 'warn' },
  {
    key: 'elsewhere',
    roles: ['captain'],
    label: 'Elsewhere in the queue',
    of: ['pending', 'approved', 'scheduled', 'ready'],
    to: 'all',
    icon: 'brief',
    tone: 'plain',
  },

  // The treasurer takes payment, then sees the document out. Their three
  // stages add up to their My work figure.
  { key: 'approved', roles: ['treasurer'], label: 'For payment', icon: 'brief', tone: 'warn' },
  { key: 'ready', roles: ['treasurer'], label: 'Ready for pickup', icon: 'check', tone: 'good' },
  { key: 'scheduled', roles: ['treasurer'], label: 'Scheduled', icon: 'cal', tone: 'plain' },
]

/** The statuses a card adds up, and the tab it opens. */
const cardStatuses = (c) => c.of ?? [c.key]
const cardTab = (c) => c.to ?? c.key

// Development only: every card must open a tab its own roles have, or the
// status resolver will bounce it to the home tab and the figure becomes
// unclickable -- the bug that role-filtering these cards fixed in the first
// place. Shouting here is cheaper than finding it on someone's desk.
if (import.meta.env.DEV) {
  for (const c of WORK_CARDS) {
    for (const r of c.roles) {
      const reachable = TABS.some((t) => t.key === cardTab(c) && t.roles.includes(r))
      if (!reachable) {
        console.error(
          `Work card "${c.label}" opens the "${cardTab(c)}" tab, which the ${r} does not have.`
        )
      }
    }
  }
}

export default function RequestQueue() {
  const { role } = useAuth()
  const [params, setParams] = useSearchParams()
  // An unknown role (the moment before auth resolves) shows every chip
  // rather than none, so the bar never flashes empty.
  const tabs = TABS.filter((t) => !ROLE_HOME_TAB[role] || t.roles.includes(role))
  const cards = WORK_CARDS.filter((c) => !ROLE_HOME_TAB[role] || c.roles.includes(role))

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

  // Narrows the list already on screen. The topbar search is the one that
  // goes looking across the whole system; this one only sifts what is here,
  // which is why it is not in the URL and costs no request.
  const [term, setTerm] = useState('')

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

  // The rows after the page search, which is what everything below counts,
  // renders and selects. Without this the "n selected" line and the delete
  // could disagree with what staff can actually see.
  const rows = useMemo(() => {
    const all = data ?? []
    const q = term.trim().toLowerCase()
    if (!q) return all
    return all.filter((r) =>
      [r.ref_no, r.profiles?.full_name, r.profiles?.resident_id, r.services?.name]
        .some((v) => String(v ?? '').toLowerCase().includes(q))
    )
  }, [data, term])

  // How much of this queue is waiting on the role reading it.
  const myWork = (MY_WORK[role] ?? []).reduce((n, k) => n + (counts?.[k] ?? 0), 0)

  // The age of the longest wait, from the rows already loaded -- so it is
  // only honest for the tab being viewed, and is only shown there.
  const oldestHere = useMemo(() => {
    const dates = rows.map((r) => r.filed_at).filter(Boolean)
    if (dates.length === 0) return null
    return dates.reduce((a, b) => (new Date(a) < new Date(b) ? a : b))
  }, [rows])

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

      {/* What is waiting on the official reading this, before the filters. The
          figures come from admin_stats, which the layout already fetches for
          the sidebar badges, so this costs no extra request. */}
      <div className="workstrip">
        <button
          type="button"
          className="workcard is-mine"
          onClick={() => setParam('status', (MY_WORK[role] ?? ['all'])[0])}
        >
          <Icon name="brief" />
          <div>
            <b>{myWork}</b>
            <span>My work</span>
            <i>Needs your action</i>
          </div>
        </button>

        {cards.map((c) => {
          const tab = cardTab(c)
          const open = status === tab
          const n = cardStatuses(c).reduce((sum, k) => sum + (counts?.[k] ?? 0), 0)
          return (
            <button
              key={c.key}
              type="button"
              className={`workcard tone-${c.tone} ${open ? 'is-open' : ''}`.trim()}
              aria-pressed={open}
              onClick={() => setParam('status', tab)}
            >
              <Icon name={c.icon} />
              <div>
                <b>{n}</b>
                <span>{c.label}</span>
                {/* Only on the tab being viewed: the age comes from the rows
                    on screen, so it cannot be known for the others. */}
                {open && oldestHere && <i>oldest {relative(oldestHere)}</i>}
              </div>
            </button>
          )
        })}
      </div>

      <div className="filterbar is-compact">
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

      {/* Search and document filter on one line. The search sifts the list
          already on screen; the topbar search is the one that goes looking
          across the whole system. */}
      <div className="queue-filters">
        <div className="search queue-search">
          <Icon name="search" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search reference no., resident name, or document type…"
            aria-label="Search this list"
            autoComplete="off"
          />
        </div>

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
        <CardHeader
          title={`${TABS.find((t) => t.key === status)?.label ?? 'All'} · ${rows.length} ${rows.length === 1 ? 'request' : 'requests'}`}
        >
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
        ) : rows.length === 0 ? (
          <EmptyState icon="search" title={term ? 'No matches' : 'Nothing here'}>
            {term
              ? `Nothing in this list matches "${term}".`
              : status === 'pending'
                ? 'Every request has been picked up. The queue is clear.'
                : 'No requests match this filter.'}
          </EmptyState>
        ) : (
          /* The checkbox column only exists on Released, so the row grid is
             told which shape it has rather than inferring it from the number
             of children. */
          <div className={`reqlist ${clearable ? 'is-pickable' : ''}`.trim()}>
            {clearable && (
              /* Select All sits above the rows now that there is no table
                 header to carry it. Released only, as before. */
              <div className="reqlist-head">
                <label className="reqpick">
                  <input
                    type="checkbox"
                    checked={allShownPicked}
                    ref={selectAllRef}
                    onChange={toggleAll}
                    disabled={deleting}
                    aria-label="Select all released requests shown"
                  />
                  Select All
                </label>
              </div>
            )}

            {rows.map((r) => {
              const next = nextAction(r.status)
              return (
                <div key={r.id} className="reqrow">
                  {clearable && (
                    <label className="reqpick only-box">
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.ref_no}`}
                        checked={picked.includes(r.id)}
                        onChange={() => toggleOne(r.id)}
                        disabled={deleting}
                      />
                    </label>
                  )}

                  <span className="reqicon" aria-hidden="true">
                    <Icon name="doc" />
                  </span>

                  <div className="reqwho">
                    <Link to={`/admin/requests/${r.ref_no}`} className="reqref">
                      {r.ref_no}
                    </Link>
                    <span>{r.profiles?.full_name}</span>
                    <i>
                      {r.profiles?.resident_id}
                      {r.profiles?.purok ? ` · Purok ${r.profiles.purok}` : ''}
                    </i>
                  </div>

                  <div className="reqdoc">
                    <span>{r.services?.name}</span>
                    <i>
                      <Icon name="cal" size="sm" />
                      {shortDate(r.filed_at)} · {relative(r.filed_at)}
                    </i>
                  </div>

                  <div className="reqfee">
                    <em>Fee</em>
                    <span>{peso(r.fee)}</span>
                    {r.fee > 0 && (
                      <i className={r.fee_paid ? 'is-paid' : 'is-unpaid'}>
                        {r.fee_paid ? 'paid' : 'unpaid'}
                      </i>
                    )}
                  </div>

                  <div className="reqnext">
                    <em>Next action</em>
                    {next ? (
                      <span>
                        <Icon name={next.icon} size="sm" />
                        {next.label}
                      </span>
                    ) : (
                      <span className="is-done">Complete</span>
                    )}
                  </div>

                  <div className="reqstatus">
                    <Badge status={r.status} />
                  </div>

                  <Link
                    to={`/admin/requests/${r.ref_no}`}
                    className="reqgo"
                    aria-label={`Open ${r.ref_no}`}
                  >
                    <Icon name="chev" />
                  </Link>
                </div>
              )
            })}
          </div>
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
