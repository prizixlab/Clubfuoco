'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { BrandRow } from '@/lib/partner'
import type { PromoterRow } from '@/app/api/portal/promoters/route'
import { Btn, ErrorLine, StatTile, api, C, caps, font, serif } from './_ui'
import { PromoterCard, PendingPromoterCard, usePromoterActions } from './_promoter-card'

// Promoters — one roster. A promoter and their "list" are the same thing: a
// partner_brand owned by a promoter account. This page folds together access
// (who can use the FuocoPromoters app) and brand management (whose offers fill
// the front-page shelf). Club Fuoco stays the face of the app; these rows just
// decide whose offers show and who's on the door list.
export default function PromotersPage() {
  const router = useRouter()
  const [pending, setPending] = useState<PromoterRow[] | null>(null)
  const [roster, setRoster] = useState<PromoterRow[]>([])
  const [error, setError] = useState<string | null>(null)
  // Reorder mode: cards become draggable and actions are suppressed, so a drag
  // can't land on Revoke.
  const [editingOrder, setEditingOrder] = useState(false)
  // Ref, not just state: dragover can fire before React re-renders after
  // dragstart, and a state-only read would see a stale null and drop the move.
  // The state copy exists purely to drive the drag styling.
  const dragIdRef = useRef<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [savingOrder, setSavingOrder] = useState(false)

  const load = useCallback(() => {
    api<{ pending: PromoterRow[]; roster: PromoterRow[] }>('/api/portal/promoters')
      .then(r => { setPending(r.pending); setRoster(r.roster) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [])
  useEffect(load, [load])

  const actions = usePromoterActions(load)

  const brands = roster.map(r => r.brand).filter((b): b is BrandRow => !!b)
  const live = brands.find(b => b.is_active) ?? null
  const liveOffers = brands.reduce((n, b) => n + (b.offer_count ?? 0), 0)

  /// Move the dragged card to the slot it's hovering, live — the list itself is
  /// the preview, so there's no separate "arrange" surface to reconcile.
  function reorder(overId: string) {
    const from0 = dragIdRef.current
    if (!from0 || from0 === overId) return
    setRoster(prev => {
      const from = prev.findIndex(r => r.id === from0)
      const to = prev.findIndex(r => r.id === overId)
      if (from < 0 || to < 0) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  async function saveOrder() {
    setSavingOrder(true); setError(null)
    try {
      await api('/api/portal/roster-order', {
        method: 'PUT',
        body: JSON.stringify({ order: roster.map(r => r.id) }),
      })
      setEditingOrder(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the order.')
    }
    setSavingOrder(false)
  }

  return (
    <>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontFamily: serif, fontSize: 34, fontWeight: 400, color: C.text }}>Promoters</h1>
        <p style={{ margin: '8px 0 0', fontSize: 14, color: C.dim, fontFamily: font, lineHeight: 1.5 }}>
          Every promoter and their list. A promoter marked <strong style={{ color: C.green, fontWeight: 500 }}>Live</strong> is
          showing offers right now — as many at once as you like. Hide offers turns one off; Conflicts decides who runs a venue
          two promoters share. <strong style={{ color: C.goldHi, fontWeight: 500 }}>Featured</strong> is not an on switch:
          it only names the one promoter that app versions too old to read per-offer branding fall back to.
          App access is granted per promoter below.
        </p>
      </div>

      {pending && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 28 }}>
          <StatTile label="Total promoters" value={roster.length + pending.length} />
          <StatTile label="Featured" value={live?.name ?? 'None'} />
          <StatTile label="Live offers" value={liveOffers} />
        </div>
      )}

      <ErrorLine error={error || actions.error} />
      {!pending && !error && <p style={{ color: C.dim, fontFamily: font, fontSize: 14 }}>Loading…</p>}

      {/* Awaiting approval — the IG-verification + grant-access queue. */}
      {pending && pending.length > 0 && (
        <>
          <p style={{ ...caps, color: C.gold, margin: '0 0 12px', letterSpacing: '0.14em' }}>
            Awaiting approval · {pending.length}
          </p>
          <div style={{ display: 'grid', gap: 12, marginBottom: 34 }}>
            {pending.map(row => (
              <PendingPromoterCard key={row.id} row={row} actions={actions} />
            ))}
          </div>
        </>
      )}

      {/* Roster — every promoter's brand + access, plus the onboard card. */}
      {pending && (
        <>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12, margin: '0 0 12px',
          }}>
            <p style={{ ...caps, color: C.gold, margin: 0, letterSpacing: '0.14em' }}>Roster</p>
            {editingOrder ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn small onClick={() => { setEditingOrder(false); load() }} disabled={savingOrder}>
                  Cancel
                </Btn>
                <Btn small kind="primary" onClick={saveOrder} disabled={savingOrder}>
                  {savingOrder ? 'Saving…' : 'Save order'}
                </Btn>
              </div>
            ) : (
              <Btn small onClick={() => setEditingOrder(true)}>Edit order</Btn>
            )}
          </div>
          {editingOrder && (
            <p style={{ color: C.dim, fontSize: 12.5, margin: '0 0 12px', fontFamily: font }}>
              Drag the cards into the order you want, then save. This order is shared
              by everyone using the portal.
            </p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {roster.map(row => (
              <div
                key={row.id}
                draggable={editingOrder}
                onDragStart={() => { dragIdRef.current = row.id; setDragId(row.id) }}
                onDragEnd={() => { dragIdRef.current = null; setDragId(null) }}
                onDragOver={e => { if (editingOrder) { e.preventDefault(); reorder(row.id) } }}
                style={editingOrder ? {
                  cursor: 'grab',
                  opacity: dragId === row.id ? 0.45 : 1,
                  outline: `1px dashed ${dragId === row.id ? C.gold : 'rgba(255,255,255,0.16)'}`,
                  outlineOffset: 3, borderRadius: 10,
                  // Suppress clicks so a drag can't trigger Revoke / Make featured.
                  pointerEvents: 'auto',
                } : undefined}
              >
                <div style={editingOrder ? { pointerEvents: 'none' } : undefined}>
                  <PromoterCard row={row} live={live} actions={actions} onReload={load} />
                </div>
              </div>
            ))}

            {/* Onboard a new promoter — seeds their brand/list. Hidden while
                reordering: it isn't a roster entry and can't hold a position. */}
            {!editingOrder && <button onClick={() => router.push('/portal/brands/new')} className="cfp-hover-lift" style={{
              background: 'transparent', border: `1px dashed rgba(255,255,255,0.18)`, borderRadius: 8,
              minHeight: 210, cursor: 'pointer', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 14, padding: 20,
            }}>
              <span style={{
                width: 44, height: 44, borderRadius: 8, background: 'rgba(192,153,80,0.1)',
                border: '1px solid rgba(192,153,80,0.3)', color: C.goldHi, fontSize: 22,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: font,
              }} aria-hidden>+</span>
              <span style={{ ...caps, color: C.dim, letterSpacing: '0.14em' }}>Onboard new promoter</span>
            </button>}
          </div>
        </>
      )}
    </>
  )
}
