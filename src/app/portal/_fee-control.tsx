'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, C, font, mono } from './_ui'

// The rate Club Fuoco takes from a promoter's ticket sales.
//
// Default is 12%. This is where a signed deal gets applied — the whole reason
// the rate is per-promoter rather than a constant.
//
// Deliberately quiet until opened: a roster of thirty promoters that shows a
// rate field on every row invites a mis-tap on a number that changes what
// someone earns. It loads only when expanded, and confirms before writing.

type Fee = {
  fee_bps: number
  percent: string
  note: string | null
  public_fee_bps: number
  public_percent: string
  public_note: string | null
  updated_at: string | null
  charges_enabled: boolean
  onboarded: boolean
}

/** What PATCH echoes back — the single rate it just wrote. */
type FeeWrite = { kind: Kind; fee_bps: number; fee_percent: string }

type Kind = 'private' | 'public'

export function FeeControl({ userId, name }: { userId: string; name: string }) {
  const [open, setOpen] = useState(false)
  const [fee, setFee] = useState<Fee | null>(null)
  const [kind, setKind] = useState<Kind>('private')
  const [percent, setPercent] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await api<Fee>(`/api/portal/promoters/${userId}/fee`)
      setFee(r)
      setPercent(kind === 'public' ? r.public_percent : r.percent)
      setNote((kind === 'public' ? r.public_note : r.note) ?? '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the rate')
    }
  }, [userId, kind])

  useEffect(() => { if (open && !fee) void load() }, [open, fee, load])

  const save = useCallback(async () => {
    const trimmed = percent.trim()
    if (!trimmed) return
    const label = kind === 'public' ? 'public offer' : 'private event'
    if (!confirm(
      `Set ${name}'s ${label} rate to ${trimmed}%?\n\n` +
      `This changes what Club Fuoco takes from every future ${label} ticket they ` +
      `sell. Their other rate and any completed sales are unaffected.`
    )) return
    setBusy(true); setError(null); setSaved(false)
    try {
      const w = await api<FeeWrite>(`/api/portal/promoters/${userId}/fee`, {
        method: 'PATCH',
        body: JSON.stringify({ kind, percent: trimmed, note: note.trim() || undefined }),
      })
      setPercent(w.fee_percent)
      // Re-read so BOTH rates on screen reflect what is stored, not just the
      // one just written.
      setFee(await api<Fee>(`/api/portal/promoters/${userId}/fee`))
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the rate')
    } finally { setBusy(false) }
  }, [percent, note, userId, name, kind])

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          fontFamily: mono, fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase',
          color: C.dim, background: 'none', border: `1px solid ${C.line}`,
          padding: '4px 8px', cursor: 'pointer', borderRadius: 3,
        }}
      >
        Rate
      </button>
    )
  }

  const active = fee ? (kind === 'public' ? fee.public_percent : fee.percent) : ''
  const activeNote = fee ? (kind === 'public' ? fee.public_note : fee.note) : null
  const dirty = fee ? percent.trim() !== active || (note.trim() || null) !== (activeNote ?? null) : false

  return (
    <div style={{
      border: `1px solid ${C.line}`, borderRadius: 4, padding: 12,
      display: 'flex', flexDirection: 'column', gap: 10, minWidth: 260,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: C.gold }}>
          Platform rate
        </span>
        <button onClick={() => setOpen(false)}
          style={{ fontFamily: mono, fontSize: 10, color: C.dim, background: 'none', border: 'none', cursor: 'pointer' }}>
          Close
        </button>
      </div>

      {!fee && !error && <span style={{ fontFamily: font, fontSize: 12, color: C.dim }}>Loading…</span>}

      {fee && (
        <>
          {!fee.onboarded && (
            <span style={{ fontFamily: font, fontSize: 11.5, color: C.dim, lineHeight: 1.5 }}>
              No Stripe account yet. The rate is saved and applies from their first sale.
            </span>
          )}
          {/* Which deal is being repriced. Both rates are always visible so
              nobody changes one thinking it was the other. */}
          <div style={{ display: 'flex', gap: 6 }}>
            {(['private', 'public'] as Kind[]).map(k => {
              const on = kind === k
              const pct = fee ? (k === 'public' ? fee.public_percent : fee.percent) : '—'
              return (
                <button key={k} onClick={() => setKind(k)} style={{
                  flex: 1, fontFamily: font, fontSize: 11.5, fontWeight: on ? 600 : 400,
                  padding: '7px 8px', borderRadius: 3, cursor: 'pointer', textAlign: 'left',
                  background: on ? 'rgba(192,153,80,0.14)' : 'transparent',
                  color: on ? C.text : C.dim,
                  border: `1px solid ${on ? C.gold : C.line}`,
                }}>
                  <div>{k === 'public' ? 'Public offer' : 'Private event'}</div>
                  <div style={{ fontFamily: mono, fontSize: 13, color: on ? C.goldHi : C.dim }}>{pct}</div>
                </button>
              )
            })}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={percent}
              onChange={e => setPercent(e.target.value)}
              inputMode="decimal"
              aria-label={`Platform rate for ${name}, percent`}
              style={{
                fontFamily: mono, fontSize: 15, width: 74, padding: '7px 9px',
                background: C.bg, color: C.text, border: `1px solid ${C.line}`, borderRadius: 3,
              }}
            />
            <span style={{ fontFamily: mono, fontSize: 14, color: C.dim }}>%</span>
            <button
              onClick={save}
              disabled={busy || !dirty}
              style={{
                fontFamily: font, fontSize: 12, fontWeight: 500, marginLeft: 'auto',
                padding: '7px 13px', borderRadius: 3, cursor: dirty && !busy ? 'pointer' : 'default',
                background: dirty && !busy ? C.gold : 'transparent',
                color: dirty && !busy ? C.bg : C.dim,
                border: `1px solid ${dirty && !busy ? C.gold : C.line}`,
              }}
            >
              {busy ? 'Saving…' : saved ? 'Saved' : 'Save'}
            </button>
          </div>

          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Why — e.g. launch deal, 6 months"
            aria-label="Reason for the rate"
            style={{
              fontFamily: font, fontSize: 12, padding: '6px 9px',
              background: C.bg, color: C.text, border: `1px solid ${C.line}`, borderRadius: 3,
            }}
          />

          <span style={{ fontFamily: font, fontSize: 11, color: C.dim, lineHeight: 1.5 }}>
            {fee.updated_at
              ? `Last changed ${new Date(fee.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
              : 'Never changed — on the 12% default.'}
          </span>
        </>
      )}

      {error && <span style={{ fontFamily: font, fontSize: 11.5, color: '#C2562D' }}>{error}</span>}
    </div>
  )
}
