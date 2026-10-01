import crypto from 'crypto'

// ── Ticket inbox ─────────────────────────────────────────────────────────────
//
// Each profile gets a private address, <token>@tickets.clubfuoco.com, that the
// app hands to Fourvenues instead of the account email. Resend receives it (MX
// on the tickets. subdomain — clubfuoco.com's own mail stays on iCloud) and
// calls /api/inbound/resend, which files the ticket against the account and
// forwards a copy to the guest's real inbox.
//
// Why not just the account email: Sign in with Apple accounts carry a
// @privaterelay.appleid.com address that only accepts mail from senders the
// app registers with Apple. Fourvenues isn't one of ours, so their ticket
// email silently never arrives.

export const TICKET_INBOX_DOMAIN = process.env.TICKET_INBOX_DOMAIN ?? 'tickets.clubfuoco.com'

/** 12 chars of [a-z0-9] — ~62 bits, unguessable, and says nothing about the user. */
export function newInboxToken(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'   // no l/1/o/0 lookalikes
  const bytes = crypto.randomBytes(12)
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('')
}

export function inboxAddress(token: string): string {
  return `${token}@${TICKET_INBOX_DOMAIN}`
}

/** The token from any of the recipients that is one of our inbox addresses. */
export function tokenFromRecipients(to: string[]): string | null {
  const domain = TICKET_INBOX_DOMAIN.toLowerCase()
  for (const raw of to) {
    const addr = (raw.match(/<([^>]+)>/)?.[1] ?? raw).trim().toLowerCase()
    const [local, host] = addr.split('@')
    if (host === domain && /^[a-z0-9]{10,32}$/.test(local ?? '')) return local
  }
  return null
}

// ── Reading a Fourvenues ticket email ────────────────────────────────────────

export interface ParsedTicketEmail {
  /** Fourvenues' own door code — the QR payload, e.g. "LNKO1S1G1". */
  codes: string[]
  /** connector-service.fourvenues.com/tickets/<token>/<kind>-<CODE>.pdf */
  pdfUrls: string[]
  /** First 4 chars of the door code: the event code (LNKO). */
  eventCode: string | null
  eventName: string | null
  /** yyyy-mm-dd, the night, when the email states a date. */
  night: string | null
  heads: number | null
  productName: string | null
  isGuestlist: boolean
}

/** Resend can hand back html as a data: URI ("html_format": "data_uri"). */
export function decodeHtml(html: string | null | undefined): string {
  if (!html) return ''
  const m = html.match(/^data:text\/html(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/)
  if (!m) return html
  return m[1] ? Buffer.from(m[2], 'base64').toString('utf8') : decodeURIComponent(m[2])
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
}

export function parseTicketEmail(subject: string, html: string, text: string): ParsedTicketEmail {
  const body = `${html}\n${text}`
  // PDF links. The filename carries the door code: listas-LNKO1S1G1.pdf,
  // entradas-…pdf, reservas-…pdf.
  const pdfUrls = Array.from(new Set(
    (body.match(/https:\/\/connector-service\.fourvenues\.com\/tickets\/[A-Za-z0-9]+\/[A-Za-z0-9_-]+\.pdf/g) ?? [])
      .map(u => u.replace(/&amp;/g, '&'))))
  const codes = Array.from(new Set(pdfUrls
    .map(u => u.match(/\/[a-z]+-([A-Z0-9]{6,24})\.pdf$/i)?.[1]?.toUpperCase())
    .filter((c): c is string => !!c)))

  const plain = (text || html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')

  // "You're in! Guest list confirmed for Jet Lag" / "… for Jet Lag"
  const eventName = subject.match(/\bfor\s+(.+?)\s*$/i)?.[1]
    ?? subject.match(/\bpara\s+(.+?)\s*$/i)?.[1] ?? null

  let night: string | null = null
  const d = plain.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),\s*(\d{4})/i)
    ?? null
  const ds = d ? null : plain.match(/\b(\d{1,2})\s+de\s+([a-záé]+)\s+de\s+(\d{4})/i)
  if (d) night = `${d[3]}-${String(MONTHS[d[1].toLowerCase()]).padStart(2, '0')}-${d[2].padStart(2, '0')}`
  else if (ds && MONTHS[ds[2].toLowerCase()]) night = `${ds[3]}-${String(MONTHS[ds[2].toLowerCase()]).padStart(2, '0')}-${ds[1].padStart(2, '0')}`

  const heads = Number(plain.match(/valid for\s+(\d+)\s+person/i)?.[1]
    ?? plain.match(/v[aá]lid[oa]? para\s+(\d+)\s+persona/i)?.[1] ?? NaN)

  return {
    codes,
    pdfUrls,
    eventCode: codes[0]?.slice(0, 4) ?? null,
    eventName,
    night,
    heads: Number.isFinite(heads) && heads > 0 ? heads : null,
    productName: null,
    isGuestlist: /guest ?list|lista/i.test(subject) || pdfUrls.some(u => /\/listas-/.test(u)),
  }
}
