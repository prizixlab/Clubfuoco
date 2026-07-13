'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge, Btn, Card, ErrorLine, api, C, caps, font, mono, serif } from '../_ui'

interface Application {
  id: string
  user_id: string
  email: string | null
  full_name: string | null
  instagram: string | null
  clubs: string | null
  experience: string | null
  status: 'pending' | 'approved' | 'rejected'
  ig_code: string | null
  ig_verified: boolean
  is_promoter: boolean
  created_at: string
  reviewed_at: string | null
}

// Promoter account approvals — who gets (and keeps) access to the
// FuocoPromoters app. Approving an application is what unlocks the app for
// that account. Event/offer changes live on the separate Changes tab.
export default function PromotersPage() {
  const [pending, setPending] = useState<Application[] | null>(null)
  const [decided, setDecided] = useState<Application[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    api<{ pending: Application[]; decided: Application[] }>('/api/portal/promoters')
      .then(r => { setPending(r.pending); setDecided(r.decided) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [])
  useEffect(load, [load])

  async function decide(app: Application, decision: 'approve' | 'reject' | 'revoke') {
    const who = app.full_name || app.email || `@${app.instagram}`
    const msg = decision === 'approve'
      ? `Approve ${who} as a promoter? They get full access to the FuocoPromoters app.`
      : decision === 'revoke'
        ? `Revoke ${who}'s promoter access? They'll be locked out of the app.`
        : `Reject ${who}'s application?`
    if (!confirm(msg)) return
    setBusy(app.id)
    try {
      await api(`/api/portal/promoters/${app.id}`, { method: 'POST', body: JSON.stringify({ decision }) })
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
        <h1 style={{ margin: 0, fontFamily: serif, fontSize: 34, fontWeight: 400, color: C.text }}>Promoters</h1>
        <p style={{ margin: '8px 0 0', fontSize: 14, color: C.dim, fontFamily: font }}>
          Approve who can use the FuocoPromoters app — applications first, roster below.
        </p>
      </div>

      <ErrorLine error={error} />
      {!pending && !error && <p style={{ color: C.dim, fontFamily: font, fontSize: 14 }}>Loading…</p>}

      {pending && (
        <>
          <p style={{ ...caps, color: C.gold, margin: '0 0 12px', letterSpacing: '0.14em' }}>
            Awaiting approval {pending.length > 0 && `· ${pending.length}`}
          </p>
          {pending.length === 0 && (
            <Card style={{ marginBottom: 26 }}>
              <p style={{ margin: 0, color: C.dim, fontFamily: font, fontSize: 14 }}>No applications waiting.</p>
            </Card>
          )}
          <div style={{ display: 'grid', gap: 12, marginBottom: 30 }}>
            {pending.map(a => (
              <Card key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 15.5, fontWeight: 700, fontFamily: font, color: C.text }}>
                      {a.full_name || a.email || 'Unnamed'}
                    </span>
                    {a.instagram && (
                      <a href={`https://instagram.com/${a.instagram.replace(/^@/, '')}`} target="_blank" rel="noreferrer"
                        style={{ fontFamily: mono, fontSize: 12.5, color: C.goldHi, textDecoration: 'none' }}>
                        @{a.instagram.replace(/^@/, '')} ↗
                      </a>
                    )}
                  </div>
                  {a.email && <p style={{ margin: '3px 0 0', fontFamily: mono, fontSize: 11.5, color: C.dim }}>{a.email}</p>}
                  <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
                    {a.clubs && <Fact label="Clubs" value={a.clubs} />}
                    {a.experience && <Fact label="Experience" value={a.experience} />}
                    {a.ig_code && <Fact label="DM code" value={a.ig_code} mono />}
                    <Fact label="Applied" value={new Date(a.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} />
                  </div>
                  <p style={{ margin: '8px 0 0', fontSize: 11.5, color: C.faint, fontFamily: font }}>
                    Check their IG DMs for the code above before approving.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <Btn kind="primary" onClick={() => decide(a, 'approve')} disabled={busy === a.id}>
                    {busy === a.id ? '…' : 'Approve'}
                  </Btn>
                  <Btn kind="danger" onClick={() => decide(a, 'reject')} disabled={busy === a.id}>Reject</Btn>
                </div>
              </Card>
            ))}
          </div>

          <p style={{ ...caps, color: C.gold, margin: '0 0 12px', letterSpacing: '0.14em' }}>Roster &amp; past decisions</p>
          {decided.length === 0 && (
            <Card><p style={{ margin: 0, color: C.dim, fontFamily: font, fontSize: 14 }}>No decided applications yet.</p></Card>
          )}
          <div style={{ display: 'grid', gap: 8 }}>
            {decided.map(a => (
              <div key={a.id} style={{
                display: 'flex', alignItems: 'center', gap: 14,
                background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: '11px 16px',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontFamily: font, color: C.text }}>
                    {a.full_name || a.email || 'Unnamed'}
                  </span>
                  <span style={{ fontFamily: mono, fontSize: 11.5, color: C.dim, marginLeft: 10 }}>
                    @{(a.instagram ?? '').replace(/^@/, '')}
                  </span>
                </div>
                <Badge color={a.is_promoter ? C.green : C.faint}>{a.is_promoter ? 'Active' : 'No access'}</Badge>
                {a.is_promoter
                  ? <Btn small kind="danger" onClick={() => decide(a, 'revoke')} disabled={busy === a.id}>Revoke</Btn>
                  : <Btn small onClick={() => decide(a, 'approve')} disabled={busy === a.id}>Grant access</Btn>}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function Fact({ label, value, mono: isMono }: { label: string; value: string; mono?: boolean }) {
  return (
    <span style={{ fontSize: 12, fontFamily: font, color: C.dim }}>
      <span style={{ ...caps, fontSize: 9, color: C.faint, marginRight: 5 }}>{label}</span>
      <span style={{ color: C.text, fontFamily: isMono ? mono : font, fontSize: isMono ? 11.5 : 12 }}>{value}</span>
    </span>
  )
}
