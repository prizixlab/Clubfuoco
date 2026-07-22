'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { BrandRow } from '@/lib/partner'
import { ActivateButton, HideOffersButton, Badge, Btn, Card, ErrorLine, StatTile, api, C, caps, font, mono, serif } from './_ui'
import { PromoterApprovals } from './_promoters'
import { SupplierCard } from './_supplier-card'

// Partners — the suppliers/lists (offer providers) up top, then the promoter
// accounts below. Both are the same kind of external partner.
// Suppliers are offer providers, not the face of the app: Club Fuoco stays
// the brand, these rows decide whose offers fill the front-page shelf.
export default function BrandsPage() {
  const router = useRouter()
  const [brands, setBrands] = useState<BrandRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api<BrandRow[]>('/api/portal/brands')
      .then(setBrands)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [])
  useEffect(load, [load])

  const live = brands?.find(b => b.is_active) ?? null

  return (
    <>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontFamily: serif, fontSize: 34, fontWeight: 400, color: C.text }}>Partners</h1>
        <p style={{ margin: '8px 0 0', fontSize: 14, color: C.dim, fontFamily: font, lineHeight: 1.5 }}>
          Suppliers &amp; promoters. Every supplier marked <strong style={{ color: C.green, fontWeight: 500 }}>Live</strong> is
          showing right now — as many at once as you like. Hide offers turns one off; Conflicts decides who runs a venue
          two suppliers share. <strong style={{ color: C.goldHi, fontWeight: 500 }}>Featured</strong> is not an on switch:
          it only names the one supplier that app versions too old to read per-offer branding fall back to.
          Promoter access is approved below.
        </p>
      </div>

      <h2 style={{ margin: '0 0 16px', fontFamily: serif, fontSize: 26, fontWeight: 400, color: C.text }}>Suppliers</h2>

      {/* Real numbers only — no fictional network metrics. */}
      {brands && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 28 }}>
          <StatTile label="Total suppliers" value={brands.length} />
          <StatTile label="Featured" value={live?.name ?? 'None'} />
          {/* Every supplier's offers are live, so count them all — showing only
              the featured brand's hid the rest of the catalogue. */}
          <StatTile label="Live offers" value={brands.reduce((n, b) => n + (b.offer_count ?? 0), 0)} />
        </div>
      )}

      <ErrorLine error={error} />
      {!brands && !error && <p style={{ color: C.dim, fontFamily: font, fontSize: 14 }}>Loading…</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        {brands?.map(b => (
          <SupplierCard key={b.id} b={b} live={live} onDone={load} />
        ))}

        {/* Onboard a new supplier — the dashed invitation card. */}
        {brands && (
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
            <span style={{ ...caps, color: C.dim, letterSpacing: '0.14em' }}>Onboard new supplier</span>
          </button>
        )}
      </div>

      <PromoterApprovals />
    </>
  )
}
