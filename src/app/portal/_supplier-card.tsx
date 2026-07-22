'use client'

import Link from 'next/link'
import type { BrandRow } from '@/lib/partner'
import { ActivateButton, HideOffersButton, Badge, Btn, Card, C, caps, font, mono } from './_ui'

/// One supplier row. Extracted so it can be rendered against real brand data
/// outside the password-gated portal.
export function SupplierCard({ b, live, onDone }: {
  b: BrandRow
  live: BrandRow | null
  onDone: () => void
}) {
  return (
    <Card style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 0 }}>
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
                {/* Two independent facts, so two chips. Live/hidden is the
                    supplier's actual on/off state and is shown on EVERY card —
                    collapsing it into a single "Featured" chip hid that the
                    featured supplier is also just live, and made it look like
                    only one supplier could be on at a time. */}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Badge color={b.offers_hidden ? C.danger : C.green}>
                    {b.offers_hidden ? 'Hidden' : 'Live'}
                  </Badge>
                  {b.is_active && <Badge color={C.gold}>Featured</Badge>}
                </div>
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
  
              <div style={{ display: 'flex', gap: 10, marginTop: 'auto', flexWrap: 'wrap' }}>
                <Link href={`/portal/brands/${b.id}`} style={{ textDecoration: 'none', flex: 1, display: 'flex' }}>
                  <Btn wide>Edit</Btn>
                </Link>
                {/* The on/off switch, on the card rather than buried in Edit. */}
                <span style={{ flex: 1, display: 'flex' }}>
                  <HideOffersButton brand={b} onDone={onDone} wide />
                </span>
                {!b.is_active && (
                  <span style={{ flex: '1 1 100%', display: 'flex' }}>
                    <ActivateButton brand={b} onDone={onDone} wide currentLive={live?.name ?? null} />
                  </span>
                )}
              </div>
            </Card>
  )
}
