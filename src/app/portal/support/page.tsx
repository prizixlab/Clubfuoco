'use client'

import { useCallback, useEffect, useState } from 'react'
import type { SupportRow } from '@/app/api/portal/support/route'
import { Badge, Btn, Card, ErrorLine, StatTile, api, C, caps, font, mono, serif } from '../_ui'

// Guest support inbox — reports filed from the consumer app's Help button on a
// reservation. Each row carries the booking context the guest already gave us,
// so support never has to ask them to repeat themselves.

const TOPIC_LABEL: Record<string, string> = {
  refused: 'Refused entry',
  qr:      'QR not working',
  details: 'Wrong details',
  charge:  'Charge problem',
  queue:   'Queue / wait',
  other:   'Something else',
}

// Refused entry and charge problems can cost money or a refund, so they read as
// urgent; the rest are ordinary.
const TOPIC_COLOR: Record<string, string> = {
  refused: '#C7524A',
  charge:  '#C7524A',
  qr:      C.gold,
  queue:   C.gold,
  details: C.dim,
  other:   C.dim,
}

type Filter = 'open' | 'in_progress' | 'resolved' | 'all'

export default function SupportPage() {
  const [rows, setRows] = useState<SupportRow[]>([])
  const [counts, setCounts] = useState({ open: 0, in_progress: 0, resolved: 0 })
  const [unavailable, setUnavailable] = useState(false)
  const [filter, setFilter] = useState<Filter>('open')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    api<{ requests: SupportRow[]; counts: typeof counts; unavailable: boolean }>(
      `/api/portal/support?status=${filter}`,
    )
      .then(r => { setRows(r.requests); setCounts(r.counts); setUnavailable(r.unavailable) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [filter])
  useEffect(load, [load])

  async function setStatus(id: string, status: SupportRow['status']) {
    setBusy(id); setError(null)
    try {
      await api('/api/portal/support', { method: 'PATCH', body: JSON.stringify({ id, status }) })
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update')
    }
    setBusy(null)
  }

  return (
    <>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontFamily: serif, fontSize: 34, fontWeight: 400, color: C.text }}>Support</h1>
        <p style={{ margin: '8px 0 0', fontSize: 14, color: C.dim, fontFamily: font, lineHeight: 1.5 }}>
          What guests reported from the Help button on their reservation. Each report carries
          the booking, venue and night it came from.
        </p>
      </div>

      <ErrorLine error={error} />

      {unavailable ? (
        <Card>
          <p style={{ color: C.dim, fontFamily: font, fontSize: 14, margin: 0 }}>
            The <code style={{ fontFamily: mono, color: C.gold }}>support_requests</code> table
            isn&apos;t applied yet, so there&apos;s nothing to show. Apply{' '}
            <code style={{ fontFamily: mono }}>supabase/migrations/support_requests.sql</code> and reload.
          </p>
        </Card>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <StatTile label="Open" value={counts.open} />
            <StatTile label="In progress" value={counts.in_progress} />
            <StatTile label="Resolved" value={counts.resolved} />
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
            {(['open', 'in_progress', 'resolved', 'all'] as Filter[]).map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                ...caps, letterSpacing: '0.12em', cursor: 'pointer',
                background: filter === f ? 'rgba(192,153,80,0.14)' : 'transparent',
                border: `1px solid ${filter === f ? C.gold : C.line}`,
                color: filter === f ? C.goldHi : C.dim,
                borderRadius: 8, padding: '7px 13px',
              }}>
                {f === 'in_progress' ? 'In progress' : f}
              </button>
            ))}
          </div>

          {loading ? (
            <p style={{ color: C.dim, fontFamily: font, fontSize: 14 }}>Loading…</p>
          ) : rows.length === 0 ? (
            <Card>
              <p style={{ color: C.dim, fontFamily: font, fontSize: 14, margin: 0 }}>
                {filter === 'open' ? 'Nothing open — inbox clear.' : 'No reports here.'}
              </p>
            </Card>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {rows.map(r => (
                <Card key={r.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 240, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                        <Badge color={TOPIC_COLOR[r.topic] ?? C.dim}>
                          {TOPIC_LABEL[r.topic] ?? r.topic}
                        </Badge>
                        {r.status !== 'open' && (
                          <Badge color={r.status === 'resolved' ? C.green : C.gold}>
                            {r.status === 'in_progress' ? 'In progress' : 'Resolved'}
                          </Badge>
                        )}
                      </div>

                      <p style={{
                        margin: 0, fontFamily: font, fontSize: 15, color: C.text, fontWeight: 500,
                      }}>
                        {r.guest_name ?? 'Guest'}
                        {r.club_name && <span style={{ color: C.dim, fontWeight: 400 }}> · {r.club_name}</span>}
                      </p>

                      {r.message && (
                        <p style={{
                          margin: '8px 0 0', fontFamily: font, fontSize: 13.5, color: C.dim,
                          lineHeight: 1.55, whiteSpace: 'pre-wrap',
                        }}>{r.message}</p>
                      )}

                      <p style={{ margin: '10px 0 0', fontFamily: mono, fontSize: 11, color: C.faint }}>
                        {new Date(r.created_at).toLocaleString()}
                        {r.night_date && ` · night ${r.night_date}`}
                        {r.booking_ref && ` · ${r.booking_ref}`}
                        {r.party_size != null && ` · party ${r.party_size}`}
                        {r.booking_status && ` · ${r.booking_status}`}
                      </p>
                      {r.contact_email && (
                        <p style={{ margin: '4px 0 0', fontFamily: mono, fontSize: 11 }}>
                          <a href={`mailto:${r.contact_email}?subject=${encodeURIComponent(
                            `Club Fuoco — your report${r.booking_ref ? ` (${r.booking_ref})` : ''}`,
                          )}`} style={{ color: C.gold }}>{r.contact_email}</a>
                        </p>
                      )}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 130 }}>
                      {r.status !== 'in_progress' && r.status !== 'resolved' && (
                        <Btn small onClick={() => setStatus(r.id, 'in_progress')} disabled={busy === r.id}>
                          Start
                        </Btn>
                      )}
                      {r.status !== 'resolved' ? (
                        <Btn small kind="primary" onClick={() => setStatus(r.id, 'resolved')} disabled={busy === r.id}>
                          Resolve
                        </Btn>
                      ) : (
                        <Btn small onClick={() => setStatus(r.id, 'open')} disabled={busy === r.id}>
                          Reopen
                        </Btn>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
}
