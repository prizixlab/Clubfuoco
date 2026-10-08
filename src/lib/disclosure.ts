// Promoter disclosure — the money statement the portal sends a promoter.
//
// Per club the promoter works: every VIP table they sell there (ranked on it
// on the VIP page, or listed by their own Fourvenues channel) with every price
// it sells at, what the club pays per table, and how that splits between Club
// Fuoco and the promoter; plus the guestlist price for men and women, 50/50.
//
// Client-safe (types + arithmetic). The modal previews with it and the send
// route recomputes with it, so the email never trusts a client total.

export const GUESTLIST_SPLIT = 0.5

/** The binding clause printed on every disclosure, in the modal and the email. */
export const DISCLOSURE_STATEMENT =
  'This disclosure forms part of the written contract sent to the party receiving it, ' +
  'and is to be taken as an extension of that contract. All penalties of perjury apply.'

/** One price a table sells at (a Fourvenues rate). */
export interface TablePrice {
  label: string | null
  price: number
  pax: [number, number] | null
  deposit: number | null
}

export interface DisclosureTable {
  /** club_id|zone_key — a table's stable identity (Fourvenues re-mints zone ids nightly). */
  key: string
  name: string
  prices: TablePrice[]
}

export interface DisclosureClub {
  club_id: string
  club_name: string
  /** Empty = they don't sell VIP at this club; the VIP section doesn't show. */
  tables: DisclosureTable[]
}

// What the operator types in, per table and per club.
export interface TableTerms { club_pays: number | null; fuoco_part: number | null }
export interface GuestlistTerms { gl_man: number | null; gl_woman: number | null }

export function promoterPart(t: TableTerms): number | null {
  if (t.club_pays == null || t.fuoco_part == null) return null
  return round2(t.club_pays - t.fuoco_part)
}

export function half(v: number | null): number | null {
  return v == null ? null : round2(v * GUESTLIST_SPLIT)
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100
}

export function eur(v: number | null): string {
  if (v == null) return '—'
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(v)
}

export function priceLine(p: TablePrice): string {
  return [
    eur(p.price),
    p.pax ? (p.pax[0] === p.pax[1] ? `${p.pax[0]} pax` : `${p.pax[0]}–${p.pax[1]} pax`) : null,
    p.deposit != null && p.deposit < p.price ? `deposit ${eur(p.deposit)}` : null,
    p.label,
  ].filter(Boolean).join(' · ')
}
