'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge, Btn, Card, ErrorLine, SectionLabel, api, C, caps, font, serif } from '../_ui'
import { shownSuppliers, toggleSupplier } from '@/lib/conflict-rule'

// Where two suppliers compete for the same product at the same venue.
//
// Keyed by venue AND kind. One rule per venue meant picking a supplier for the
// guestlist silently took the VIP tables with it, which is never what the
// operator meant. A venue-wide rule ('*') still applies to any kind that has
// no rule of its own, so existing decisions carry forward.
//
// The selection is a SET, not a winner — with more promoters coming, "show
// these three of five" has to be expressible.

interface Supplier { id: string; name: string; color: string }
interface Conflict {
  club_id:    string
  club_name:  string
  kind:       string
  kind_label: string
  /** Still governed by the venue-wide rule; saving narrows it to this kind. */
  inherited:  boolean
  rule: { mode: 'all' | 'none' | 'selected'; brand_ids: string[] }
  suppliers: Supplier[]
}

export default function ConflictsPage() {
  const [items, setItems] = useState<Conflict[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api<Conflict[]>('/api/portal/conflicts')
      .then(setItems)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [])
  useEffect(load, [load])

  return (
    <>
      <h1 style={{ margin: 0, fontFamily: serif, fontSize: 30, fontWeight: 400, color: C.text }}>
        Offer <em style={{ fontStyle: 'italic', color: C.goldHi }}>conflicts</em>
      </h1>
      <p style={{ margin: '8px 0 24px', fontSize: 14, color: C.dim, fontFamily: font, maxWidth: 620, lineHeight: 1.55 }}>
        Where two suppliers compete for the SAME product at the same venue. A guestlist and a
        VIP table are different products, so they are decided separately — Rumba can run the
        tables while Aashi runs the door. Anything without a genuine clash isn’t listed.
      </p>

      <ErrorLine error={error} />

      {items === null && !error && (
        <p style={{ color: C.dim, fontFamily: font, fontSize: 14 }}>Loading…</p>
      )}

      {items?.length === 0 && (
        <Card>
          <p style={{ margin: 0, fontSize: 14, color: C.dim, fontFamily: font }}>
            No conflicts. Every venue with offers is covered by a single supplier.
          </p>
        </Card>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {items?.map(c => <ConflictCard key={`${c.club_id}|${c.kind}`} item={c} onSaved={load} />)}
      </div>
    </>
  )
}

function ConflictCard({ item, onSaved }: { item: Conflict; onSaved: () => void }) {
  const [mode, setMode] = useState(item.rule.mode)
  const [picked, setPicked] = useState<string[]>(item.rule.brand_ids)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const shown = shownSuppliers({ mode, brand_ids: picked }, item.suppliers.map(s => s.id))

  const dirty = mode !== item.rule.mode
    || (mode === 'selected' && picked.slice().sort().join() !== item.rule.brand_ids.slice().sort().join())

  function toggle(id: string) {
    setSaved(false)
    const next = toggleSupplier(shown, id)
    setMode(next.mode)
    setPicked(next.brand_ids)
  }

  async function save() {
    setBusy(true); setError(null)
    try {
      await api('/api/portal/conflicts', {
        method: 'PUT',
        body: JSON.stringify({ club_id: item.club_id, kind: item.kind, mode, brand_ids: picked }),
      })
      setSaved(true)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    }
    setBusy(false)
  }

  const showing =
    mode === 'all'  ? `all ${item.suppliers.length}`
  : mode === 'none' ? 'none'
  : `${picked.length} of ${item.suppliers.length}`

  return (
    <Card>
      <SectionLabel right={<Badge color={mode === 'none' ? C.danger : C.gold}>{showing} showing</Badge>}>
        {item.club_name} · <span style={{ color: C.goldHi }}>{item.kind_label}</span>
      </SectionLabel>

      {item.inherited && (
        <p style={{ margin: '0 0 12px', fontFamily: font, fontSize: 12.5, color: C.faint, lineHeight: 1.5 }}>
          Currently following this venue&rsquo;s overall rule. Saving here applies to
          {' '}{item.kind_label.toLowerCase()} only and leaves the other products alone.
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
        <Choice active={mode === 'all'} onClick={() => { setMode('all'); setSaved(false) }}>All suppliers</Choice>
        <Choice active={mode === 'none'} onClick={() => { setMode('none'); setSaved(false) }}>No offers</Choice>
      </div>

      <p style={{ ...caps, color: C.faint, margin: '18px 0 10px', letterSpacing: '0.12em' }}>
        or pick who shows
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {item.suppliers.map(s => {
          const on = shown.includes(s.id)
          return (
            <button
              key={s.id}
              onClick={() => toggle(s.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                background: on ? C.lifted : 'transparent',
                border: `1px solid ${on ? C.lineHi : C.line}`,
                borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
              }}
            >
              <span style={{
                width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                border: `1px solid ${on ? C.gold : C.lineHi}`,
                background: on ? C.gold : 'transparent',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                color: '#000', fontSize: 11, fontFamily: font, fontWeight: 700,
              }}>{on ? '✓' : ''}</span>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: s.color, flexShrink: 0 }} />
              <span style={{ fontFamily: font, fontSize: 14, color: C.text }}>{s.name}</span>
            </button>
          )
        })}
      </div>

      <ErrorLine error={error} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
        <Btn kind="primary" onClick={save} disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save'}
        </Btn>
        {saved && !dirty && (
          <span style={{ fontFamily: font, fontSize: 13, color: C.green }}>Saved</span>
        )}
      </div>
    </Card>
  )
}

function Choice({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: font, fontSize: 13, padding: '8px 14px', borderRadius: 999, cursor: 'pointer',
        background: active ? C.gold : 'transparent',
        color: active ? '#000' : C.dim,
        border: `1px solid ${active ? C.gold : C.line}`,
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  )
}
