'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { BrandRow } from '@/lib/partner'
import { Badge, Btn, Card, DayPicker, ErrorLine, TextInput, api, C, caps, font } from '../../_ui'

// A promoter's VIP set-up. Promoters don't price VIP: the club's saved
// Fourvenues tables are the products and the VIP page ranks who sells which.
// This is the promoter's side of that — where and on which nights they do
// VIP, what the guest may pay, and the switch that takes them off every table
// (the next-ranked promoter moves up). The promoter app edits the same record,
// except adding or removing venues, which stays here.

type Payment = 'both' | 'deposit' | 'full'
interface Venue { id: string; club_id: string; club_name: string; valid_days: string; skipped_dates: string[]; paused: boolean }
interface Vip {
  migrated: boolean; vip_paused: boolean; vip_payment: Payment
  checkout: 'fourvenues' | 'fuoco'; fourvenues_channel: string | null; venues: Venue[]
}

const PAYMENT: { id: Payment; label: string }[] = [
  { id: 'both', label: 'Guest chooses' }, { id: 'deposit', label: 'Deposit only' }, { id: 'full', label: 'Full price only' },
]

export default function VipPanel({ brand, tabs }: { brand: BrandRow; tabs: React.ReactNode }) {
  const [vip, setVip] = useState<Vip | null>(null)
  const [venues, setVenues] = useState<Venue[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<{ id: string; name: string }[]>([])

  const load = useCallback(() => {
    api<Vip>(`/api/portal/brands/${brand.id}/vip`)
      .then(v => { setVip(v); setVenues(v.venues) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [brand.id])
  useEffect(load, [load])

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return }
    const t = setTimeout(() => {
      api<{ clubs: { id: string; name: string }[] }>(`/api/portal/clubs/browse?q=${encodeURIComponent(q.trim())}&limit=8`)
        .then(r => setHits(r.clubs.filter(c => !venues.some(v => v.club_id === c.id))))
        .catch(() => setHits([]))
    }, 250)
    return () => clearTimeout(t)
  }, [q, venues])

  async function patch(body: Record<string, unknown>) {
    setBusy(true); setError(null); setSaved(false)
    try {
      const v = await api<Vip>(`/api/portal/brands/${brand.id}/vip`, { method: 'PATCH', body: JSON.stringify(body) })
      setVip(v); setVenues(v.venues); setSaved(true)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save') }
    setBusy(false)
  }
  const saveVenues = () => patch({
    venues: venues.map(v => ({ club_id: v.club_id, valid_days: v.valid_days || 'Every night', skipped_dates: v.skipped_dates, paused: v.paused })),
  })
  const dirty = !!vip && JSON.stringify(venues) !== JSON.stringify(vip.venues)
  const edit = (clubId: string, change: Partial<Venue>) =>
    setVenues(vs => vs.map(v => v.club_id === clubId ? { ...v, ...change } : v))

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
          <p style={{ fontFamily: font, fontSize: 13.5, color: C.danger }}>
            VIP selling needs the VIP products migration applied in the SQL editor.
          </p>
        )}

        {vip && (
          <>
            <p style={{ margin: '0 0 16px', fontFamily: font, fontSize: 13.5, color: C.dim, lineHeight: 1.55, maxWidth: 680 }}>
              {brand.name} sells the club&rsquo;s saved Fourvenues tables. Nobody types a price here. Their tables check out
              {vip.checkout === 'fourvenues'
                ? <> on <strong style={{ color: C.text, fontWeight: 500 }}>Fourvenues, through their link</strong> ({vip.fourvenues_channel}).</>
                : <> with <strong style={{ color: C.goldHi, fontWeight: 500 }}>Fuoco checkout</strong>. Add a Fourvenues link above to check out on Fourvenues instead.</>}
              {' '}Which tables they sell, and in what order, is set on the <Link href="/portal/tables" style={{ color: C.goldHi }}>VIP page</Link>.
            </p>

            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 20 }}>
              <div>
                <p style={{ ...caps, color: C.gold, margin: '0 0 8px', letterSpacing: '0.12em' }}>VIP</p>
                <Btn small kind={vip.vip_paused ? 'primary' : 'danger'} disabled={busy}
                  onClick={() => patch({ vip_paused: !vip.vip_paused })}>
                  {vip.vip_paused ? 'Turn VIP back on' : 'Shut VIP down'}
                </Btn>
              </div>
              {vip.checkout === 'fuoco' && (
                <div>
                  <p style={{ ...caps, color: C.gold, margin: '0 0 8px', letterSpacing: '0.12em' }}>What the guest pays now</p>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {PAYMENT.map(p => (
                      <Btn key={p.id} small kind={vip.vip_payment === p.id ? 'primary' : 'ghost'} disabled={busy}
                        onClick={() => patch({ vip_payment: p.id })}>{p.label}</Btn>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <p style={{ ...caps, color: C.gold, margin: '0 0 8px', letterSpacing: '0.12em' }}>Where and when they do VIP</p>
            {vip.checkout === 'fourvenues' && (
              <p style={{ margin: '0 0 10px', fontFamily: font, fontSize: 12.5, color: C.faint }}>
                With a Fourvenues link, the nights their link lists are the nights they sell. Venues below only apply
                if the link is removed.
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {venues.map(v => (
                <div key={v.club_id} style={{ border: `1px solid ${v.paused ? `${C.danger}55` : C.line}`, borderRadius: 10, padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <span style={{ fontFamily: font, fontSize: 14, color: C.text }}>{v.club_name}</span>
                    {v.paused && <Badge color={C.danger}>Paused</Badge>}
                    {v.skipped_dates.length > 0 && (
                      <span style={{ fontFamily: font, fontSize: 12, color: C.faint }}>
                        Suspended: {v.skipped_dates.join(', ')}
                      </span>
                    )}
                    <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
                      <Btn small kind="ghost" onClick={() => edit(v.club_id, { paused: !v.paused })}>{v.paused ? 'Resume' : 'Pause'}</Btn>
                      <Btn small kind="ghost" onClick={() => setVenues(vs => vs.filter(x => x.club_id !== v.club_id))}>Remove</Btn>
                    </span>
                  </div>
                  <DayPicker value={v.valid_days} onChange={d => edit(v.club_id, { valid_days: d })} />
                </div>
              ))}
              {venues.length === 0 && (
                <p style={{ margin: 0, fontFamily: font, fontSize: 13, color: C.faint }}>Not doing VIP at any venue yet.</p>
              )}
            </div>

            <div style={{ marginTop: 12, maxWidth: 360, position: 'relative' }}>
              <TextInput placeholder="Add a venue they do VIP at…" value={q} onChange={e => setQ(e.target.value)} />
              {hits.length > 0 && (
                <div style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, marginTop: 4 }}>
                  {hits.map(c => (
                    <button key={c.id} onClick={() => {
                      setVenues(vs => [...vs, { id: '', club_id: c.id, club_name: c.name, valid_days: 'Every night', skipped_dates: [], paused: false }])
                      setQ(''); setHits([])
                    }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '8px 12px', cursor: 'pointer', fontFamily: font, fontSize: 13.5, color: C.text }}>
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
              <Btn kind="primary" disabled={busy || !dirty} onClick={saveVenues}>{busy ? 'Saving…' : 'Save venues'}</Btn>
              {saved && !dirty && <span style={{ fontFamily: font, fontSize: 13, color: C.green }}>Saved</span>}
            </div>
          </>
        )}
      </Card>
    </section>
  )
}
