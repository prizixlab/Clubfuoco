'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { BrandRow } from '@/lib/partner'
import { ActivateButton, Badge, Btn, Card, ErrorLine, api, C, font, mono } from './_ui'

// Brands list — every offer supplier as a card; the live one wears the Active
// badge. Suppliers are offer providers, not the face of the app: Club Fuoco
// stays the brand, these rows decide whose offers fill the front-page shelf.
export default function BrandsPage() {
  const [brands, setBrands] = useState<BrandRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api<BrandRow[]>('/api/portal/brands')
      .then(setBrands)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [])
  useEffect(load, [load])

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, fontFamily: font }}>Suppliers</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: C.dim, fontFamily: font }}>
            The active supplier&rsquo;s offers fill the front-page guestlist shelf — web and app, live.
          </p>
        </div>
        <Link href="/portal/brands/new" style={{ textDecoration: 'none' }}>
          <Btn kind="primary">New brand</Btn>
        </Link>
      </div>

      <ErrorLine error={error} />
      {!brands && !error && <p style={{ color: C.dim, fontFamily: font, fontSize: 14 }}>Loading…</p>}
      {brands?.length === 0 && (
        <Card><p style={{ margin: 0, color: C.dim, fontFamily: font, fontSize: 14 }}>No brands yet — create the first one.</p></Card>
      )}

      <div style={{ display: 'grid', gap: 14 }}>
        {brands?.map(b => (
          <Card key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            {/* Logo thumb */}
            <div style={{
              width: 92, height: 48, borderRadius: 10, background: 'rgba(255,255,255,0.05)',
              border: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', flexShrink: 0,
            }}>
              {b.logo_url
                ? <img src={b.logo_url} alt={b.name} style={{ maxWidth: '80%', maxHeight: '70%', objectFit: 'contain' }} />
                : <span style={{ fontSize: 11, color: C.faint, fontFamily: font }}>no logo</span>}
            </div>

            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16, fontWeight: 700, fontFamily: font }}>{b.name}</span>
                {b.is_active && <Badge color={C.green}>Active</Badge>}
                {b.attribution_required && <Badge>Credit required</Badge>}
              </div>
              <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: C.dim, fontFamily: font }}>
                <span style={{ fontFamily: mono }}>{b.key}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 11, height: 11, borderRadius: 3, background: b.color, border: `1px solid ${C.line}`, display: 'inline-block' }} />
                  <span style={{ fontFamily: mono }}>{b.color}</span>
                </span>
                <span>{b.offer_count} live offer{b.offer_count === 1 ? '' : 's'}</span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Link href={`/portal/brands/${b.id}`} style={{ textDecoration: 'none' }}>
                <Btn>Edit</Btn>
              </Link>
              <ActivateButton brand={b} onDone={load} />
            </div>
          </Card>
        ))}
      </div>
    </>
  )
}
