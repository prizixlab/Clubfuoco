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
  const [autoApprove, setAutoApprove] = useState<boolean | null>(null)
  const [autoBusy, setAutoBusy] = useState(false)

  const load = useCallback(() => {
    api<Review[]>('/api/portal/reviews')
      .then(setRows)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
    api<{ auto_approve: boolean }>('/api/portal/settings')
      .then(s => setAutoApprove(s.auto_approve))
      .catch(() => setAutoApprove(false))
  }, [])
  useEffect(load, [load])

  async function toggleAuto() {
    if (autoApprove === null) return
    const next = !autoApprove
    if (next && !confirm(
      'Turn ON auto-approve?\n\nEvery submission — offer changes and promoter nights — goes live '
      + 'immediately with no review, and anything currently waiting is approved now.')) return
    setAutoBusy(true); setError(null)
    try {
      const r = await api<{ auto_approve: boolean; swept?: { changes: number; nights: number; series: number } }>(
        '/api/portal/settings', { method: 'PUT', body: JSON.stringify({ auto_approve: next }) })
      setAutoApprove(r.auto_approve)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the setting')
    } finally {
      setAutoBusy(false)
    }
  }

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
          Event &amp; offer changes submitted from the app — {autoApprove ? 'auto-approved and live immediately.' : 'nothing goes live until you approve it.'}
        </p>
      </div>

      {/* Auto-approve toggle */}
      <Card style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontFamily: font, fontSize: 14, fontWeight: 600, color: C.text }}>
            Auto-approve submissions
          </p>
          <p style={{ margin: '3px 0 0', fontSize: 12.5, color: C.dim, fontFamily: font, lineHeight: 1.5 }}>
            {autoApprove
              ? 'ON — every offer change and promoter night goes live with no review.'
              : 'OFF — you review each submission before it goes live.'}
          </p>
        </div>
        <button
          role="switch"
          aria-checked={!!autoApprove}
          aria-label="Auto-approve submissions"
          onClick={toggleAuto}
          disabled={autoApprove === null || autoBusy}
          style={{
            width: 52, height: 30, flexShrink: 0, borderRadius: 999, position: 'relative', cursor: 'pointer',
            border: 'none', padding: 0, transition: 'background 0.18s',
            background: autoApprove ? C.gold : 'rgba(255,255,255,0.14)',
            opacity: autoApprove === null || autoBusy ? 0.5 : 1,
          }}
        >
          <span style={{
            position: 'absolute', top: 3, left: autoApprove ? 25 : 3, width: 24, height: 24, borderRadius: '50%',
            background: autoApprove ? '#141416' : '#F5F5F7', transition: 'left 0.18s',
          }} />
        </button>
      </Card>

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
