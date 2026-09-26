import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { Icon } from './Icon'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { statusLabel } from '../lib/status'
import { shortDate } from '../lib/formatters'

/**
 * The topbar search, live as you type.
 *
 * Every query runs under the same Row Level Security as the rest of the app,
 * so this can only find what the signed-in user could already open. `scope`
 * decides which groups are asked for and where each result leads: a resident
 * gets their own requests, published notices and services; staff also get
 * residents, drafts and every request.
 */

const MIN_CHARS = 2
const PER_GROUP = 5
const DEBOUNCE_MS = 250

const RESIDENT_STATUS = {
  approved: 'Approved',
  pending: 'To verify',
  rejected: 'Not approved',
  suspended: 'Suspended',
}

// PostgREST separates or() conditions with commas and groups them with
// parentheses, and % and _ are LIKE wildcards. Anything that could change the
// shape of the query, rather than the text being looked for, is dropped.
function cleanTerm(text) {
  return text.replace(/[%_,()*\\:."']/g, ' ').replace(/\s+/g, ' ').trim()
}

function useDebounced(value, ms) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

function unwrap({ data, error }) {
  if (error) throw error
  return data ?? []
}

const joined = (...parts) => parts.filter(Boolean).join(' · ')

async function searchStaff(term) {
  const like = `%${term}%`
  const [requests, residents, notices, services] = await Promise.all([
    supabase
      .from('document_requests')
      .select('ref_no, status, services(name), profiles!document_requests_profile_id_fkey(full_name)')
      .ilike('ref_no', like)
      .order('filed_at', { ascending: false })
      .limit(PER_GROUP)
      .then(unwrap),
    supabase
      .from('profiles')
      .select('id, full_name, resident_id, status')
      .or(`full_name.ilike.${like},resident_id.ilike.${like}`)
      .order('full_name')
      .limit(PER_GROUP)
      .then(unwrap),
    supabase
      .from('announcements')
      .select('id, title, published_at')
      .or(`title.ilike.${like},excerpt.ilike.${like}`)
      .order('created_at', { ascending: false })
      .limit(PER_GROUP)
      .then(unwrap),
    supabase
      .from('services')
      .select('code, name')
      .or(`name.ilike.${like},description.ilike.${like}`)
      .order('sort_order')
      .limit(PER_GROUP)
      .then(unwrap),
  ])

  return [
    {
      label: 'Document requests',
      items: requests.map((r) => ({
        key: r.ref_no,
        title: r.ref_no,
        meta: joined(r.services?.name, r.profiles?.full_name, statusLabel(r.status)),
        to: `/admin/requests/${r.ref_no}`,
      })),
    },
    {
      label: 'Residents',
      items: residents.map((p) => ({
        key: p.id,
        title: p.full_name || 'Unnamed resident',
        meta: joined(p.resident_id ?? 'No resident ID yet', RESIDENT_STATUS[p.status] ?? p.status),
        to: `/admin/residents/${p.id}`,
      })),
    },
    {
      label: 'Announcements',
      items: notices.map((a) => ({
        key: a.id,
        title: a.title,
        meta: a.published_at ? `Published ${shortDate(a.published_at)}` : 'Draft',
        to: '/admin/announcements',
      })),
    },
    {
      label: 'Services',
      items: services.map((s) => ({ key: s.code, title: s.name, meta: 'Barangay service', to: '/services' })),
    },
  ].filter((g) => g.items.length > 0)
}

async function searchResident(term, profileId) {
  const like = `%${term}%`
  const [requests, notices, services] = await Promise.all([
    // Filtered to the resident explicitly as well as by RLS: staff using the
    // resident view would otherwise be shown everyone's requests here.
    supabase
      .from('document_requests')
      .select('ref_no, status, services(name)')
      .eq('profile_id', profileId)
      .or(`ref_no.ilike.${like},purpose.ilike.${like}`)
      .order('filed_at', { ascending: false })
      .limit(PER_GROUP)
      .then(unwrap),
    // Published only, for the same reason: staff can read drafts.
    supabase
      .from('announcements')
      .select('id, title, published_at')
      .not('published_at', 'is', null)
      .or(`title.ilike.${like},excerpt.ilike.${like}`)
      .order('published_at', { ascending: false })
      .limit(PER_GROUP)
      .then(unwrap),
    supabase
      .from('services')
      .select('code, name')
      .or(`name.ilike.${like},description.ilike.${like}`)
      .order('sort_order')
      .limit(PER_GROUP)
      .then(unwrap),
  ])

  return [
    {
      label: 'My requests',
      items: requests.map((r) => ({
        key: r.ref_no,
        title: r.ref_no,
        meta: joined(r.services?.name, statusLabel(r.status)),
        to: `/app/requests/${r.ref_no}`,
      })),
    },
    {
      label: 'Announcements',
      items: notices.map((a) => ({
        key: a.id,
        title: a.title,
        meta: shortDate(a.published_at),
        // Inside the portal: a resident following a search result keeps their
        // sidebar and top bar, as they do everywhere else in /app.
        to: `/app/announcements/${a.id}`,
      })),
    },
    {
      label: 'Services',
      items: services.map((s) => ({ key: s.code, title: s.name, meta: 'Barangay service', to: '/services' })),
    },
  ].filter((g) => g.items.length > 0)
}

export function GlobalSearch({ scope, placeholder }) {
  const { profile } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const rootRef = useRef(null)
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)

  const typed = cleanTerm(text)
  const term = useDebounced(typed, DEBOUNCE_MS)
  const ready = typed.length >= MIN_CHARS

  const { data: groups, isError } = useQuery({
    queryKey: ['global-search', scope, profile?.id, term],
    enabled: !!profile?.id && term.length >= MIN_CHARS,
    staleTime: 30_000,
    queryFn: () => (scope === 'admin' ? searchStaff(term) : searchResident(term, profile.id)),
  })

  // Still waiting for the pause in typing, or for the answer to come back.
  const pending = typed !== term || (!groups && !isError)

  // A result was followed: start the next search from a clean box.
  useEffect(() => {
    setOpen(false)
    setText('')
  }, [location.pathname])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e) {
      if (!rootRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      setOpen(false)
      e.currentTarget.blur()
    } else if (e.key === 'Enter') {
      const first = groups?.[0]?.items[0]
      if (first && !pending) navigate(first.to)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      rootRef.current?.querySelector('.search-item')?.focus()
    }
  }

  // Up and down move between results; Escape returns to the box.
  function onResultsKeyDown(e) {
    const items = [...(rootRef.current?.querySelectorAll('.search-item') ?? [])]
    const at = items.indexOf(document.activeElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      items[Math.min(at + 1, items.length - 1)]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (at <= 0) rootRef.current?.querySelector('input')?.focus()
      else items[at - 1]?.focus()
    } else if (e.key === 'Escape') {
      setOpen(false)
      rootRef.current?.querySelector('input')?.focus()
    }
  }

  return (
    <div className="search" ref={rootRef} style={{ position: 'relative' }}>
      <Icon name="search" />
      <input
        value={text}
        placeholder={placeholder}
        aria-label="Search"
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />

      {open && ready && (
        <div className="search-results" onKeyDown={onResultsKeyDown}>
          {pending ? (
            <p className="search-empty" aria-live="polite">Searching…</p>
          ) : isError ? (
            <p className="search-empty" role="alert">Search is not available right now. Please try again.</p>
          ) : groups.length === 0 ? (
            <p className="search-empty" aria-live="polite">No results found for “{typed}”.</p>
          ) : (
            groups.map((g) => (
              <div key={g.label}>
                <div className="search-group">{g.label}</div>
                {g.items.map((it) => (
                  <Link key={it.key} to={it.to} className="search-item" onClick={() => setOpen(false)}>
                    <b>{it.title}</b>
                    {it.meta && <span>{it.meta}</span>}
                  </Link>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default GlobalSearch
