// ── A guest refunding an event ticket ────────────────────────────────────────
//
// The rules, in one place so the button (/mine sends `refund_cents`) and the
// endpoint (/guest/<id>/refund) can never disagree:
//   • 90% of what that ticket cost comes back; Club Fuoco keeps 10%;
//   • only until doors open (Madrid wall clock), and never once scanned in;
//   • only a PAID ticket, and only by the person who paid for it — the
//     buyer of a ticket held for a friend, or the guest who bought their own;
//   • per ticket: one friend's ticket can go without touching the rest;
//   • not once it has been sent on and claimed — then it's the friend's.

export const REFUND_SHARE = 0.9

/** Doors when a night has no open_time — early enough to be safe. */
const DEFAULT_DOORS = '20:00'

export interface RefundableRow {
  payment_status?: string | null
  amount_cents?: number | null
  checked_in_at?: string | null
  claimed_by_user?: string | null
  purchased_by_user?: string | null
}

export interface RefundNight {
  night_date: string            // yyyy-mm-dd
  open_time?: string | null     // HH:MM[:SS], Madrid
}

/** "yyyy-mm-ddTHH:MM" in Madrid — sortable, so wall clocks compare as strings. */
export function madridWall(now = new Date()): string {
  const s = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now)
  return s.replace(' ', 'T').slice(0, 16)
}

/** When doors open, as a Madrid wall clock. Doors before noon are the
 *  following morning (a night on the 9th opening at 00:30 opens on the 10th). */
export function doorsWall(night: RefundNight): string {
  const hm = (night.open_time ?? DEFAULT_DOORS).slice(0, 5)
  const hour = Number(hm.slice(0, 2))
  let date = night.night_date
  if (hour < 12) {
    const [y, m, d] = date.split('-').map(Number)
    const next = new Date(Date.UTC(y, m - 1, d + 1))
    date = next.toISOString().slice(0, 10)
  }
  return `${date}T${hm}`
}

/** Who paid for this ticket — the only account a refund may be asked by. */
export function payerOf(row: RefundableRow): string | null {
  return row.purchased_by_user ?? row.claimed_by_user ?? null
}

export type RefundQuote =
  | { ok: true; refundCents: number }
  | { ok: false; reason: string; status: number }

export function refundQuote(
  row: RefundableRow, night: RefundNight, userId: string, now = new Date(),
): RefundQuote {
  if (payerOf(row) !== userId) return { ok: false, reason: 'Only the person who paid can refund this ticket', status: 403 }
  // Sent on and claimed: it's the friend's ticket now. Refunding it would void
  // somebody else's night without them knowing.
  if (row.claimed_by_user && row.claimed_by_user !== userId) {
    return { ok: false, reason: 'This ticket has been sent to someone else', status: 409 }
  }
  if (row.payment_status === 'refunded' || row.payment_status === 'disputed') {
    return { ok: false, reason: 'This ticket has already been refunded', status: 409 }
  }
  const paid = row.amount_cents ?? 0
  if (row.payment_status !== 'paid' || paid <= 0) {
    return { ok: false, reason: 'This ticket wasn’t paid for, so there’s nothing to refund', status: 409 }
  }
  if (row.checked_in_at) return { ok: false, reason: 'This ticket has already been used', status: 409 }
  if (madridWall(now) >= doorsWall(night)) {
    return { ok: false, reason: 'Refunds close when doors open', status: 409 }
  }
  return { ok: true, refundCents: Math.floor(paid * REFUND_SHARE) }
}
