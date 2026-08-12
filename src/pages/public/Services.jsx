import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button, Card, Notice, PngSlot } from '../../components/ui'
import { LoadingRows } from '../../components/ui/States'
import { Icon } from '../../components/Icon'
import { peso, turnaround } from '../../lib/formatters'
import { SERVICE_FIELDS } from '../../lib/serviceFields'

export default function Services() {
  const { signedIn } = useAuth()
  const location = useLocation()

  const { data: services, isLoading } = useQuery({
    queryKey: ['services'],
    queryFn: async () => {
      const { data, error } = await supabase.from('services').select('*').order('sort_order')
      if (error) throw error
      return data
    },
  })

  // Deep links from the landing page arrive as /services#business-clearance
  useEffect(() => {
    if (!location.hash || !services) return
    const el = document.getElementById(location.hash.slice(1))
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [location.hash, services])

  function linkFor(s) {
    if (s.code === 'anonymous') return '/anonymous'
    if (s.code === 'blotter') return signedIn ? '/app/blotter' : '/login'
    return signedIn ? `/app/requests/new/${s.code}` : '/login'
  }

  return (
    <div className="section">
      <div className="section-head">
        <span className="eyebrow">Barangay services</span>
        <h1>What the barangay can issue you</h1>
        <p>
          Fees and processing times are set by the barangay council and shown here as they stand
          today. Bring the requirements listed when you collect.
        </p>
      </div>

      {isLoading ? (
        <Card flush>
          <LoadingRows rows={5} />
        </Card>
      ) : (
        <div className="stack" style={{ gap: 20 }}>
          {(services ?? []).map((s) => {
            const spec = SERVICE_FIELDS[s.code]
            return (
              <Card key={s.code} padded id={s.code} style={{ scrollMarginTop: 90 }}>
                <div className="grid-2 split" style={{ gap: 28, alignItems: 'start' }}>
                  <div>
                    <div className="row" style={{ gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
                      <PngSlot name={s.icon} style={{ width: 56, height: 56, flex: 'none' }} />
                      <div className="grow">
                        <h2 style={{ fontSize: 22 }}>{s.name}</h2>
                        <span style={{ fontSize: 13.5, color: 'var(--ink-400)' }}>
                          {s.kind === 'document' ? 'Barangay document' : s.kind === 'report' ? 'Incident record' : 'No account needed'}
                        </span>
                      </div>
                    </div>

                    <p style={{ fontSize: 15.5, color: 'var(--ink-600)', marginBottom: 18 }}>
                      {s.description}
                    </p>

                    {spec?.intro && (
                      <p style={{ fontSize: 14.5, color: 'var(--ink-500)', marginBottom: 18 }}>{spec.intro}</p>
                    )}

                    <Button to={linkFor(s)} auto icon={s.code === 'anonymous' ? 'incognito' : 'doc'}>
                      {s.code === 'anonymous'
                        ? 'Send an anonymous message'
                        : s.code === 'blotter'
                          ? 'File a blotter report'
                          : signedIn
                            ? `Request a ${s.name}`
                            : 'Sign in to request this'}
                    </Button>
                  </div>

                  <div className="stack" style={{ gap: 16 }}>
                    <div
                      style={{
                        background: 'var(--ink-50)',
                        border: '1px solid var(--ink-200)',
                        borderRadius: 'var(--r-lg)',
                        padding: 18,
                      }}
                    >
                      <div className="row" style={{ gap: 12, marginBottom: 10 }}>
                        <span style={{ fontSize: 14, color: 'var(--ink-500)' }}>Fee</span>
                        <b style={{ marginLeft: 'auto', fontSize: 16, fontFamily: 'var(--display)', color: 'var(--primary-900)' }}>
                          {peso(s.fee)}
                        </b>
                      </div>
                      <div className="row" style={{ gap: 12 }}>
                        <span style={{ fontSize: 14, color: 'var(--ink-500)' }}>Processing</span>
                        <b style={{ marginLeft: 'auto', fontSize: 16, fontFamily: 'var(--display)', color: 'var(--primary-900)' }}>
                          {turnaround(s.processing_days)}
                        </b>
                      </div>
                      {s.requires_council_review && (
                        <p style={{ fontSize: 13, color: 'var(--accent-700)', marginTop: 12 }}>
                          Reviewed by the barangay council before approval.
                        </p>
                      )}
                    </div>

                    <div>
                      <b style={{ display: 'block', fontSize: 14, color: 'var(--ink-800)', marginBottom: 10 }}>
                        What to bring
                      </b>
                      <div className="stack" style={{ gap: 10 }}>
                        {(s.requirements ?? []).map((r) => (
                          <div key={r} className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                            <Icon name="check" size="sm" style={{ color: 'var(--success-500)', marginTop: 3 }} />
                            <span style={{ fontSize: 13.5, color: 'var(--ink-600)' }}>{r}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <div style={{ marginTop: 28 }}>
        <Notice icon="info" title="Already filed something?">
          You can follow any request from the{' '}
          <Link to="/track" style={{ fontWeight: 600 }}>
            tracking page
          </Link>{' '}
          using its reference number and your surname — no account needed.
        </Notice>
      </div>
    </div>
  )
}
