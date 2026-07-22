'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { BrandRow } from '@/lib/partner'
import { ActivateButton, Badge, Btn, Card, ErrorLine, StatTile, api, C, caps, font, mono, serif } from './_ui'
import { PromoterApprovals } from './_promoters'

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
          Suppliers &amp; promoters. Every supplier&rsquo;s offers are live at once — to stop one showing,
          use its hide switch in Edit, or pick who runs a shared venue under Conflicts. &ldquo;Featured&rdquo;
          only names the single supplier older app versions fall back to. Promoter access is approved below.
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
          <Card key={b.id} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              {/* Logo tile */}
              <div style={{
                width: 86, height: 46, borderRadius: 6, background: 'rgba(0,0,0,0.4)',
                border: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', flexShrink: 0,
              }}>
                {b.logo_url
                  ? <img src={b.logo_url} alt={b.name} style={{ maxWidth: '80%', maxHeight: '70%', objectFit: 'contain' }} />
                  : <span style={{ ...caps, fontSize: 9, color: C.faint }}>No logo</span>}
              </div>
              {/* Not Active/Inactive — that read as an on/off switch for the
                  supplier, when an unfeatured supplier's offers are just as live. */}
              <Badge color={b.is_active ? C.gold : C.faint}>
                {b.is_active ? 'Featured' : b.offers_hidden ? 'Hidden' : 'Live'}
              </Badge>
            </div>

            <p style={{ margin: '16px 0 0', fontSize: 16.5, fontWeight: 700, fontFamily: font, color: C.text }}>{b.name}</p>
            <p style={{ margin: '4px 0 0', fontFamily: mono, fontSize: 12, color: C.dim }}>/{b.key}</p>

            <div style={{ display: 'flex', gap: 28, margin: '16px 0 18px' }}>
              <div>
                <p style={{ ...caps, fontSize: 10, color: C.faint, margin: '0 0 7px' }}>Accent</p>
                <span style={{
                  display: 'inline-block', width: 34, height: 17, borderRadius: 3,
                  background: b.color, border: `1px solid ${C.line}`,
                }} title={b.color} />
              </div>
              <div>
                <p style={{ ...caps, fontSize: 10, color: C.faint, margin: '0 0 7px' }}>Offers</p>
                <p style={{ margin: 0, fontFamily: font, fontSize: 14, fontWeight: 600, color: C.text }}>
                  {b.offer_count} <span style={{ color: C.dim, fontWeight: 400 }}>live</span>
                </p>
              </div>
              {b.attribution_required && (
                <div>
                  <p style={{ ...caps, fontSize: 10, color: C.faint, margin: '0 0 7px' }}>Credit</p>
                  <p style={{ margin: 0, fontFamily: font, fontSize: 14, color: C.goldHi }}>Required</p>
                </div>
              )}
            </div>

            <div style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <p style={{ ...caps, fontSize: 10, color: C.faint, margin: 0 }}>Login</p>
              {b.login_email
                ? <span style={{ fontFamily: mono, fontSize: 12, color: C.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={b.login_email}>{b.login_email}</span>
                : <span style={{ fontSize: 12, color: C.faint, fontFamily: font, fontStyle: 'italic' }}>not set</span>}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 'auto' }}>
              <Link href={`/portal/brands/${b.id}`} style={{ textDecoration: 'none', flex: 1, display: 'flex' }}>
                <Btn wide>Edit</Btn>
              </Link>
              {!b.is_active && (
                <span style={{ flex: 1, display: 'flex' }}>
                  <ActivateButton brand={b} onDone={load} wide currentLive={live?.name ?? null} />
                </span>
              )}
            </div>
          </Card>
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
