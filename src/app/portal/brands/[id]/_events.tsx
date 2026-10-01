'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BrandRow } from '@/lib/partner'
import type { BrandEvent, FourvenuesProduct, NightBooking } from '@/app/api/portal/brands/[id]/events/route'
import { Badge, Card, ErrorLine, api, C, caps, font, mono } from '../../_ui'

// Events — the promoter's dated nights, deliberately a separate section from
// Offers above. An offer is a standing per-venue product; an event is one
// night. They are stored in different tables (partner_offers vs
// promoter_nights) and mixing them in one list would suggest an editing model
// that does not exist.
//
// Read-only on purpose: editing a night belongs on the Events desk
// (/portal/events), which owns pinning, publishing and the house-event flow.
// This answers "what is this promoter actually running?" without duplicating
// that surface.
export default function EventsPanel({ brand, tabs }: {
  brand: BrandRow
  /** Tab strip rendered in place of this card's own title. */
  tabs?: React.ReactNode
}) {
  const [events, setEvents] = useState<BrandEvent[] | null>(null)
  const [owner, setOwner] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showPast, setShowPast] = useState(false)

  const load = useCallback(() => {
    api<{ events: BrandEvent[]; owner: string | null }>(`/api/portal/brands/${brand.id}/events`)
      .then(r => { setEvents(r.events); setOwner(r.owner) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load events'))
  }, [brand.id])
  useEffect(load, [load])

  const { upcoming, past, byVenue } = useMemo(() => {
    const all = events ?? []
    const up = all.filter(e => !e.past)
    const pa = all.filter(e => e.past).reverse()   // most recent first
    const counts = new Map<string, number>()
    for (const e of up) {
      const k = e.club_name ?? e.location_name ?? 'Unassigned venue'
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return {
      upcoming: up,
      past: pa,
      byVenue: [...counts.entries()].sort((a, b) => b[1] - a[1]),
    }
  }, [events])

  const shown = showPast ? past : upcoming

  return (
    <section style={{ marginTop: 32 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {tabs ?? <span style={{ ...caps, color: C.gold, letterSpacing: '0.14em' }}>Events</span>}
            <span style={{ ...caps, color: C.faint, letterSpacing: '0.1em' }}>
              {events ? `${upcoming.length} upcoming${past.length ? ` · ${past.length} past` : ''}` : '…'}
            </span>
          </div>
          {past.length > 0 && (
            <div style={{ display: 'inline-flex', gap: 6 }}>
              <Tab active={!showPast} onClick={() => setShowPast(false)}>Upcoming</Tab>
              <Tab active={showPast} onClick={() => setShowPast(true)}>Past</Tab>
            </div>
          )}
        </div>

        <p style={{ margin: '-6px 0 16px', fontSize: 12.5, color: C.faint, lineHeight: 1.55, fontFamily: font }}>
          Dated nights this promoter runs — separate from the standing offers above.
          Read-only here; pin, publish and edit on the <a href="/portal/events" style={{ color: C.goldHi }}>Events desk</a>.
        </p>

        <ErrorLine error={error} />

        {!events && !error && <p style={{ color: C.dim, fontFamily: font, fontSize: 14 }}>Loading…</p>}

        {/* No promoter account yet — the only reason events can't be attributed. */}
        {events && !owner && (
          <p style={{ margin: 0, color: C.dim, fontFamily: font, fontSize: 13.5, lineHeight: 1.6 }}>
            No promoter account is linked to this brand yet, so no events can belong to it.
            Set a login email above and grant access — events are attributed to that account.
          </p>
        )}

        {events && owner && events.length === 0 && (
          <p style={{ margin: 0, color: C.dim, fontFamily: font, fontSize: 13.5 }}>
            This promoter hasn’t published any events yet.
          </p>
        )}

        {/* Venue spread — the fastest read on where a promoter actually works. */}
        {byVenue.length > 0 && !showPast && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 16 }}>
            {byVenue.map(([name, n]) => (
              <span key={name} style={{
                fontFamily: font, fontSize: 12, color: C.dim,
                border: `1px solid ${C.line}`, borderRadius: 999, padding: '5px 11px',
              }}>
                {name} <span style={{ color: C.goldHi, fontFamily: mono, fontSize: 11.5 }}>{n}</span>
              </span>
            ))}
          </div>
        )}

        {shown.length > 0 && (
          <div style={{ display: 'grid', gap: 7, maxHeight: 460, overflowY: 'auto' }}>
            {shown.map(e => <EventRow key={e.id} event={e} />)}
          </div>
        )}
      </Card>
    </section>
  )
}

function Tab({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      ...caps, fontSize: 10, letterSpacing: '0.12em', cursor: 'pointer',
      background: active ? 'rgba(192,153,80,0.14)' : 'transparent',
      border: `1px solid ${active ? 'rgba(192,153,80,0.4)' : C.line}`,
      color: active ? C.goldHi : C.dim, borderRadius: 4, padding: '6px 11px',
    }}>
      {children}
    </button>
  )
}

// "2026-10-31" → "Sat 31 Oct". Split manually rather than via Date so the
// local timezone can't roll a calendar day backwards.
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** "23:45:00" → "23:45"; null stays null. */
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null)

const eur = (n: number | null | undefined) =>
  n == null ? '—' : `€${Number.isInteger(n) ? n : n.toFixed(2)}`

/** "Guestlist · Door €15 · Tickets €10–12 · 6 tables from €200" */
/** Can a guest buy it right now? */
const onSale = (p: FourvenuesProduct) =>
  !p.sold_out && !p.unavailable && !(p.sale_starts && new Date(p.sale_starts) > new Date())

function waysIn(products: FourvenuesProduct[]): string {
  const open = products.filter(onSale)
  const of = (k: FourvenuesProduct['settle']) => open.filter(p => p.settle === k)
  const range = (ps: FourvenuesProduct[]) => {
    const v = ps.map(p => p.price ?? 0)
    const lo = Math.min(...v), hi = Math.max(...v)
    return lo === hi ? eur(lo) : `${eur(lo)}–${eur(hi)}`
  }
  const parts: string[] = []
  const free = of('free'), door = of('door'), online = of('online'), table = of('table')
  if (free.length) parts.push(free.length > 1 ? `${free.length} guestlists` : 'Guestlist')
  if (door.length) parts.push(`Door ${range(door)}`)
  if (online.length) parts.push(`Tickets ${range(online)}`)
  if (table.length) {
    const lo = Math.min(...table.flatMap(p => (p.rates?.length ? p.rates.map(r => r.price ?? 0) : [p.price ?? 0])))
    parts.push(`${table.length} ${table.length > 1 ? 'tables' : 'table'} from ${eur(lo)}`)
  }
  if (!parts.length) return 'Nothing on sale'
  return parts.join(' · ')
}

const SETTLE: Record<string, string> = { free: 'Guestlist', door: 'Pay at door', online: 'Ticket', table: 'Table' }

function EventRow({ event: e }: { event: BrandEvent }) {
  const [open, setOpen] = useState(false)
  const times = [hhmm(e.open_time), hhmm(e.close_time)].filter(Boolean).join(' – ')
  const products = e.fourvenues?.products ?? []
  const bookings = e.bookings ?? []
  const expandable = products.length > 0 || bookings.length > 0
  const heads = bookings.reduce((n, b) => n + b.heads, 0)
  // Anything that would stop a guest seeing this night, surfaced rather than
  // left to be discovered on the Events desk.
  const flags: React.ReactNode[] = []
  if (e.review_status !== 'approved') flags.push(<Badge key="r" color={C.gold}>{e.review_status}</Badge>)
  if (!e.is_published) flags.push(<Badge key="p" color={C.faint}>Unpublished</Badge>)
  if (e.visibility !== 'public') flags.push(<Badge key="v" color={C.faint}>{e.visibility}</Badge>)
  if (e.featured) flags.push(<Badge key="f" color={C.goldHi}>Featured</Badge>)
  // Sold out / gone, surfaced on the row — not only inside the detail.
  const listed = products.filter(p => !p.unavailable)
  const soldOut = listed.filter(p => p.sold_out).length
  const gone = products.filter(p => p.unavailable).length
  if (listed.length && soldOut === listed.length) flags.push(<Badge key="so" color={C.danger}>Sold out</Badge>)
  else if (soldOut) flags.push(<Badge key="so" color={C.danger}>{soldOut} sold out</Badge>)
  if (gone) flags.push(<Badge key="na" color={C.faint}>{gone} no longer on sale</Badge>)
  if (bookings.length) flags.push(<Badge key="b" color={C.green}>{bookings.length} booked · {heads} {heads === 1 ? 'guest' : 'guests'}</Badge>)

  return (
    <div style={{
      background: C.card, border: `1px solid ${open ? C.lineHi : C.line}`, borderRadius: 8,
      opacity: e.past ? 0.55 : 1,
    }}>
    <div
      onClick={expandable ? () => setOpen(o => !o) : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 13, padding: '10px 13px',
        cursor: expandable ? 'pointer' : 'default',
      }}>
      <span style={{
        fontFamily: mono, fontSize: 11.5, color: C.goldHi, flexShrink: 0,
        width: 78, letterSpacing: '0.02em',
      }}>
        {formatDate(e.night_date)}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 13.5, fontWeight: 600, fontFamily: font, color: C.text,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%',
          }}>
            {e.title || 'Untitled night'}
          </span>
          {flags}
        </div>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: C.dim, fontFamily: font, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {e.club_name ?? e.location_name ?? 'No venue'}{times ? ` · ${times}` : ''}
        </p>
        {e.fourvenues && (
          <p style={{ margin: '3px 0 0', fontSize: 11.5, color: C.faint, fontFamily: font, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {waysIn(products)} <span style={{ opacity: 0.7 }}>· via Fourvenues</span>
          </p>
        )}
      </div>

      {e.fourvenues ? (
        <span style={{ fontFamily: mono, fontSize: 11, color: C.faint, flexShrink: 0 }}>{open ? '▴' : '▾'}</span>
      ) : (
        <span style={{ fontFamily: mono, fontSize: 12.5, color: e.price_cents > 0 ? C.goldHi : C.faint, flexShrink: 0 }}>
          {e.price_cents > 0 ? `€${(e.price_cents / 100).toFixed(2)}` : 'Free'}
        </span>
      )}
    </div>
    {open && <EventDetail products={products} bookings={bookings} url={e.fourvenues?.url ?? null} />}
    </div>
  )
}

// What a Fourvenues night is on sale as, and who booked it through the app.
// Same type scale and colours as the row; nothing here is editable — the
// promoter sets their products on Fourvenues.
function EventDetail({ products, bookings, url }: {
  products: FourvenuesProduct[]; bookings: NightBooking[]; url: string | null
}) {
  const label: React.CSSProperties = { ...caps, fontSize: 9.5, color: C.faint, letterSpacing: '0.12em', margin: '0 0 7px' }
  const line: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, fontFamily: font, fontSize: 12.5, color: C.dim, padding: '4px 0' }
  return (
    <div style={{ borderTop: `1px solid ${C.line}`, padding: '11px 13px 12px 104px', display: 'grid', gap: 14 }}>
      {products.length > 0 && (
        <div>
          <p style={label}>On sale</p>
          {products.map((p, i) => (
            <div key={i}>
              <div style={line}>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <span style={{
                    color: onSale(p) ? C.text : C.faint,
                    textDecoration: p.sold_out || p.unavailable ? 'line-through' : 'none',
                  }}>{p.name ?? SETTLE[p.settle]}</span>
                  <span style={{ color: C.faint }}>· {SETTLE[p.settle] ?? p.settle}</span>
                  {p.sold_out && !p.unavailable && <Badge color={C.danger}>Sold out</Badge>}
                  {p.unavailable && <Badge color={C.faint}>No longer on sale</Badge>}
                  {!p.sold_out && !p.unavailable && p.sale_starts && new Date(p.sale_starts) > new Date() && (
                    <Badge color={C.gold}>
                      On sale {new Date(p.sale_starts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })}
                    </Badge>
                  )}
                </span>
                <span style={{ fontFamily: mono, color: p.settle === 'free' ? C.faint : C.goldHi, flexShrink: 0 }}>
                  {p.settle === 'free' ? 'Free' : p.settle === 'table' ? '' : eur(p.price)}
                </span>
              </div>
              {p.settle === 'table' && (p.rates ?? []).map((r, j) => (
                <div key={j} style={{ ...line, fontSize: 12, paddingLeft: 14 }}>
                  <span style={{ color: C.faint }}>
                    {r.name ?? 'Rate'}
                    {r.pax ? ` · ${r.pax[0] === r.pax[1] ? r.pax[0] : `${r.pax[0]}–${r.pax[1]}`} ${r.pax[1] === 1 ? 'guest' : 'guests'}` : ''}
                    {r.deposit ? ` · ${r.deposit_type === 'porcentaje' ? `${r.deposit}%` : eur(r.deposit)} deposit` : ''}
                    {r.deposit && r.full_payment ? ' or pay in full' : ''}
                  </span>
                  <span style={{ fontFamily: mono, color: C.goldHi, flexShrink: 0 }}>{eur(r.price)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div>
        <p style={label}>Booked through Club Fuoco</p>
        {bookings.length === 0 && <p style={{ ...line, margin: 0, color: C.faint }}>No bookings yet.</p>}
        {bookings.map(b => (
          <div key={b.id} style={line}>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ color: C.text }}>{b.guest ?? 'Guest'}</span>
              <span style={{ color: C.faint }}>
                {' · '}{b.product ?? SETTLE[b.settle] ?? b.settle}{b.heads > 1 ? ` · ${b.heads} guests` : ''}
                {' · '}{new Date(b.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })}
              </span>
            </span>
            <span style={{ display: 'inline-flex', gap: 10, flexShrink: 0, fontFamily: mono }}>
              <span style={{ color: b.has_qr ? C.green : C.faint }}>{b.has_qr ? 'QR ✓' : 'QR pending'}</span>
              <span style={{ color: b.settle === 'free' ? C.faint : C.goldHi, minWidth: 52, textAlign: 'right' }}>
                {b.settle === 'free' ? 'Free' : `${eur(b.amount)}${b.settle === 'door' ? ' door' : ''}`}
              </span>
            </span>
          </div>
        ))}
      </div>

      {url && (
        <a href={url.replace('/iframe/', '/')} target="_blank" rel="noreferrer"
           style={{ fontFamily: font, fontSize: 12, color: C.goldHi, textDecoration: 'none' }}>
          Open on Fourvenues ↗
        </a>
      )}
    </div>
  )
}
