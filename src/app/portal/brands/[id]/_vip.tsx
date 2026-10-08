'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { BrandRow } from '@/lib/partner'
import { Badge, Btn, Card, ErrorLine, api, C, caps, font } from '../../_ui'

// A promoter's VIP controls. There's no set-up: a promoter sells every saved
// table they're ranked on (the VIP page), on every night it's on sale, until
// they step back. This is where they step back — VIP off, a club paused, or a
// single night suspended — and set what the guest pays now. The next-ranked
// promoter takes over automatically. The promoter app edits the same record.

type Payment = 'both' | 'deposit' | 'full'
interface Club {
  club_id: string; club_name: string; ranked_tables: number
  nights: string[]; skipped_dates: string[]; paused: boolean
}
interface Vip {
  migrated: boolean; vip_paused: boolean; vip_payment: Payment
  checkout: 'fourvenues' | 'fuoco'; fourvenues_channel: string | null; venues: Club[]
}

const PAYMENT: { id: Payment; label: string }[] = [
  { id: 'both', label: 'Guest chooses' }, { id: 'deposit', label: 'Deposit only' }, { id: 'full', label: 'Full price only' },
]
const nightLabel = (n: string) =>
  new Date(`${n}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

export default function VipPanel({ brand, tabs }: { brand: BrandRow; tabs: React.ReactNode }) {
  const [vip, setVip] = useState<Vip | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api<Vip>(`/api/portal/brands/${brand.id}/vip`)
      .then(setVip)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [brand.id])
  useEffect(load, [load])

  async function patch(body: Record<string, unknown>) {
    setBusy(true); setError(null)
    try {
      setVip(await api<Vip>(`/api/portal/brands/${brand.id}/vip`, { method: 'PATCH', body: JSON.stringify(body) }))
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save') }
    setBusy(false)
  }

  return (
    <section style={{ marginTop: 32 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
          {tabs}
          {vip && (vip.vip_paused
            ? <Badge color={C.danger}>VIP shut down</Badge>
            : <Badge color={C.green}>Selling VIP</Badge>)}
        </div>

        <ErrorLine error={error} />
        {!vip && !error && <p style={{ color: C.dim, fontFamily: font, fontSize: 14 }}>Loading…</p>}
        {vip && !vip.migrated && (
          <p style={{ fontFamily: font, fontSize: 13.5, color: C.danger }}>VIP selling needs the VIP products migration applied.</p>
        )}

        {vip && (
          <>
            <p style={{ margin: '0 0 16px', fontFamily: font, fontSize: 13.5, color: C.dim, lineHeight: 1.55, maxWidth: 680 }}>
              {brand.name} sells every table they&rsquo;re ranked on, using the table&rsquo;s own price, on every night it&rsquo;s
              on sale. Rank them on the <Link href="/portal/tables" style={{ color: C.goldHi }}>VIP page</Link>. Their sales
              check out {vip.fourvenues_channel
                ? <>on Fourvenues through their link ({vip.fourvenues_channel}) when it lists the table, otherwise with Fuoco.</>
                : <>with Fuoco and are recorded in our system.</>}
            </p>

            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 20 }}>
              <div>
                <p style={{ ...caps, color: C.gold, margin: '0 0 8px', letterSpacing: '0.12em' }}>VIP</p>
                <Btn small kind={vip.vip_paused ? 'primary' : 'danger'} disabled={busy}
                  onClick={() => patch({ vip_paused: !vip.vip_paused })}>
                  {vip.vip_paused ? 'Turn VIP back on' : 'Shut VIP down'}
                </Btn>
              </div>
              <div>
                <p style={{ ...caps, color: C.gold, margin: '0 0 8px', letterSpacing: '0.12em' }}>What the guest pays now (Fuoco checkout)</p>
                <div style={{ display: 'flex', gap: 6 }}>
                  {PAYMENT.map(p => (
                    <Btn key={p.id} small kind={vip.vip_payment === p.id ? 'primary' : 'ghost'} disabled={busy}
                      onClick={() => patch({ vip_payment: p.id })}>{p.label}</Btn>
                  ))}
                </div>
              </div>
            </div>

            <p style={{ ...caps, color: C.gold, margin: '0 0 8px', letterSpacing: '0.12em' }}>Clubs they sell at</p>
            {vip.venues.length === 0 && (
              <p style={{ margin: 0, fontFamily: font, fontSize: 13, color: C.faint }}>
                Not ranked on any table yet. Add them on the <Link href="/portal/tables" style={{ color: C.goldHi }}>VIP page</Link>.
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {vip.venues.map(v => (
                <div key={v.club_id} style={{ border: `1px solid ${v.paused ? `${C.danger}55` : C.line}`, borderRadius: 10, padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <span style={{ fontFamily: font, fontSize: 14, color: C.text }}>{v.club_name}</span>
                    <span style={{ fontFamily: font, fontSize: 12, color: C.faint }}>
                      ranked on {v.ranked_tables} table{v.ranked_tables === 1 ? '' : 's'}
                    </span>
                    {v.paused && <Badge color={C.danger}>Paused</Badge>}
                    <span style={{ marginLeft: 'auto' }}>
                      <Btn small kind="ghost" disabled={busy}
                        onClick={() => patch({ venues: [{ club_id: v.club_id, paused: !v.paused }] })}>
                        {v.paused ? 'Resume' : 'Pause this club'}
                      </Btn>
                    </span>
                  </div>
                  {!v.paused && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {v.nights.length === 0 && (
                        <span style={{ fontFamily: font, fontSize: 12.5, color: C.faint }}>No nights on sale right now.</span>
                      )}
                      {v.nights.map(n => {
                        const off = v.skipped_dates.includes(n)
                        return (
                          <button key={n} disabled={busy} title={off ? 'Suspended: click to sell again' : 'Click to suspend this night'}
                            onClick={() => patch({ venues: [{
                              club_id: v.club_id,
                              skipped_dates: off ? v.skipped_dates.filter(d => d !== n) : [...v.skipped_dates, n],
                            }] })}
                            style={{
                              fontFamily: font, fontSize: 12.5, padding: '6px 10px', borderRadius: 8, cursor: 'pointer',
                              background: off ? `${C.danger}22` : 'transparent', color: off ? C.danger : C.text,
                              border: `1px solid ${off ? `${C.danger}66` : C.line}`,
                            }}>
                            {nightLabel(n)}{off ? ' · off' : ''}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    </section>
  )
}
