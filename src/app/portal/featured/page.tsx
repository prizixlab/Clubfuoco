'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FeaturedSlot, FeaturedCandidate } from '@/app/api/portal/featured/route'
import {
  Badge, Btn, Card, ErrorLine, Modal, StatTile, TextInput,
  api, C, caps, font, mono, serif,
} from '../_ui'

// The Featured desk — what leads Explore, decided here rather than computed.
//
//   TIER 1 — the big hero card at the head of the featured shelf. One thing
//   gets it; anything below the first is a fallback for when the first isn't
//   showable (a night that has passed, a venue we dropped).
//
//   TIER 2 — the line of smaller cards under the hero.
//
// Events and venues sit in the same lists on purpose: the shelf answers "what
// is on tonight", and a room is as good an answer as a night.

function fmtDate(d: string | null): string | null {
  if (!d) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  if (!m) return d
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
}

export default function FeaturedPage() {
  const [slots, setSlots] = useState<FeaturedSlot[] | null>(null)
  const [candidates, setCandidates] = useState<FeaturedCandidate[]>([])
  const [needsMigration, setNeedsMigration] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [picking, setPicking] = useState<1 | 2 | null>(null)

  const load = useCallback(() => {
    api<{ slots: FeaturedSlot[]; candidates: FeaturedCandidate[]; needs_migration?: boolean }>(
      '/api/portal/featured')
      .then(r => {
        setSlots(r.slots)
        setCandidates(r.candidates)
        setNeedsMigration(!!r.needs_migration)
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [])
  useEffect(load, [load])

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id); setError(null)
    try { await fn(); load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setBusy(null) }
  }

  const move = (s: FeaturedSlot, tier: 1 | 2) =>
    act(s.id, () => api(`/api/portal/featured/${s.id}`, {
      method: 'PATCH', body: JSON.stringify({ tier }),
    }))

  const remove = (s: FeaturedSlot) =>
    act(s.id, () => api(`/api/portal/featured/${s.id}`, { method: 'DELETE' }))

  /// Reorder within a tier by swapping ranks with the neighbour — the list is
  /// short enough that this beats a drag surface, and it can't half-apply.
  async function nudge(s: FeaturedSlot, dir: -1 | 1) {
    const peers = (slots ?? []).filter(x => x.tier === s.tier)
    const i = peers.findIndex(x => x.id === s.id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= peers.length) return
    const other = peers[j]
    setBusy(s.id); setError(null)
    try {
      await api(`/api/portal/featured/${s.id}`, { method: 'PATCH', body: JSON.stringify({ rank: other.rank }) })
      await api(`/api/portal/featured/${other.id}`, { method: 'PATCH', body: JSON.stringify({ rank: s.rank }) })
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reorder')
    } finally { setBusy(null) }
  }

  const tier1 = (slots ?? []).filter(s => s.tier === 1)
  const tier2 = (slots ?? []).filter(s => s.tier === 2)

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '0 24px 64px' }}>
      <div style={{ margin: '8px 0 24px' }}>
        <h1 style={{ fontFamily: serif, fontSize: 34, margin: '0 0 6px', color: C.text }}>Featured</h1>
        <p style={{ margin: 0, fontSize: 13.5, color: C.dim, fontFamily: font, maxWidth: 660, lineHeight: 1.5 }}>
          What leads Explore. <strong style={{ color: C.goldHi, fontWeight: 500 }}>Tier 1</strong> is the
          big card at the top; <strong style={{ color: C.goldHi, fontWeight: 500 }}>Tier 2</strong> is the
          line of smaller cards under it. Events and venues can take either.
        </p>
      </div>

      {needsMigration && (
        <Card style={{ marginBottom: 20, borderColor: C.danger }}>
          <p style={{ margin: 0, color: C.text, fontFamily: font, fontSize: 13.5, lineHeight: 1.6 }}>
            The <code style={{ fontFamily: mono, color: C.goldHi }}>featured_slots</code> table
            isn&rsquo;t applied yet, so nothing can be saved. Run{' '}
            <code style={{ fontFamily: mono, color: C.goldHi }}>
              supabase/migrations/20260911_featured_slots.sql
            </code>{' '}
            in the SQL editor, then reload.
          </p>
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatTile label="Tier 1" value={slots ? tier1.length : '—'} />
        <StatTile label="Tier 2" value={slots ? tier2.length : '—'} />
        <StatTile label="Events" value={slots ? (slots.filter(s => s.kind === 'event').length) : '—'} />
        <StatTile label="Venues" value={slots ? (slots.filter(s => s.kind === 'venue').length) : '—'} />
      </div>

      <ErrorLine error={error} />
      {slots === null && !error && <p style={{ color: C.faint, fontFamily: font, fontSize: 13.5 }}>Loading…</p>}

      {slots !== null && (
        <>
          <Tier
            n={1}
            blurb="The hero card. The first showable one wins — anything under it is a standby for when that night has passed."
            slots={tier1} busy={busy}
            onAdd={() => setPicking(1)}
            onMove={s => move(s, 2)} onRemove={remove} onNudge={nudge}
          />
          <Tier
            n={2}
            blurb="The row beneath the hero, in this order, mixed in with the night's venues."
            slots={tier2} busy={busy}
            onAdd={() => setPicking(2)}
            onMove={s => move(s, 1)} onRemove={remove} onNudge={nudge}
          />
        </>
      )}

      {picking !== null && (
        <PickerModal
          tier={picking}
          candidates={candidates}
          onClose={() => setPicking(null)}
          onPick={async (c) => {
            setError(null)
            try {
              await api('/api/portal/featured', {
                method: 'POST',
                body: JSON.stringify({ kind: c.kind, id: c.id, tier: picking }),
              })
              setPicking(null)
              load()
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not feature that')
            }
          }}
        />
      )}
    </div>
  )
}

function Tier({ n, blurb, slots, busy, onAdd, onMove, onRemove, onNudge }: {
  n: 1 | 2
  blurb: string
  slots: FeaturedSlot[]
  busy: string | null
  onAdd: () => void
  onMove: (s: FeaturedSlot) => void
  onRemove: (s: FeaturedSlot) => void
  onNudge: (s: FeaturedSlot, dir: -1 | 1) => void
}) {
  return (
    <section style={{ marginBottom: 34 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: 12, margin: '0 0 6px',
      }}>
        <p style={{ ...caps, color: C.gold, margin: 0, letterSpacing: '0.14em' }}>
          Tier {n} · {n === 1 ? 'the big spot' : 'the line under it'}
        </p>
        <Btn small onClick={onAdd}>Add to tier {n}</Btn>
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 12.5, color: C.faint, fontFamily: font, lineHeight: 1.5 }}>
        {blurb}
      </p>

      {slots.length === 0 ? (
        <Card>
          <p style={{ margin: 0, color: C.dim, fontFamily: font, fontSize: 13.5 }}>
            Nothing in tier {n}.{' '}
            {n === 1
              ? 'Explore falls back to whichever venue has a live offer tonight.'
              : 'The row under the hero is just venues.'}
          </p>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {slots.map((s, i) => (
            <div key={s.id} style={{
              background: C.card, border: `1px solid ${n === 1 && i === 0 ? C.gold : C.line}`,
              borderRadius: 8, padding: '12px 14px',
              display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
              opacity: s.live ? 1 : 0.6,
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {s.image
                ? <img src={s.image} alt="" style={{ width: 54, height: 54, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
                : <div style={{ width: 54, height: 54, borderRadius: 6, background: 'rgba(255,255,255,0.05)', flexShrink: 0 }} />}

              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontFamily: font, fontSize: 15, fontWeight: 600, color: C.text }}>{s.title}</div>
                <div style={{ fontFamily: font, fontSize: 12.5, color: C.dim, marginTop: 3 }}>
                  {[fmtDate(s.night_date), s.subtitle].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Badge color={s.kind === 'event' ? C.gold : C.green}>
                  {s.kind === 'event' ? 'Event' : 'Venue'}
                </Badge>
                {n === 1 && i === 0 && <Badge color={C.goldHi}>Live hero</Badge>}
                {!s.live && <Badge color={C.danger}>Not showable</Badge>}
              </div>

              <div style={{ display: 'flex', gap: 6 }}>
                <Btn small kind="ghost" disabled={busy === s.id || i === 0} onClick={() => onNudge(s, -1)}>↑</Btn>
                <Btn small kind="ghost" disabled={busy === s.id || i === slots.length - 1} onClick={() => onNudge(s, 1)}>↓</Btn>
                <Btn small kind="ghost" disabled={busy === s.id} onClick={() => onMove(s)}>
                  {n === 1 ? 'To tier 2' : 'To tier 1'}
                </Btn>
                <Btn small kind="danger" disabled={busy === s.id} onClick={() => onRemove(s)}>Remove</Btn>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function PickerModal({ tier, candidates, onClose, onPick }: {
  tier: 1 | 2
  candidates: FeaturedCandidate[]
  onClose: () => void
  onPick: (c: FeaturedCandidate) => void
}) {
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<'all' | 'event' | 'venue'>('all')

  const list = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return candidates
      .filter(c => kind === 'all' || c.kind === kind)
      .filter(c => {
        if (terms.length === 0) return true
        const hay = [c.title, c.subtitle, c.night_date, fmtDate(c.night_date)]
          .filter(Boolean).join(' ').toLowerCase()
        return terms.every(t => hay.includes(t))
      })
      .slice(0, 60)
  }, [candidates, q, kind])

  return (
    <Modal title={`Add to tier ${tier}`} onClose={onClose}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['all', 'event', 'venue'] as const).map(k => (
          <Btn key={k} small kind={kind === k ? 'primary' : 'ghost'} onClick={() => setKind(k)}>
            {k === 'all' ? 'Everything' : k === 'event' ? 'Events' : 'Venues'}
          </Btn>
        ))}
      </div>
      <TextInput
        autoFocus
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Search events and venues…"
        style={{ marginBottom: 12 }}
      />
      <div style={{ display: 'grid', gap: 6, maxHeight: 380, overflowY: 'auto' }}>
        {list.length === 0 && (
          <p style={{ margin: 0, color: C.faint, fontFamily: font, fontSize: 13 }}>Nothing matches.</p>
        )}
        {list.map(c => (
          <button
            key={`${c.kind}:${c.id}`}
            disabled={c.taken}
            onClick={() => onPick(c)}
            style={{
              textAlign: 'left', background: 'transparent', cursor: c.taken ? 'default' : 'pointer',
              border: `1px solid ${C.line}`, borderRadius: 6, padding: '9px 11px',
              color: C.text, fontFamily: font, fontSize: 13.5,
              opacity: c.taken ? 0.42 : 1,
              display: 'flex', alignItems: 'center', gap: 10,
            }}
          >
            <span style={{ ...caps, fontSize: 9, color: c.kind === 'event' ? C.gold : C.green, width: 44 }}>
              {c.kind === 'event' ? 'Event' : 'Venue'}
            </span>
            <span style={{ flex: 1 }}>{c.title}</span>
            <span style={{ fontFamily: mono, fontSize: 11, color: C.faint }}>
              {c.taken ? 'featured' : [fmtDate(c.night_date), c.subtitle].filter(Boolean).join(' · ')}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
