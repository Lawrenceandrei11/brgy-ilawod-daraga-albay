import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'

import { supabase } from '../../lib/supabase'
import { Badge, Button, Card, CardHeader } from '../../components/ui'
import { LoadingRows } from '../../components/ui/States'
import { Icon } from '../../components/Icon'
import { REQUEST_STATUS } from '../../lib/status'
import { peso } from '../../lib/formatters'

/**
 * Barangay reports.
 *
 * Every chart here answers "how many", which is a magnitude question — so the
 * bars carry a single hue rather than a colour per category. Where a row also
 * has a status, the status colour rides on its badge, never on the bar.
 *
 * Each chart is paired with a table view, so identity is never carried by
 * colour alone and the figures can be read out or copied into the paper.
 */
export default function Reports() {
  const [tableView, setTableView] = useState(false)

  const { data: stats, isLoading } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_stats')
      if (error) throw error
      return data
    },
  })

  if (isLoading || !stats) {
    return (
      <div className="dash-body">
        <Card flush>
          <LoadingRows rows={6} />
        </Card>
      </div>
    )
  }

  const byStatus = Object.entries(stats.requests_by_status ?? {})
  const byService = stats.by_service ?? []
  const byMonth = stats.by_month ?? []
  const byPurok = stats.by_purok ?? []
  const blotter = stats.blotter_by_type ?? []

  const released = Number(stats.requests_by_status?.released ?? 0)
  const completionRate = stats.requests_total
    ? Math.round((released / stats.requests_total) * 100)
    : 0

  return (
    <div className="dash-body">
      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <div className="grow">
          <span className="eyebrow">Reports</span>
          <h1 style={{ fontSize: 27, margin: '8px 0 0' }}>Barangay statistics</h1>
        </div>
        <Button
          size="m"
          auto
          variant="secondary"
          icon={tableView ? 'dash' : 'doc'}
          onClick={() => setTableView((v) => !v)}
        >
          {tableView ? 'Show charts' : 'Show as tables'}
        </Button>
        <Button size="m" auto variant="ghost" icon="print" onClick={() => window.print()}>
          Print
        </Button>
      </div>

      {/* A single figure is a tile, not a chart. */}
      <div className="figures">
        <Figure k="Requests filed" v={stats.requests_total} s="All time" />
        <Figure k="Released" v={released} s={`${completionRate}% of everything filed`} />
        <Figure k="Fees collected" v={peso(stats.fees_collected)} s="Recorded as paid" />
        <Figure k="Fees outstanding" v={peso(stats.fees_outstanding)} s="On open requests" />
        <Figure k="Approved residents" v={stats.residents_approved} s="On the masterlist" />
        <Figure k="Open blotter cases" v={stats.blotter_open} s="Filed or in mediation" />
      </div>

      <div className="grid-2" style={{ gap: 24, alignItems: 'start' }}>
        <Card flush>
          <CardHeader title="Requests filed per month" />
          <div style={{ padding: '18px 26px 24px' }}>
            {byMonth.length === 0 ? (
              <p className="chart-empty">No requests have been filed yet.</p>
            ) : tableView ? (
              <SimpleTable head={['Month', 'Requests']} rows={byMonth.map((m) => [formatMonth(m.month), m.count])} />
            ) : (
              <>
                <div className="chart-cols">
                  {byMonth.map((m) => {
                    const max = Math.max(...byMonth.map((x) => x.count), 1)
                    return (
                      <div className="chart-col" key={m.month} title={`${formatMonth(m.month)}: ${m.count}`}>
                        <span className="col-val">{m.count}</span>
                        <div className="col-bar" style={{ height: `${(m.count / max) * 100}%` }} />
                        <span className="col-lbl">{formatMonth(m.month, true)}</span>
                      </div>
                    )
                  })}
                </div>
                <div className="chart-axis" />
              </>
            )}
          </div>
        </Card>

        <Card flush>
          <CardHeader title="Where requests are sitting" />
          <div style={{ padding: '18px 26px 24px' }}>
            {byStatus.length === 0 ? (
              <p className="chart-empty">Nothing filed yet.</p>
            ) : tableView ? (
              <SimpleTable
                head={['Status', 'Requests']}
                rows={byStatus.map(([s, n]) => [REQUEST_STATUS[s]?.label ?? s, n])}
              />
            ) : (
              <div className="chart">
                {byStatus
                  .sort((a, b) => b[1] - a[1])
                  .map(([status, n]) => {
                    const max = Math.max(...byStatus.map((x) => x[1]), 1)
                    return (
                      <div className="chart-row" key={status} title={`${REQUEST_STATUS[status]?.label}: ${n}`}>
                        {/* The status colour lives on the badge; the bar
                            carries magnitude only. */}
                        <Badge status={status} />
                        <div className="chart-track">
                          <div className="chart-bar" style={{ width: `${(n / max) * 100}%` }} />
                        </div>
                        <span className="val">{n}</span>
                      </div>
                    )
                  })}
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="grid-2" style={{ gap: 24, alignItems: 'start' }}>
        <Card flush>
          <CardHeader title="Most requested documents" />
          <div style={{ padding: '18px 26px 24px' }}>
            {tableView ? (
              <SimpleTable
                head={['Document', 'Requests', 'Fees collected']}
                rows={byService.map((s) => [s.name, s.count, peso(s.fees)])}
              />
            ) : (
              <div className="chart">
                {byService.map((s) => {
                  const max = Math.max(...byService.map((x) => x.count), 1)
                  return (
                    <div className="chart-row" key={s.code} title={`${s.name}: ${s.count} · ${peso(s.fees)}`}>
                      <span className="lbl">{s.name}</span>
                      <div className="chart-track">
                        <div className="chart-bar" style={{ width: `${(s.count / max) * 100}%` }} />
                      </div>
                      <span className="val">{s.count}</span>
                    </div>
                  )
                })}
              </div>
            )}
            <p style={{ fontSize: 12.5, color: 'var(--ink-400)', marginTop: 16 }}>
              Fees collected are counted only where a payment has been recorded.
            </p>
          </div>
        </Card>

        <Card flush>
          <CardHeader title="Requests by purok" />
          <div style={{ padding: '18px 26px 24px' }}>
            {byPurok.length === 0 ? (
              <p className="chart-empty">No residents on the masterlist yet.</p>
            ) : tableView ? (
              <SimpleTable head={['Purok', 'Requests']} rows={byPurok.map((p) => [`Purok ${p.purok}`, p.count])} />
            ) : (
              <div className="chart">
                {byPurok.map((p) => {
                  const max = Math.max(...byPurok.map((x) => x.count), 1)
                  return (
                    <div className="chart-row" key={p.purok} title={`Purok ${p.purok}: ${p.count}`}>
                      <span className="lbl">Purok {p.purok}</span>
                      <div className="chart-track">
                        <div className="chart-bar" style={{ width: `${(p.count / max) * 100}%` }} />
                      </div>
                      <span className="val">{p.count}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card flush>
        <CardHeader title="Blotter incidents by type" />
        <div style={{ padding: '18px 26px 24px' }}>
          {blotter.length === 0 ? (
            <p className="chart-empty">No blotter reports have been filed.</p>
          ) : tableView ? (
            <SimpleTable head={['Incident type', 'Reports']} rows={blotter.map((b) => [b.type, b.count])} />
          ) : (
            <div className="chart">
              {blotter.map((b) => {
                const max = Math.max(...blotter.map((x) => x.count), 1)
                return (
                  <div className="chart-row" key={b.type} title={`${b.type}: ${b.count}`}>
                    <span className="lbl">{b.type}</span>
                    <div className="chart-track">
                      <div className="chart-bar" style={{ width: `${(b.count / max) * 100}%` }} />
                    </div>
                    <span className="val">{b.count}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </Card>

      <p style={{ fontSize: 13, color: 'var(--ink-400)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <Icon name="info" size="sm" style={{ marginTop: 2 }} />
        Every chart shows one measure with one colour, because these all answer "how
        many". The table view carries the same figures for reading aloud, printing,
        or copying into a report.
      </p>
    </div>
  )
}

function Figure({ k, v, s }) {
  return (
    <div className="figure">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {s && <div className="s">{s}</div>}
    </div>
  )
}

function SimpleTable({ head, rows }) {
  return (
    <table className="tbl" style={{ marginTop: -8 }}>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} style={{ paddingLeft: 0 }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} data-label={head[j]} style={{ paddingLeft: 0 }}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function formatMonth(m, short = false) {
  try {
    return format(parseISO(`${m}-01`), short ? 'MMM' : 'MMMM yyyy')
  } catch {
    return m
  }
}
