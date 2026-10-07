'use client'

import { useEffect, useMemo, useState } from 'react'
import type { BrandRow } from '@/lib/partner'
import type { RevenueLine, RevenueMonth } from '@/app/api/portal/brands/[id]/revenue/route'
import { Btn, Card, ErrorLine, StatTile, api, C, caps, font, mono } from '../../_ui'

// Revenue — what this promoter's nights took through Club Fuoco, month by
// month, so they can be invoiced. Gross (what guests paid or owe), not our
// commission: the rate is per deal and goes on the invoice. Read-only; the
// CSV is the hand-off to whatever does the invoicing.
export default function RevenuePanel({ brand, tabs }: { brand: BrandRow; tabs?: React.ReactNode }) {
  const [data, setData] = useState<{ months: RevenueMonth[]; lines: RevenueLine[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [month, setMonth] = useState<string | null>(null)   // filter for the line list

  useEffect(() => {
    api<{ months: RevenueMonth[]; lines: RevenueLine[] }>(`/api/portal/brands/${brand.id}/revenue`)
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load revenue'))
  }, [brand.id])

  const now = new Date()
  const thisMonth = now.toISOString().slice(0, 7)
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7)

  const totals = useMemo(() => {
    const ms = data?.months ?? []
    const of = (m: string) => ms.find(x => x.month === m)?.total ?? 0
    return {
      thisMonth: of(thisMonth),
      lastMonth: of(lastMonth),
      all: ms.reduce((n, m) => n + m.total, 0),
      guests: ms.reduce((n, m) => n + m.guests, 0),
    }
  }, [data, thisMonth, lastMonth])

  const shown = (data?.lines ?? []).filter(l => !month || l.night.startsWith(month))

  return (
    <section style={{ marginTop: 32 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {tabs ?? <span style={{ ...caps, color: C.gold, letterSpacing: '0.14em' }}>Revenue</span>}
            <span style={{ ...caps, color: C.faint, letterSpacing: '0.1em' }}>
              {data ? `${data.lines.length} bookings` : '…'}
            </span>
          </div>
          {data && data.lines.length > 0 && (
            <Btn small onClick={() => downloadCsv(brand, shown, month)}>
              Export CSV{month ? ` · ${monthLabel(month)}` : ''}
            </Btn>
          )}
        </div>

        <p style={{ margin: '-6px 0 16px', fontSize: 12.5, color: C.faint, lineHeight: 1.55, fontFamily: font }}>
          What guests paid or owe for this promoter’s nights booked through Club Fuoco — gross, by the month of the
          night. Apply the agreed commission when invoicing. Cancelled bookings are left out.
        </p>

        <ErrorLine error={error} />
        {!data && !error && <p style={{ color: C.dim, fontFamily: font, fontSize: 14 }}>Loading…</p>}

        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 18 }}>
              <StatTile label={monthLabel(thisMonth)} value={eur(totals.thisMonth)} />
              <StatTile label={monthLabel(lastMonth)} value={eur(totals.lastMonth)} />
              <StatTile label="All time" value={eur(totals.all)} />
              <StatTile label="Guests" value={totals.guests} />
            </div>

            {data.months.length === 0 && (
              <p style={{ margin: 0, color: C.dim, fontFamily: font, fontSize: 13.5 }}>
                Nothing booked through Club Fuoco yet.
              </p>
            )}

            {data.months.length > 0 && (
              <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden', marginBottom: 18 }}>
                <Row head cells={['Month', 'Bookings', 'Guests', 'In app', 'At the door', 'Tables', 'Total']} />
                {data.months.map(m => (
                  <Row
                    key={m.month}
                    active={month === m.month}
                    onClick={() => setMonth(month === m.month ? null : m.month)}
                    cells={[monthLabel(m.month), m.bookings, m.guests, eur(m.online), eur(m.door), eur(m.table), eur(m.total)]}
                  />
                ))}
              </div>
            )}

            {shown.length > 0 && (
              <>
                <p style={{ ...caps, fontSize: 9.5, color: C.faint, letterSpacing: '0.12em', margin: '0 0 8px' }}>
                  {month ? `${monthLabel(month)} · ` : ''}Every booking
                  {month && (
                    <button onClick={() => setMonth(null)} style={{ ...caps, fontSize: 9.5, marginLeft: 10, background: 'none', border: 'none', color: C.goldHi, cursor: 'pointer', padding: 0 }}>
                      Show all months
                    </button>
                  )}
                </p>
                <div style={{ display: 'grid', gap: 5, maxHeight: 420, overflowY: 'auto' }}>
                  {shown.map(l => <Line key={`${l.source}-${l.id}`} line={l} />)}
                </div>
              </>
            )}
          </>
        )}
      </Card>
    </section>
  )
}

const eur = (n: number) => `€${n.toLocaleString('en-GB', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

function monthLabel(m: string): string {
  const [y, mo] = m.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

const KIND: Record<RevenueLine['kind'], string> = { online: 'In app', door: 'At the door', table: 'Table', free: 'Guestlist' }

function Row({ cells, head, active, onClick }: {
  cells: React.ReactNode[]; head?: boolean; active?: boolean; onClick?: () => void
}) {
  return (
    <div onClick={onClick} style={{
      display: 'grid', gridTemplateColumns: '1.3fr repeat(6, 1fr)', gap: 8,
      padding: '9px 13px', cursor: onClick ? 'pointer' : 'default',
      background: active ? 'rgba(192,153,80,0.10)' : head ? C.lifted : C.card,
      borderTop: head ? 'none' : `1px solid ${C.line}`,
    }}>
      {cells.map((c, i) => (
        <span key={i} style={head
          ? { ...caps, fontSize: 9.5, color: C.faint, letterSpacing: '0.12em', textAlign: i ? 'right' : 'left' }
          : { fontFamily: i ? mono : font, fontSize: i ? 12.5 : 13, textAlign: i ? 'right' : 'left',
              color: i === cells.length - 1 ? C.goldHi : i ? C.dim : C.text }}>
          {c}
        </span>
      ))}
    </div>
  )
}

function Line({ line: l }: { line: RevenueLine }) {
  const night = new Date(`${l.night}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 13, background: C.card,
      border: `1px solid ${C.line}`, borderRadius: 8, padding: '8px 13px',
    }}>
      <span style={{ fontFamily: mono, fontSize: 11.5, color: C.goldHi, width: 78, flexShrink: 0 }}>{night}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontFamily: font, fontSize: 13, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {l.event ?? 'Night'}
          <span style={{ color: C.faint }}> · {l.product ?? KIND[l.kind]}</span>
        </p>
        <p style={{ margin: '2px 0 0', fontFamily: font, fontSize: 11.5, color: C.faint }}>
          {l.guest ?? 'Guest'} · {l.guests} {l.guests === 1 ? 'guest' : 'guests'} · {KIND[l.kind]}
          {l.source === 'fourvenues' ? ' · via Fourvenues' : ''}
        </p>
      </div>
      <span style={{ fontFamily: mono, fontSize: 12.5, color: l.amount > 0 ? C.goldHi : C.faint, flexShrink: 0 }}>
        {l.amount > 0 ? eur(l.amount) : 'Free'}
      </span>
    </div>
  )
}

function downloadCsv(brand: BrandRow, lines: RevenueLine[], month: string | null) {
  const esc = (v: unknown) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows = [
    ['Night', 'Booked at', 'Event', 'Product', 'Type', 'Guests', 'Amount (EUR)', 'Guest', 'Source', 'Reference'],
    ...lines.map(l => [l.night, l.booked_at, l.event, l.product, KIND[l.kind], l.guests, l.amount.toFixed(2), l.guest,
      l.source === 'fourvenues' ? 'Fourvenues' : 'Club Fuoco', l.id]),
  ]
  const blob = new Blob([rows.map(r => r.map(esc).join(',')).join('\n')], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${brand.key}-revenue${month ? `-${month}` : ''}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}
