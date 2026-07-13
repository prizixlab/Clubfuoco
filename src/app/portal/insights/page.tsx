'use client'

import { useEffect, useState } from 'react'
import { Card, ErrorLine, StatTile, api, C, caps, font, mono, serif } from '../_ui'

interface Insights {
  totals: { last7: number; last30: number; vip30: number; free30: number; checkedIn30: number }
  trend: { date: string; count: number }[]
  byClub: { club: string; free: number; vip: number; total: number }[]
  recent: { id: string; club: string; kind: string; status: string; created_at: string; checked_in: boolean; amount: number | null }[]
}

export default function InsightsPage() {
  const [d, setD] = useState<Insights | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<Insights>('/api/portal/insights')
      .then(setD)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [])

  const maxTrend = d ? Math.max(1, ...d.trend.map(t => t.count)) : 1
  const maxClub = d ? Math.max(1, ...d.byClub.map(c => c.total)) : 1

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontFamily: serif, fontSize: 34, fontWeight: 400, color: C.text }}>Insights</h1>
        <p style={{ margin: '8px 0 0', fontSize: 14, color: C.dim, fontFamily: font }}>
          Bookings against the live guestlist — last 30 days.
        </p>
      </div>

      <ErrorLine error={error} />
      {!d && !error && <p style={{ color: C.dim, fontFamily: font, fontSize: 14 }}>Loading…</p>}

      {d && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 22 }}>
            <StatTile label="Last 7 days" value={d.totals.last7} />
            <StatTile label="Last 30 days" value={d.totals.last30} />
            <StatTile label="Free guestlist" value={d.totals.free30} />
            <StatTile label="VIP tables" value={d.totals.vip30} />
            <StatTile label="Checked in" value={d.totals.checkedIn30} />
          </div>

          {/* 14-day trend */}
          <Card style={{ marginBottom: 22 }}>
            <p style={{ ...caps, color: C.gold, margin: '0 0 16px', letterSpacing: '0.14em' }}>Bookings · last 14 days</p>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120 }}>
              {d.trend.map(t => (
                <div key={t.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }} title={`${t.date}: ${t.count}`}>
                  <div style={{
                    width: '100%', maxWidth: 28, borderRadius: '4px 4px 0 0',
                    height: `${(t.count / maxTrend) * 96}px`, minHeight: t.count ? 3 : 0,
                    background: C.gold, opacity: t.count ? 1 : 0.15,
                  }} />
                  <span style={{ fontFamily: mono, fontSize: 9, color: C.faint }}>{t.date.slice(8)}</span>
                </div>
              ))}
            </div>
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
            {/* By club */}
            <Card>
              <p style={{ ...caps, color: C.gold, margin: '0 0 16px', letterSpacing: '0.14em' }}>Top venues</p>
              {d.byClub.length === 0 && <p style={{ margin: 0, fontSize: 13, color: C.dim, fontFamily: font }}>No bookings yet.</p>}
              <div style={{ display: 'grid', gap: 12 }}>
                {d.byClub.map(c => (
                  <div key={c.club}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                      <span style={{ fontSize: 13, fontFamily: font, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{c.club}</span>
                      <span style={{ fontFamily: mono, fontSize: 12, color: C.dim }}>{c.total}</span>
                    </div>
                    <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
                      <div style={{ width: `${(c.free / maxClub) * 100}%`, background: C.green }} />
                      <div style={{ width: `${(c.vip / maxClub) * 100}%`, background: C.gold }} />
                    </div>
                  </div>
                ))}
              </div>
              {d.byClub.length > 0 && (
                <div style={{ display: 'flex', gap: 16, marginTop: 14 }}>
                  <Legend color={C.green} label="Free" />
                  <Legend color={C.gold} label="VIP" />
                </div>
              )}
            </Card>

            {/* Recent bookings */}
            <Card>
              <p style={{ ...caps, color: C.gold, margin: '0 0 16px', letterSpacing: '0.14em' }}>Recent bookings</p>
              {d.recent.length === 0 && <p style={{ margin: 0, fontSize: 13, color: C.dim, fontFamily: font }}>No bookings yet.</p>}
              <div style={{ display: 'grid', gap: 2 }}>
                {d.recent.map(r => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.line}` }}>
                    <span style={{ width: 6, height: 6, borderRadius: 3, background: r.kind === 'VIP Table' ? C.gold : C.green, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, fontFamily: font, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.club}</p>
                      <span style={{ fontSize: 11, color: C.faint, fontFamily: font }}>{r.kind}{r.checked_in ? ' · checked in' : ''}</span>
                    </div>
                    <span style={{ fontFamily: mono, fontSize: 11, color: C.faint, flexShrink: 0 }}>{timeAgo(r.created_at)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.dim, fontFamily: font }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color }} /> {label}
    </span>
  )
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}
