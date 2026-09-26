import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '../lib/supabase'
import { Badge, Button, Card, PngSlot } from './ui'
import { EmptyState, LoadingRows } from './ui/States'
import { Icon } from './Icon'
import { longDate, relative } from '../lib/formatters'
import { publicPhotoUrl } from '../lib/storage'

/**
 * The barangay's notices, read from one place by two.
 *
 * A visitor reads them on the public pages; a signed-in resident reads the
 * same notices without leaving their portal, so the sidebar and top bar stay
 * put. Both render these components against the same queries and the same
 * query keys, so there is one set of announcement logic and the cache is
 * shared between them.
 *
 * `basePath` is what differs: every link a notice makes -- to itself, back to
 * the list, across to another notice -- is built from it, so the resident
 * never lands on a public URL and the visitor never lands on a portal one.
 */

export function AnnouncementList({ basePath = '/announcements', heading = null }) {
  const [category, setCategory] = useState('all')

  const { data, isLoading } = useQuery({
    queryKey: ['announcements', 'public'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .not('published_at', 'is', null)
        .order('published_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  const categories = [...new Set((data ?? []).map((a) => a.category).filter(Boolean))]
  const rows = (data ?? []).filter((a) => category === 'all' || a.category === category)

  return (
    <>
      {heading}

      {categories.length > 0 && (
        <div className="filterbar" style={{ marginBottom: 24 }}>
          <button className="chip" aria-pressed={category === 'all'} onClick={() => setCategory('all')}>
            All notices
          </button>
          {categories.map((c) => (
            <button key={c} className="chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <Card flush>
          <LoadingRows rows={4} />
        </Card>
      ) : rows.length === 0 ? (
        <Card flush>
          <EmptyState icon="mega" title="No notices yet">
            When the barangay posts a notice it appears here.
          </EmptyState>
        </Card>
      ) : (
        <div className="ann-grid">
          {rows.map((a) => (
            <article className="ann" key={a.id}>
              <PngSlot name="announcement-placeholder.png" src={publicPhotoUrl(a.cover_path)} className="cover" />
              <div className="body">
                <span className="date">{longDate(a.published_at)}</span>
                <h2>{a.title}</h2>
                <p>{a.excerpt}</p>
                <Link to={`${basePath}/${a.id}`} style={{ fontSize: 14, fontWeight: 600 }}>
                  Read the notice →
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  )
}

export function AnnouncementDetail({
  basePath = '/announcements',
  backLabel = 'All announcements',
  // The invitation to register is for visitors; a resident reading this in
  // their own portal has already done it.
  invite = true,
}) {
  const { id } = useParams()

  const { data: a, isLoading } = useQuery({
    queryKey: ['announcement', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .eq('id', id)
        .not('published_at', 'is', null)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  const { data: others } = useQuery({
    queryKey: ['announcements', 'others', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('announcements')
        .select('id, title, published_at')
        .not('published_at', 'is', null)
        .neq('id', id)
        .order('published_at', { ascending: false })
        .limit(4)
      if (error) throw error
      return data
    },
  })

  if (isLoading) {
    return (
      <Card flush>
        <LoadingRows rows={5} />
      </Card>
    )
  }

  if (!a) {
    return (
      <Card flush>
        <EmptyState
          icon="search"
          title="Notice not found"
          action={
            <Button to={basePath} size="m" auto variant="secondary">
              {backLabel}
            </Button>
          }
        >
          This notice may have been taken down.
        </EmptyState>
      </Card>
    )
  }

  return (
    <>
      <Link
        to={basePath}
        style={{ fontSize: 13.5, color: 'var(--ink-500)', display: 'inline-flex', gap: 6, alignItems: 'center', marginBottom: 20 }}
      >
        <Icon name="chev" size="sm" style={{ transform: 'rotate(180deg)' }} /> {backLabel}
      </Link>

      <div className="grid-2 split" style={{ gap: 32, alignItems: 'start' }}>
        <article>
          {a.category && <Badge tone="ready">{a.category}</Badge>}
          <h1 style={{ fontSize: 'clamp(26px,3.2vw,36px)', lineHeight: 1.15, margin: '16px 0 12px' }}>
            {a.title}
          </h1>
          <p style={{ fontSize: 14, color: 'var(--ink-400)', marginBottom: 24 }}>
            Posted {longDate(a.published_at)} · {relative(a.published_at)}
          </p>

          <PngSlot
            name="announcement-placeholder.png"
            src={publicPhotoUrl(a.cover_path)}
            style={{ width: '100%', height: 260, marginBottom: 26 }}
          />

          {/* Notices are typed as plain text by barangay staff, so paragraphs
              are split on blank lines rather than rendered as HTML — which
              also means a notice can never inject markup into this page. */}
          <div style={{ fontSize: 16.5, lineHeight: 1.7, color: 'var(--ink-700)' }}>
            {a.body.split(/\n{2,}/).map((para, i) => (
              <p key={i} style={{ marginBottom: 18 }}>
                {para}
              </p>
            ))}
          </div>
        </article>

        <aside className="stack" style={{ gap: 20 }}>
          <Card padded>
            <h2 style={{ fontSize: 16.5, marginBottom: 14 }}>Other notices</h2>
            <div className="stack" style={{ gap: 14 }}>
              {(others ?? []).map((o) => (
                <Link key={o.id} to={`${basePath}/${o.id}`} style={{ display: 'block' }}>
                  <b style={{ display: 'block', fontSize: 14.5, color: 'var(--ink-800)', lineHeight: 1.4 }}>
                    {o.title}
                  </b>
                  <span style={{ fontSize: 12.5, color: 'var(--ink-400)' }}>{longDate(o.published_at)}</span>
                </Link>
              ))}
            </div>
          </Card>

          {invite && (
            <Card padded style={{ background: 'var(--primary-100)', borderColor: 'var(--primary-200)' }}>
              <Icon name="bell" size="lg" style={{ color: 'var(--primary-600)', marginBottom: 10 }} />
              <h2 style={{ fontSize: 16.5, marginBottom: 8 }}>Get these on your dashboard</h2>
              <p style={{ fontSize: 14, color: 'var(--primary-800)', marginBottom: 16 }}>
                Registered residents see every notice when they sign in, alongside their own
                requests.
              </p>
              <Button to="/register" size="s" variant="secondary" block>
                Register as a resident
              </Button>
            </Card>
          )}
        </aside>
      </div>
    </>
  )
}
