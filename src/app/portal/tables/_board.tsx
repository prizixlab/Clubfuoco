'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge, Btn, Card, ErrorLine, SectionLabel, TextInput, api, C, caps, font, mono, serif } from '../_ui'

// VIP products: the tables saved from Fourvenues, one product each.
//
// Promoters don't own VIP products; they sell these, in the order set here.
// On every night the highest-ranked promoter who is selling gets the buy
// button — if they suspend a night or shut down VIP in the promoter app, the
// next one moves up on its own. Nobody ranked selling → the Fourvenues listing,
// as before. Checkout follows the seller: Fourvenues link, or Fuoco checkout.
//
// Shared by /portal/tables and the "New app versions" panel of Conflicts.

type Checkout = 'fourvenues' | 'fuoco'
interface Candidate {
  id: string; name: string; color: string; checkout: Checkout
  fourvenues_only: boolean; vip_paused: boolean; venue_paused: boolean
}
interface Product {
  id: string | null; zone_key: string; name: string
  price_from: number | null; price_to: number | null; nights_on_sale: number
  sellers: string[]
  by_night: { night: string; seller: { name: string; checkout: Checkout; ranked: boolean } | null }[]
}
interface Club { club_id: string; club_name: string; nights: string[]; candidates: Candidate[]; products: Product[] }
interface Payload { migrated: boolean; catalog: boolean; clubs: Club[] }

const euros = (n: number | null) => n == null ? '—' : `€${Number.isInteger(n) ? n : n.toFixed(2)}`
const range = (a: number | null, b: number | null) => a == null ? '—' : a === b ? euros(a) : `${euros(a)}–${euros(b)}`
const CHECKOUT_LABEL: Record<Checkout, string> = { fourvenues: 'Fourvenues link', fuoco: 'Fuoco checkout' }
const nightLabel = (n: string) => {
  const d = new Date(`${n}T12:00:00`)
  return { wd: d.toLocaleDateString('en-GB', { weekday: 'short' }), day: d.getDate() }
}

export function TablesBoard({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')

  const load = useCallback(() => {
    api<Payload>('/api/portal/vip')
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [])
  useEffect(load, [load])

  const clubs = useMemo(() => (data?.clubs ?? [])
    .filter(c => !q || c.club_name.toLowerCase().includes(q.toLowerCase())), [data, q])

  return (
    <>
      {!compact && (
        <h1 style={{ margin: 0, fontFamily: serif, fontSize: 30, fontWeight: 400, color: C.text }}>
          VIP <em style={{ fontStyle: 'italic', color: C.goldHi }}>products</em>
        </h1>
      )}
      <p style={{ margin: compact ? '0 0 18px' : '8px 0 18px', fontSize: 14, color: C.dim, fontFamily: font, maxWidth: 700, lineHeight: 1.55 }}>
        Every table saved from Fourvenues is a product. Rank the promoters who sell each one: on every night
        the <strong style={{ color: C.goldHi, fontWeight: 500 }}>highest-ranked promoter who is selling</strong> gets
        the buy button. If they suspend a night or shut VIP down, the next one moves up on their own. If no ranked
        promoter is selling, the table stays on its Fourvenues listing. A promoter with a Fourvenues link
        sells through it; anyone else sells with Fuoco checkout.
      </p>

      {data && !data.migrated && (
        <Card style={{ borderColor: `${C.danger}66`, marginBottom: 16 }}>
          <p style={{ margin: 0, fontFamily: font, fontSize: 13.5, color: C.danger, lineHeight: 1.5 }}>
            Ranking needs the VIP products migration applied in the SQL editor. Until then every table stays
            on its Fourvenues listing.
          </p>
        </Card>
      )}
      {data && !data.catalog && (
        <p style={{ fontFamily: font, fontSize: 13, color: C.danger }}>The Fourvenues catalog couldn’t be read just now.</p>
      )}

      <div style={{ maxWidth: 360, marginBottom: 18 }}>
        <TextInput placeholder="Search venues" value={q} onChange={e => setQ(e.target.value)} />
      </div>

      <ErrorLine error={error} />
      {!data && !error && <p style={{ color: C.dim, fontFamily: font, fontSize: 14 }}>Loading…</p>}
      {data && clubs.length === 0 && (
        <Card><p style={{ margin: 0, fontSize: 14, color: C.dim, fontFamily: font }}>No saved tables match.</p></Card>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {clubs.map(c => <ClubCard key={c.club_id} club={c} canRank={!!data?.migrated} onSaved={load} />)}
      </div>
    </>
  )
}

function ClubCard({ club, canRank, onSaved }: { club: Club; canRank: boolean; onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [allOrder, setAllOrder] = useState<string[] | null>(null)
  const ranked = club.products.filter(p => p.sellers.length).length

  async function put(path: string, brand_ids: string[]) {
    setBusy(true); setError(null)
    try {
      await api(path, { method: 'PUT', body: JSON.stringify({ brand_ids }) })
      onSaved()
      return true
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); return false }
    finally { setBusy(false) }
  }

  return (
    <Card>
      <SectionLabel right={
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <Badge color={C.dim}>{club.products.length} table{club.products.length === 1 ? '' : 's'}</Badge>
          {ranked > 0 && <Badge color={C.goldHi}>{ranked} ranked</Badge>}
        </span>
      }>
        {club.club_name}
      </SectionLabel>

      {canRank && (
        <div style={{ marginBottom: 12 }}>
          {allOrder === null ? (
            <Btn small kind="ghost" onClick={() => setAllOrder([])}>Set one order for every table here</Btn>
          ) : (
            <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: 12 }}>
              <p style={{ ...caps, color: C.gold, margin: '0 0 8px', letterSpacing: '0.12em' }}>Every table at {club.club_name}</p>
              <RankEditor club={club} value={allOrder} onChange={setAllOrder} />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <Btn small kind="primary" disabled={busy}
                  onClick={async () => { if (await put(`/api/portal/vip/clubs/${club.club_id}`, allOrder)) setAllOrder(null) }}>
                  {busy ? 'Saving…' : `Apply to all ${club.products.length}`}
                </Btn>
                <Btn small kind="ghost" onClick={() => setAllOrder(null)}>Cancel</Btn>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {club.products.map(p => (
          <ProductRow key={p.zone_key} club={club} product={p} canRank={canRank && !!p.id} busy={busy}
            onSave={ids => put(`/api/portal/vip/products/${p.id}`, ids)} />
        ))}
      </div>
      <ErrorLine error={error} />
    </Card>
  )
}

function ProductRow({ club, product, canRank, busy, onSave }: {
  club: Club; product: Product; canRank: boolean; busy: boolean; onSave: (ids: string[]) => Promise<boolean>
}) {
  const [editing, setEditing] = useState<string[] | null>(null)
  const byId = new Map(club.candidates.map(c => [c.id, c]))
  const names = product.sellers.map(id => byId.get(id)?.name).filter(Boolean)

  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: font, fontSize: 14, color: C.text }}>{product.name}</span>
        <span style={{ fontFamily: mono, fontSize: 12.5, color: C.goldHi }}>{range(product.price_from, product.price_to)}</span>
        <span style={{ fontFamily: font, fontSize: 12, color: C.faint }}>
          {product.nights_on_sale} night{product.nights_on_sale === 1 ? '' : 's'} on sale
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: font, fontSize: 12.5, color: names.length ? C.dim : C.faint }}>
          {names.length ? names.map((n, i) => `${i + 1}. ${n}`).join('  ') : 'No ranking: Fourvenues listing'}
        </span>
        {canRank && editing === null && (
          <Btn small kind="ghost" onClick={() => setEditing(product.sellers)}>Rank sellers</Btn>
        )}
      </div>

      <NightStrip product={product} />

      {editing !== null && (
        <div style={{ marginTop: 10, borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
          <RankEditor club={club} value={editing} onChange={setEditing} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <Btn small kind="primary" disabled={busy}
              onClick={async () => { if (await onSave(editing)) setEditing(null) }}>{busy ? 'Saving…' : 'Save order'}</Btn>
            <Btn small kind="ghost" onClick={() => setEditing(null)}>Cancel</Btn>
          </div>
        </div>
      )}
    </div>
  )
}

/** Who holds the buy button on each upcoming night. */
function NightStrip({ product }: { product: Product }) {
  return (
    <div style={{ display: 'flex', gap: 4, marginTop: 8, overflowX: 'auto' }}>
      {product.by_night.map(({ night, seller }) => {
        const { wd, day } = nightLabel(night)
        return (
          <div key={night} title={seller
            ? `${night}: ${seller.name} · ${CHECKOUT_LABEL[seller.checkout]}${seller.ranked ? '' : ' (no ranked seller tonight)'}`
            : `${night}: not on sale`}
            style={{
              minWidth: 74, padding: '5px 7px', borderRadius: 7,
              border: `1px solid ${seller?.ranked ? `${C.gold}55` : C.line}`,
              background: seller ? 'transparent' : 'rgba(255,255,255,0.02)',
            }}>
            <div style={{ ...caps, fontSize: 9.5, color: C.faint }}>{wd} {day}</div>
            <div style={{
              fontFamily: font, fontSize: 11.5, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              color: !seller ? C.faint : seller.ranked ? C.text : C.dim,
            }}>
              {seller ? seller.name : '—'}
            </div>
            {seller && (
              <div style={{ fontFamily: font, fontSize: 9.5, color: seller.checkout === 'fuoco' ? C.goldHi : C.faint }}>
                {seller.checkout === 'fuoco' ? 'Fuoco' : 'Fourvenues'}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** An ordered list of promoters: add, move up/down, remove. */
function RankEditor({ club, value, onChange }: { club: Club; value: string[]; onChange: (v: string[]) => void }) {
  const byId = new Map(club.candidates.map(c => [c.id, c]))
  const rest = club.candidates.filter(c => !value.includes(c.id))
  const move = (i: number, d: number) => {
    const next = [...value]
    const j = i + d
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {value.map((id, i) => {
        const c = byId.get(id)
        const warn = !c ? 'promoter removed'
          : c.vip_paused ? 'VIP shut down'
          : c.venue_paused ? 'paused at this club'
          : c.fourvenues_only ? 'Fourvenues-only, and their link doesn’t list this club' : null
        return (
          <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', border: `1px solid ${C.line}`, borderRadius: 8 }}>
            <span style={{ fontFamily: mono, fontSize: 12, color: C.gold, width: 18 }}>{i + 1}</span>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: c?.color ?? C.faint }} />
            <span style={{ fontFamily: font, fontSize: 13.5, color: C.text }}>{c?.name ?? 'Unknown'}</span>
            {c && <span style={{ fontFamily: font, fontSize: 11.5, color: c.checkout === 'fuoco' ? C.goldHi : C.faint }}>{CHECKOUT_LABEL[c.checkout]}</span>}
            {warn && <Badge color={C.danger}>{warn}</Badge>}
            <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }}>
              <Btn small kind="ghost" disabled={i === 0} onClick={() => move(i, -1)}>↑</Btn>
              <Btn small kind="ghost" disabled={i === value.length - 1} onClick={() => move(i, 1)}>↓</Btn>
              <Btn small kind="ghost" onClick={() => onChange(value.filter(x => x !== id))}>Remove</Btn>
            </span>
          </div>
        )
      })}
      {value.length === 0 && (
        <p style={{ margin: 0, fontFamily: font, fontSize: 12.5, color: C.faint }}>
          No sellers ranked: the table stays on its Fourvenues listing.
        </p>
      )}
      {rest.length > 0 && (
        <select value="" onChange={e => { if (e.target.value) onChange([...value, e.target.value]) }} style={{
          alignSelf: 'flex-start', background: C.card, color: C.dim, border: `1px solid ${C.line}`, borderRadius: 8,
          fontFamily: font, fontSize: 12.5, padding: '6px 8px', cursor: 'pointer',
        }}>
          <option value="">Add a seller…</option>
          {rest.map(c => (
            <option key={c.id} value={c.id}>
              {c.name} · {CHECKOUT_LABEL[c.checkout]}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
