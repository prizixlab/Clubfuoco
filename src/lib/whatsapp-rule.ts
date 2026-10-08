// ── No WhatsApp offers ───────────────────────────────────────────────────────
//
// Club Fuoco rule (promoter terms, "No WhatsApp bookings"): nothing a guest is
// offered in the app may be booked, paid or confirmed over WhatsApp — from any
// promoter, through Fourvenues or anything else. A WhatsApp hand-off is not a
// product: we can't price it, enforce it, scan it at the door or refund it.
// (Boris listed its "VIP" on Fourvenues as a €0 zone named "WhatsApp".)
//
// Enforced in layers, all keyed on this one test:
//   • agentbox fourvenues_map.py (via_whatsapp) drops such products from the
//     catalog every app build reads;
//   • lib/vip-products ignores them, so they never become VIP products;
//   • promoter offers mentioning WhatsApp are refused on save and hidden from
//     the feed; nights and changes mentioning it are flagged in Reviews.

const WHATSAPP = /whats\s*app|wa\.me\/|api\.whatsapp\.com/i

/** Does any of these texts route the guest to WhatsApp? */
export function mentionsWhatsApp(...texts: unknown[]): boolean {
  return texts.some(t => {
    if (typeof t === 'string') return WHATSAPP.test(t)
    if (t && typeof t === 'object') return WHATSAPP.test(JSON.stringify(t))
    return false
  })
}

export const WHATSAPP_REFUSAL =
  'Offers booked over WhatsApp aren’t allowed on Club Fuoco. Remove the WhatsApp ' +
  'reference: guests have to be able to book and pay in the app.'
