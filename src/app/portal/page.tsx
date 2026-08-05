'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { BrandRow } from '@/lib/partner'
import type { PromoterRow } from '@/app/api/portal/promoters/route'
import { ErrorLine, StatTile, api, C, caps, font, serif } from './_ui'
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
          <p style={{ ...caps, color: C.gold, margin: '0 0 12px', letterSpacing: '0.14em' }}>Roster</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {roster.map(row => (
              <PromoterCard key={row.id} row={row} live={live} actions={actions} onReload={load} />
            ))}

            {/* Onboard a new promoter — seeds their brand/list. */}
            <button onClick={() => router.push('/portal/brands/new')} className="cfp-hover-lift" style={{
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
            </button>
          </div>
        </>
      )}
    </>
  )
}
