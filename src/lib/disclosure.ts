// Promoter disclosure — the per-night money statement the portal sends a
// promoter: what the club pays per VIP table and Club Fuoco's share of it, and
// the guestlist price for men and women with the 50% split worked out.
//
// Shared by the portal modal (live preview) and the send route (which
// recomputes everything server-side, so the email never trusts a client total).

export const GUESTLIST_SPLIT = 0.5

/** The binding clause printed on every disclosure, in the modal and the email. */
export const DISCLOSURE_STATEMENT =
  'This disclosure forms part of the written contract sent to the party receiving it, ' +
  'and is to be taken as an extension of that contract. All penalties of perjury apply.'

export interface DisclosureNightInput {
  night_id: string
  night_date: string
  /** Venue + title as shown to the operator, carried for the email. */
  label: string
  /** € the club pays per table. */
  table_club_pays: number | null
  /** € of that which is Club Fuoco's share. */
  table_our_share: number | null
  /** € guestlist price, men. */
  gl_man: number | null
  /** € guestlist price, women. */
  gl_woman: number | null
}

export interface DisclosureNight extends DisclosureNightInput {
  gl_man_split: number | null
  gl_woman_split: number | null
}

export function computeNight(n: DisclosureNightInput): DisclosureNight {
  return {
    ...n,
    gl_man_split: n.gl_man == null ? null : round2(n.gl_man * GUESTLIST_SPLIT),
    gl_woman_split: n.gl_woman == null ? null : round2(n.gl_woman * GUESTLIST_SPLIT),
  }
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100
}

export function eur(v: number | null): string {
  if (v == null) return '—'
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(v)
}
