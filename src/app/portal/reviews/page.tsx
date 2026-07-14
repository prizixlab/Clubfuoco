'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge, Btn, Card, ErrorLine, api, C, caps, font, mono, serif } from '../_ui'

interface Review {
  id: string
  type: 'change' | 'night' | 'series'
  entity: string
  action: string
  summary: string
  created_at: string
  payload?: Record<string, unknown> | null
}

const ACTION_LABEL: Record<string, string> = {
  'offer.create': 'New offer', 'offer.update': 'Offer change', 'offer.delete': 'Offer removal',
  'night.create': 'New night', 'series.create': 'New series',
}

export default function ReviewsPage() {
  const [rows, setRows] = useState<Review[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    api<Review[]>('/api/portal/reviews')
      .then(setRows)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [])
  useEffect(load, [load])

  async function decide(r: Review, decision: 'approve' | 'reject') {
    let reason: string | undefined
    if (decision === 'reject') {
      // The reason is threaded back to the submitter in-app (and by push), so
      // ask for one — cancel aborts, empty is allowed but discouraged.
      const input = prompt('Reject this change? It will be discarded.\n\nReason shown to the submitter:')
      if (input === null) return
      reason = input.trim() || undefined
    }
    setBusy(r.id)
    try {
      await api(`/api/portal/reviews/${r.id}`, { method: 'POST', body: JSON.stringify({ decision, type: r.type, reason }) })
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontFamily: serif, fontSize: 34, fontWeight: 400, color: C.text }}>Changes</h1>
        <p style={{ margin: '8px 0 0', fontSize: 14, color: C.dim, fontFamily: font }}>
          Event &amp; offer changes submitted from the app — nothing goes live until you approve it.
        </p>
      </div>

      <ErrorLine error={error} />
      {!rows && !error && <p style={{ color: C.dim, fontFamily: font, fontSize: 14 }}>Loading…</p>}
      {rows?.length === 0 && (
        <Card><p style={{ margin: 0, color: C.dim, fontFamily: font, fontSize: 14 }}>Nothing waiting for review.</p></Card>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {rows?.map(r => (
          <Card key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                <Badge color={r.action === 'offer.delete' ? C.danger : C.gold}>{ACTION_LABEL[r.action] ?? r.action}</Badge>
                <Badge color={C.faint}>{r.type === 'change' ? 'supplier' : 'promoter'}</Badge>
              </div>
              <p style={{ margin: 0, fontSize: 14.5, fontFamily: font, color: C.text }}>{r.summary}</p>
              <p style={{ margin: '4px 0 0', fontFamily: mono, fontSize: 11, color: C.faint }}>
                {new Date(r.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </p>
              <ReviewDetail payload={r.payload ?? null} action={r.action} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Btn kind="primary" onClick={() => decide(r, 'approve')} disabled={busy === r.id}>
                {busy === r.id ? '…' : 'Approve'}
              </Btn>
              <Btn kind="danger" onClick={() => decide(r, 'reject')} disabled={busy === r.id}>Reject</Btn>
            </div>
          </Card>
        ))}
      </div>
    </>
  )
}

// Compact readout of what the change actually contains.
function ReviewDetail({ payload, action }: { payload: Record<string, unknown> | null; action: string }) {
  if (!payload || action === 'offer.delete') return null
  const fields: [string, unknown][] = Object.entries(payload).filter(([, v]) => v !== undefined && v !== null && v !== '')
  if (!fields.length) return null
  return (
    <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
      {fields.slice(0, 8).map(([k, v]) => (
        <span key={k} style={{ fontSize: 11.5, fontFamily: font, color: C.dim }}>
          <span style={{ ...caps, fontSize: 9, color: C.faint, marginRight: 4 }}>{k.replace(/_/g, ' ')}</span>
          <span style={{ color: C.text }}>{String(v)}</span>
        </span>
      ))}
    </div>
  )
}
