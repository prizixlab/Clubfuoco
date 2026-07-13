'use client'

import { useEffect, useState } from 'react'
import type { AuditEntry } from '@/lib/portal-audit'
import { Card, ErrorLine, api, C, caps, font, mono, serif } from '../_ui'

// Activity — an append-only log of operator actions (brand switches, offer
// edits, provisioning, club changes). Read-only.
// Text-presentation glyphs only — no emoji.
const ICON: Record<string, string> = {
  'brand.create': '＋', 'brand.update': '✎', 'brand.activate': '↯', 'brand.provision': '@',
  'brand.revoke': '⊘', 'offer.create': '＋', 'offer.update': '✎', 'offer.archive': '◐',
  'offer.delete': '×', 'offer.duplicate': '⧉', 'club.update': '✎',
  'promoter.approve': '✓', 'promoter.reject': '×', 'promoter.revoke': '⊘',
  'review.approve': '✓', 'review.reject': '×',
}
const COLOR: Record<string, string> = {
  'brand.activate': C.gold, 'brand.provision': C.gold, 'offer.delete': C.danger, 'brand.revoke': C.danger,
}

function ago(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export default function ActivityPage() {
  const [rows, setRows] = useState<AuditEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<AuditEntry[]>('/api/portal/audit')
      .then(setRows)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [])

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontFamily: serif, fontSize: 34, fontWeight: 400, color: C.text }}>Activity</h1>
        <p style={{ margin: '8px 0 0', fontSize: 14, color: C.dim, fontFamily: font }}>
          Every change made in the portal — most recent first.
        </p>
      </div>

      <ErrorLine error={error} />
      {!rows && !error && <p style={{ color: C.dim, fontFamily: font, fontSize: 14 }}>Loading…</p>}
      {rows?.length === 0 && (
        <Card><p style={{ margin: 0, color: C.dim, fontFamily: font, fontSize: 14 }}>No activity recorded yet.</p></Card>
      )}

      <div style={{ display: 'grid', gap: 8 }}>
        {rows?.map(r => {
          const accent = COLOR[r.action] ?? C.dim
          return (
            <div key={r.id} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: '12px 16px',
            }}>
              <span style={{
                width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: `${accent}1A`, color: accent, fontSize: 14,
              }}>{ICON[r.action] ?? '•'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13.5, fontFamily: font, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.summary}</p>
                <span style={{ ...caps, fontSize: 9.5, color: C.faint, letterSpacing: '0.1em' }}>{r.action}</span>
              </div>
              <span style={{ fontFamily: mono, fontSize: 11.5, color: C.faint, flexShrink: 0 }}>{ago(r.created_at)}</span>
            </div>
          )
        })}
      </div>
    </>
  )
}
