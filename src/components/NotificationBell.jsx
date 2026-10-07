import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { Icon } from './Icon'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { REQUEST_STATUS, statusLabel } from '../lib/status'
import { relative, shortDate } from '../lib/formatters'

/**
 * The resident portal's notification bell.
 *
 * There is no notifications table. What the bell shows is read straight from
 * the records the resident can already open -- the status history of their
 * own requests, their appointments, their blotter reports, the published
 * announcements and the approval of their own registration -- merged into one
 * list, newest first. That means the feed cannot drift from the truth the way
 * a parallel copy would: if a request is deleted, its history goes with it,
 * and so do its notifications.
 *
 * How much has been read is the one thing that cannot be derived, and that
 * lives in profiles.notifications_seen_at (migration 26). Reading is an
 * explicit act: opening the bell shows what is new, and "Mark all as read"
 * is what clears it. Read notices stay in the list, only without their mark.
 *
 * Removing is a separate act again, and it removes a line from this list and
 * nothing else (migration 27). One notice removed writes a row to
 * notification_dismissals; the whole list cleared moves
 * profiles.notifications_cleared_at over everything currently showing. The
 * request, appointment, announcement, blotter report and SMS log row behind
 * a removed notice are never touched -- they stay exactly where the resident
 * can still find them, in My requests, Appointments and the rest.
 *
 * Every query filters on the signed-in profile explicitly. That is not
 * belt-and-braces: the four policies behind these tables all read
 * "... or is_staff()", and a staff member can reach this layout through
 * "Switch to resident view", so without these filters their bell would show
 * every resident's requests and blotter reports.
 */

// Enough from each source that the merge has something to choose between,
// without asking for pages nobody scrolls.
const PER_SOURCE = 10
const SHOWN = 15

// Above this the badge stops counting and starts saying "a lot".
const COUNT_CAP = 99

// 'filed' is missing on purpose: that is the resident's own filing, not news.
const BLOTTER_TEXT = {
  under_mediation: 'Your report is now under mediation at the barangay.',
  resolved: 'Your report has been resolved by the barangay.',
  referred: 'Your report has been referred to another office.',
  dismissed: 'Your report has been dismissed.',
}

function unwrap({ data, error }) {
  if (error) throw error
  return data ?? []
}

function unwrapCount({ count, error }) {
  if (error) throw error
  return count ?? 0
}

/** Is `at` newer than the point the resident had read up to? */
function isNewer(at, seenAt) {
  if (!at) return false
  if (!seenAt) return true
  return new Date(at) > new Date(seenAt)
}

/** The later of the two marks: nothing at or below it is unread. */
function watermarkOf(seenAt, clearedAt) {
  if (!seenAt) return clearedAt
  if (!clearedAt) return seenAt
  return new Date(clearedAt) > new Date(seenAt) ? clearedAt : seenAt
}

/**
 * The ids a source must leave out, taken from the keys of the notices this
 * resident has removed. Counting is done by the database, so the exclusion
 * has to travel with the query rather than being applied to the answer.
 */
function dismissedIds(keys, prefix) {
  return keys.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length))
}

/** Applies that exclusion, and stays out of the way when there is none. */
function excluding(query, ids) {
  return ids.length ? query.not('id', 'in', `(${ids.join(',')})`) : query
}

export function badgeText(unread) {
  return unread > COUNT_CAP ? `${COUNT_CAP}+` : String(unread)
}

/**
 * The list and the unread total.
 *
 * The total is counted by the database rather than by measuring the list,
 * because the list stops at fifteen: a resident who has been away for a month
 * should be told they have eighty-three notices, not fifteen.
 */
async function loadNotifications(profileId, seenAt, clearedAt) {
  // What this resident has taken off the list. Read first, because both the
  // list and the tally have to leave it out, and the tally is counted by the
  // database rather than measured here.
  const { data: dismissals, error: dismissalError } = await supabase
    .from('notification_dismissals')
    .select('item_key')
    .eq('profile_id', profileId)
  if (dismissalError) throw dismissalError

  const removed = (dismissals ?? []).map((d) => d.item_key)
  const removedSet = new Set(removed)
  const gone = {
    req: dismissedIds(removed, 'req-'),
    appt: dismissedIds(removed, 'appt-'),
    ann: dismissedIds(removed, 'ann-'),
    blot: dismissedIds(removed, 'blot-'),
    reg: dismissedIds(removed, 'reg-'),
  }

  // Everything at or below the clear mark is hidden. No filter when the
  // resident has never cleared, which is the ordinary case.
  const since = (query, column) => (clearedAt ? query.gt(column, clearedAt) : query)

  // The tally counts what is unread AND still showing, so it measures from
  // whichever mark is later.
  const watermark = watermarkOf(seenAt, clearedAt)

  // Written out one query at a time rather than sharing a builder between the
  // list and the tally: a second .select() replaces the first, which drops the
  // embedded document_requests and takes the profile filter down with it.
  const [rows, counts] = await Promise.all([
    Promise.all([
      since(
        supabase
          .from('request_status_history')
          .select('id, created_at, to_status, note, document_requests!inner(ref_no, profile_id)')
          .eq('document_requests.profile_id', profileId)
          .not('from_status', 'is', null),
        'created_at'
      )
        .order('created_at', { ascending: false })
        .limit(PER_SOURCE)
        .then(unwrap),

      // Dated by created_at, because appointments carry no updated_at: a
      // booking can be announced, a later cancellation cannot be dated and so
      // cannot take its place in a list ordered by time.
      since(
        supabase
          .from('appointments')
          .select('id, created_at, scheduled_at, purpose')
          .eq('profile_id', profileId),
        'created_at'
      )
        .order('created_at', { ascending: false })
        .limit(PER_SOURCE)
        .then(unwrap),

      // Dated by published_at rather than updated_at, so correcting a typo in
      // a notice does not announce it to the barangay a second time.
      since(
        supabase
          .from('announcements')
          .select('id, title, excerpt, published_at')
          .not('published_at', 'is', null),
        'published_at'
      )
        .order('published_at', { ascending: false })
        .limit(PER_SOURCE)
        .then(unwrap),

      since(
        supabase
          .from('blotter_reports')
          .select('id, ref_no, status, updated_at')
          .eq('complainant_id', profileId)
          .neq('status', 'filed'),
        'updated_at'
      )
        .order('updated_at', { ascending: false })
        .limit(PER_SOURCE)
        .then(unwrap),

      // The resident's own approval. approve_resident() stamps approved_at
      // when a staff member approves the registration, so the event is
      // already recorded and dated on the profile -- there is nothing to
      // store and nothing to keep in step. Only the resident's own row is
      // readable here, by the same policy that lets them open their profile.
      since(
        supabase
          .from('profiles')
          .select('id, approved_at')
          .eq('id', profileId)
          .eq('status', 'approved')
          .not('approved_at', 'is', null),
        'approved_at'
      )
        .limit(1)
        .then(unwrap),
    ]),

    // head: true asks for the tally without the rows behind it.
    Promise.all([
      excluding(
        supabase
          .from('request_status_history')
          .select('id, document_requests!inner(profile_id)', { count: 'exact', head: true })
          .eq('document_requests.profile_id', profileId)
          .not('from_status', 'is', null)
          .gt('created_at', watermark),
        gone.req
      ).then(unwrapCount),

      excluding(
        supabase
          .from('appointments')
          .select('id', { count: 'exact', head: true })
          .eq('profile_id', profileId)
          .gt('created_at', watermark),
        gone.appt
      ).then(unwrapCount),

      excluding(
        supabase
          .from('announcements')
          .select('id', { count: 'exact', head: true })
          .not('published_at', 'is', null)
          .gt('published_at', watermark),
        gone.ann
      ).then(unwrapCount),

      excluding(
        supabase
          .from('blotter_reports')
          .select('id', { count: 'exact', head: true })
          .eq('complainant_id', profileId)
          .neq('status', 'filed')
          .gt('updated_at', watermark),
        gone.blot
      ).then(unwrapCount),

      excluding(
        supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('id', profileId)
          .eq('status', 'approved')
          .not('approved_at', 'is', null)
          .gt('approved_at', watermark),
        gone.reg
      ).then(unwrapCount),
    ]),
  ])

  const [historyRows, appointmentRows, noticeRows, blotterRows, approvalRows] = rows

  const items = [
    ...historyRows.map((h) => ({
      key: `req-${h.id}`,
      icon: 'doc',
      title: `${statusLabel(h.to_status)} · ${h.document_requests.ref_no}`,
      // The sentence a resident is shown for this status everywhere else in
      // the portal, so the bell cannot say something different from the
      // request page. A remark is the point of a sent-back request, so it is
      // carried across too.
      body:
        h.to_status === 'rejected' && h.note
          ? `${REQUEST_STATUS.rejected.resident} ${h.note}`
          : REQUEST_STATUS[h.to_status]?.resident,
      at: h.created_at,
      to: `/app/requests/${h.document_requests.ref_no}`,
    })),

    ...appointmentRows.map((a) => ({
      key: `appt-${a.id}`,
      icon: 'cal',
      title: 'Appointment set',
      body: [shortDate(a.scheduled_at), a.purpose].filter(Boolean).join(' · '),
      at: a.created_at,
      to: '/app/appointments',
    })),

    ...noticeRows.map((n) => ({
      key: `ann-${n.id}`,
      icon: 'mega',
      title: n.title,
      body: n.excerpt,
      at: n.published_at,
      to: `/app/announcements/${n.id}`,
    })),

    ...blotterRows.map((b) => ({
      key: `blot-${b.id}`,
      icon: 'alert',
      title: `Blotter report ${b.ref_no}`,
      body: BLOTTER_TEXT[b.status] ?? `Your report is now ${b.status}.`,
      at: b.updated_at,
      to: '/app/blotter',
    })),

    // One per resident: a profile has a single approved_at. Note that
    // approve_resident() sets it to now() on every call, so a suspended
    // account that is later reinstated carries a fresh date and the notice
    // appears again -- which is right, because being let back in is news.
    ...approvalRows.map((a) => ({
      key: `reg-${a.id}`,
      icon: 'check',
      title: 'Registration approved',
      body: 'Your resident registration has been approved. You can now use your Barangay E-Assist account.',
      at: a.approved_at,
      to: '/app',
    })),
  ]
    .filter((it) => !removedSet.has(it.key))
    .sort((a, b) => new Date(b.at) - new Date(a.at))

  return {
    items: items.slice(0, SHOWN),
    // The newest thing that exists, which is what "read up to here" means.
    newest: items[0]?.at ?? null,
    unread: counts.reduce((total, n) => total + n, 0),
  }
}

export function NotificationBell() {
  const { profile, refetchProfile } = useAuth()
  const queryClient = useQueryClient()
  const location = useLocation()
  const rootRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [marking, setMarking] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  // Lines already taken off on screen while their row is being written.
  const [removing, setRemoving] = useState([])

  const seenAt = profile?.notifications_seen_at ?? null
  const clearedAt = profile?.notifications_cleared_at ?? null

  const { data, isLoading, isError } = useQuery({
    // Both marks are part of the key: reading and clearing each change what
    // counts as unread, so the tally is asked for again rather than guessed.
    queryKey: ['notifications', profile?.id, seenAt, clearedAt],
    enabled: !!profile?.id,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: () => loadNotifications(profile.id, seenAt, clearedAt),
  })

  const items = (data?.items ?? []).filter((it) => !removing.includes(it.key))
  // A line removed on screen is already gone, so it should not still be
  // counted while its row is in flight.
  const pendingUnread = (data?.items ?? []).filter(
    (it) => removing.includes(it.key) && isNewer(it.at, watermarkOf(seenAt, clearedAt))
  ).length
  const unread = Math.max(0, (data?.unread ?? 0) - pendingUnread)

  useEffect(() => setOpen(false), [location.pathname])
  useEffect(() => {
    if (!open) setConfirmClear(false)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e) {
      if (!rootRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [open])

  /**
   * Moves the read mark up to the newest thing that exists.
   *
   * The timestamp written is that record's own, which the database wrote, not
   * this computer's clock: a resident whose laptop is an hour fast would
   * otherwise mark an hour of future notices as already read. Nothing is
   * deleted -- the list is unchanged, and only the marks come off.
   */
  async function markAllRead() {
    if (!data?.newest || marking) return
    setMarking(true)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ notifications_seen_at: data.newest })
        .eq('id', profile.id)
      if (error) throw error
      // Changes seenAt, which re-keys the query, which recounts: 0.
      await refetchProfile()
    } catch {
      // Bookkeeping only, and never worth an error in front of a resident.
      // The next load settles it either way.
    } finally {
      setMarking(false)
    }
  }

  /**
   * Takes one notice off the bell.
   *
   * It writes a row saying "hide this one" and nothing else. The request,
   * appointment, announcement or blotter report the notice was about is not
   * read, not written and not deleted -- it stays where the resident can
   * still open it from My requests, Appointments, Announcements or Blotter.
   */
  async function dismissOne(item) {
    if (removing.includes(item.key)) return
    setRemoving((keys) => [...keys, item.key])
    try {
      const { error } = await supabase
        .from('notification_dismissals')
        // Two tabs can remove the same line; the primary key settles it.
        .upsert(
          { profile_id: profile.id, item_key: item.key, item_at: item.at },
          { onConflict: 'profile_id,item_key', ignoreDuplicates: true }
        )
      if (error) throw error
      await queryClient.invalidateQueries({ queryKey: ['notifications', profile.id] })
    } catch {
      // Put it back rather than pretending: it is still on the bell.
      setRemoving((keys) => keys.filter((k) => k !== item.key))
    }
  }

  /**
   * Empties the bell.
   *
   * One timestamp does it: everything dated at or before the newest notice on
   * screen stops being shown. Again nothing behind the list is touched. The
   * single delete here is against notification_dismissals, removing the
   * one-at-a-time rows that this watermark has just made redundant, so that
   * table cannot grow for the life of the account.
   */
  async function clearAll() {
    if (!data?.newest || clearing) return
    setClearing(true)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ notifications_cleared_at: data.newest })
        .eq('id', profile.id)
      if (error) throw error

      await supabase
        .from('notification_dismissals')
        .delete()
        .eq('profile_id', profile.id)
        .lte('item_at', data.newest)

      setConfirmClear(false)
      setRemoving([])
      await refetchProfile()
    } catch {
      // Nothing was cleared, so the list is still right as it stands.
    } finally {
      setClearing(false)
    }
  }

  function onButtonKeyDown(e) {
    if (e.key === 'Escape') setOpen(false)
    else if (e.key === 'ArrowDown' && open) {
      e.preventDefault()
      rootRef.current?.querySelector('.bell-item')?.focus()
    }
  }

  // Up and down move between notices; Escape returns to the bell.
  function onListKeyDown(e) {
    const list = [...(rootRef.current?.querySelectorAll('.bell-item') ?? [])]
    const at = list.indexOf(document.activeElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      list[Math.min(at + 1, list.length - 1)]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (at <= 0) rootRef.current?.querySelector('.icon-btn')?.focus()
      else list[at - 1]?.focus()
    } else if (e.key === 'Escape') {
      setOpen(false)
      rootRef.current?.querySelector('.icon-btn')?.focus()
    }
  }

  return (
    <div className="bell" ref={rootRef}>
      <button
        className="icon-btn"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onButtonKeyDown}
      >
        <Icon name="bell" />
        {unread > 0 && (
          // aria-hidden: the count is already in the button's own label, and
          // saying it twice is how a screen reader reads "Notifications 3 3".
          <span className="bell-badge" aria-hidden="true">
            {badgeText(unread)}
          </span>
        )}
      </button>

      {open && (
        <div className="bell-panel" role="region" aria-label="Notifications" onKeyDown={onListKeyDown}>
          <div className="bell-head">
            <span className="search-group">Notifications</span>

            {/* Reading and removing are kept apart on purpose: one takes the
                marks off, the other takes the lines off. While the
                confirmation is up it has the row to itself, so there is
                nothing to hit by mistake. */}
            {confirmClear ? (
              <span className="bell-confirm">
                Clear all?
                <span aria-hidden="true">·</span>
                <button type="button" className="bell-yes" onClick={clearAll} disabled={clearing}>
                  {clearing ? 'Clearing…' : 'Yes'}
                </button>
                <span aria-hidden="true">·</span>
                <button type="button" className="bell-mark" onClick={() => setConfirmClear(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <span className="bell-actions">
                {unread > 0 && (
                  <button type="button" className="bell-mark" onClick={markAllRead} disabled={marking}>
                    {marking ? 'Marking…' : 'Mark all as read'}
                  </button>
                )}
                {items.length > 0 && (
                  <button type="button" className="bell-mark" onClick={() => setConfirmClear(true)}>
                    Clear all
                  </button>
                )}
              </span>
            )}
          </div>

          {isLoading ? (
            <p className="bell-empty" aria-live="polite">
              Loading…
            </p>
          ) : isError ? (
            <p className="bell-empty" role="alert">
              Notifications are not available right now. Please try again.
            </p>
          ) : items.length === 0 ? (
            // A resident who has just emptied the bell needs telling that
            // their requests are still there; one who simply has no news does
            // not. Same box, different sentence.
            <div className="bell-empty">
              {clearedAt ? (
                <>
                  <b>Your notification list is empty.</b>
                  <p>
                    Your requests, appointments and announcements are still in the portal. New
                    updates will appear here.
                  </p>
                </>
              ) : (
                <>
                  <b>You&rsquo;re all caught up.</b>
                  <p>
                    Updates about your requests, appointments and barangay announcements will
                    appear here.
                  </p>
                </>
              )}
            </div>
          ) : (
            items.map((it) => (
              <Link
                key={it.key}
                to={it.to}
                className={`bell-item ${isNewer(it.at, seenAt) ? 'is-new' : ''}`.trim()}
                onClick={() => setOpen(false)}
              >
                <Icon name={it.icon} size="sm" />
                <div style={{ minWidth: 0 }}>
                  <b>{it.title}</b>
                  {it.body && <span>{it.body}</span>}
                  <i>{relative(it.at)}</i>
                </div>
                {isNewer(it.at, seenAt) && <em className="bell-new">New</em>}
                {/* Inside the row's link, so the click has to be stopped by
                    hand or removing a notice would open it instead. */}
                <button
                  type="button"
                  className="bell-x"
                  aria-label={`Remove "${it.title}" from notifications`}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    dismissOne(it)
                  }}
                >
                  <Icon name="x" size="sm" />
                </button>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default NotificationBell
