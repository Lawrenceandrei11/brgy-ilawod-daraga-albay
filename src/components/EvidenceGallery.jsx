import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '../lib/supabase'
import { BUCKET } from '../lib/blotterEvidence'
import { ImageDialog } from './ui/ImageDialog'

/**
 * The photographs attached to a blotter report, for the staff reviewing it.
 *
 * The bucket is private, so every thumbnail is a signed URL that expires in
 * five minutes -- the same window the valid-ID screens use. One request signs
 * the whole set, and the dialog reuses the link the grid already holds rather
 * than asking for a fresh, longer-lived one.
 *
 * Row Level Security is what actually protects these files: the storage policy
 * admits the complainant and approved staff and nobody else, so a path that
 * belonged to another resident's report would simply fail to sign.
 *
 * This component renders nothing at all when a report has no evidence, so the
 * review panel does not grow an empty section for the many reports that have
 * none.
 */

const SIGNED_URL_SECONDS = 300

export function EvidenceGallery({ evidence, refNo }) {
  const [openIndex, setOpenIndex] = useState(null)
  const openerRefs = useRef([])

  const rows = evidence ?? []
  const paths = rows.map((e) => e.storage_path)

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['blotter-evidence-urls', ...paths],
    enabled: paths.length > 0,
    // Refresh comfortably before the links expire.
    staleTime: (SIGNED_URL_SECONDS - 60) * 1000,
    queryFn: async () => {
      const { data: signed, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(paths, SIGNED_URL_SECONDS)
      if (error) throw error
      const byPath = new Map()
      for (const item of signed ?? []) {
        if (item?.path && item.signedUrl) byPath.set(item.path, item.signedUrl)
      }
      return byPath
    },
  })

  if (rows.length === 0) return null

  const label = `${rows.length} photo${rows.length === 1 ? '' : 's'} attached`

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 12, color: 'var(--ink-400)', fontWeight: 600, marginBottom: 6 }}>
        Evidence · {label}
      </div>

      {isLoading ? (
        <div className="idfile idfile-empty">Opening the photos…</div>
      ) : isError ? (
        <div className="idfile idfile-empty">
          These photos could not be opened.{' '}
          <button
            type="button"
            className="idfile-replace"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? 'Trying again…' : 'Try again'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {rows.map((e, i) => {
            const url = data?.get(e.storage_path)
            if (!url) {
              return (
                <div
                  key={e.id}
                  className="idfile idfile-empty"
                  style={{ width: 120, height: 90, display: 'grid', placeItems: 'center', fontSize: 12 }}
                >
                  Not available
                </div>
              )
            }
            return (
              <button
                key={e.id}
                type="button"
                ref={(node) => {
                  openerRefs.current[i] = node
                }}
                onClick={() => setOpenIndex(i)}
                aria-haspopup="dialog"
                aria-label={`Open photo ${i + 1} of ${rows.length} at full size`}
                style={{
                  padding: 0,
                  border: '1px solid var(--ink-200)',
                  borderRadius: 'var(--r-md)',
                  overflow: 'hidden',
                  cursor: 'pointer',
                  background: 'var(--ink-50)',
                  lineHeight: 0,
                }}
              >
                <img
                  src={url}
                  alt={`Evidence photo ${i + 1} of ${rows.length}`}
                  style={{ width: 120, height: 90, objectFit: 'cover', display: 'block' }}
                />
              </button>
            )
          })}
        </div>
      )}

      {openIndex !== null && data?.get(rows[openIndex]?.storage_path) && (
        <ImageDialog
          url={data.get(rows[openIndex].storage_path)}
          title={refNo ? `${refNo} · evidence` : 'Evidence'}
          subtitle={`photo ${openIndex + 1} of ${rows.length}`}
          alt={`Evidence photo ${openIndex + 1} of ${rows.length} for report ${refNo ?? ''}`}
          onClose={() => setOpenIndex(null)}
          openerRef={{ current: openerRefs.current[openIndex] }}
        />
      )}
    </div>
  )
}

export default EvidenceGallery
