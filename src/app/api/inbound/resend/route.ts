import { NextRequest } from 'next/server'
import { Resend } from 'resend'
import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { decodeHtml, parseTicketEmail, tokenFromRecipients } from '@/lib/ticket-inbox'
import { notify } from '@/lib/notify'

// POST /api/inbound/resend
//
// Resend's `email.received` webhook for the ticket inbox
// (<token>@tickets.clubfuoco.com — see lib/ticket-inbox). For each email:
//
//   1. verify the Svix signature against the RAW body;
//   2. skip it if this email_id was already handled (Resend retries);
//   3. find the user from the recipient token;
//   4. fetch the body (the webhook carries metadata only) and read the
//      Fourvenues ticket out of it: PDF link(s) and the door code, which is in
//      the PDF's filename (listas-LNKO1S1G1.pdf → QR payload "LNKO1S1G1");
//   5. file it on external_tickets — merging into the row the app wrote at
//      sign-up/payment when there is one, so one ticket never becomes two;
//   6. forward a copy to the user's real inbox from our own domain.
//
// Always answers 200 once the signature checks out, even when the email isn't
// a ticket: a non-2xx makes Resend retry an email that will never parse.

// Two keys, least privilege. Reading a RECEIVED email needs a full-access key;
// the app's RESEND_API_KEY is (rightly) send-only and Resend refuses it here
// ("This API key is restricted to only send emails"). So the inbox reads with
// its own RESEND_INBOUND_API_KEY and keeps sending (the forward) on the
// ordinary send-only key.
const sender = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
// Read under either name: production has it as ESEND_INBOUND_API_KEY (a typo
// in Vercel). Renaming it there to RESEND_INBOUND_API_KEY needs no code change.
const READ_KEY = process.env.RESEND_INBOUND_API_KEY ?? process.env.ESEND_INBOUND_API_KEY
const reader = READ_KEY ? new Resend(READ_KEY) : null
const SECRET = process.env.RESEND_INBOUND_WEBHOOK_SECRET
const FORWARD_FROM = process.env.TICKET_INBOX_FORWARD_FROM ?? 'Club Fuoco Tickets <tickets@clubfuoco.com>'

type Sb = Awaited<ReturnType<typeof createServiceClient>>

interface ReceivedEvent {
  type: string
  data: { email_id: string; from?: string; to?: string[]; subject?: string }
}

export async function POST(req: NextRequest) {
  if (!reader || !sender || !SECRET) return err('Ticket inbox not configured', 503)

  const raw = await req.text()
  let event: ReceivedEvent
  try {
    event = reader.webhooks.verify({
      payload: raw,
      headers: {
        id: req.headers.get('svix-id') ?? '',
        timestamp: req.headers.get('svix-timestamp') ?? '',
        signature: req.headers.get('svix-signature') ?? '',
      },
      webhookSecret: SECRET,
    }) as unknown as ReceivedEvent
  } catch {
    return err('Invalid signature', 401)
  }
  if (event.type !== 'email.received' || !event.data?.email_id) return ok({ ignored: event.type })

  const { email_id, from = '', to = [], subject = '' } = event.data
  const sb = await createServiceClient()

  // 2. Idempotency: Resend retries; a second delivery must not file twice.
  const { data: seen } = await sb
    .from('ticket_inbox_messages').select('status').eq('email_id', email_id).maybeSingle()
  if (seen) return ok({ duplicate: true, status: seen.status })

  const log = (row: Record<string, unknown>) =>
    sb.from('ticket_inbox_messages').insert({
      email_id, from_address: from.slice(0, 300), to_address: to.join(', ').slice(0, 300),
      subject: subject.slice(0, 300), ...row,
    })

  // 3. Whose inbox?
  const token = tokenFromRecipients(to)
  const { data: inbox } = token
    ? await sb.from('ticket_inboxes').select('user_id').eq('token', token).maybeSingle()
    : { data: null }
  if (!inbox) {
    await log({ status: 'unknown_inbox' })
    return ok({ filed: false, reason: 'unknown inbox' })
  }
  const userId = inbox.user_id as string

  try {
    // 4. Body.
    const { data: email, error: getErr } = await reader.emails.receiving.get(email_id)
    if (getErr || !email) throw new Error(getErr?.message ?? 'email not found')
    const html = decodeHtml((email as { html?: string | null }).html)
    const text = (email as { text?: string | null }).text ?? ''
    const parsed = parseTicketEmail(subject, html, text)

    let ticketId: string | null = null
    let fresh = false
    if (parsed.codes.length && parsed.eventCode) {
      ({ id: ticketId, fresh } = await fileTicket(sb, userId, parsed, from))
    }

    // The QR just reached the account — tell the guest, once per ticket.
    if (ticketId && fresh) {
      const name = parsed.eventName ?? 'your night'
      await notify({
        user_id: userId,
        type: 'partner_ticket_ready',
        title: `Your ticket for ${name} is ready`,
        body: "It's in Tickets — show the QR at the door.",
        link: '/bookings',
        push: 'clubfuoco',
      })
    }

    // 6. Forward a copy whatever it was — it reached the user's address.
    const forwarded = await forward(sb, userId, subject, html, text, from, parsed.eventName)

    await log({
      user_id: userId,
      status: ticketId ? 'filed' : 'no_ticket',
      ticket_id: ticketId,
      forwarded,
      detail: parsed.codes.length ? `codes ${parsed.codes.join(',')}` : 'no Fourvenues ticket link',
    })
    return ok({ filed: !!ticketId, forwarded })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[inbound/resend]', email_id, message)
    await log({ user_id: userId, status: 'error', detail: message.slice(0, 300) })
    return ok({ filed: false, error: true })
  }
}

/**
 * 5. Merge into the app's own row for this event when it exists (written at
 * sign-up, QR not yet known); otherwise file a new one from the email alone.
 */
async function fileTicket(
  sb: Sb, userId: string, p: ReturnType<typeof parseTicketEmail>, from: string,
): Promise<{ id: string; fresh: boolean }> {
  const code = p.codes[0]
  const pdf = p.pdfUrls.find(u => u.toUpperCase().includes(code)) ?? p.pdfUrls[0] ?? null

  // Already filed with this exact code (a second email, or the app read it).
  const { data: same } = await sb.from('external_tickets')
    .select('id').eq('user_id', userId).eq('qr_payload', code).maybeSingle()
  if (same) {
    await sb.from('external_tickets').update({ pdf_url: pdf }).eq('id', same.id)
    return { id: same.id as string, fresh: false }
  }

  // The app's row for this event, still waiting for its QR — newest first.
  const { data: pending } = await sb.from('external_tickets')
    .select('id').eq('user_id', userId).eq('event_code', p.eventCode!).is('qr_payload', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (pending) {
    await sb.from('external_tickets').update({ qr_payload: code, pdf_url: pdf }).eq('id', pending.id)
    return { id: pending.id as string, fresh: true }
  }

  // Email only (booked on another device before this existed, or the app was
  // closed mid-flow): file what the email tells us.
  const venue = from.match(/^\s*"?([^"<]+?)"?\s*</)?.[1]?.trim() ?? null
  const { data: row, error } = await sb.from('external_tickets').insert({
    user_id: userId,
    provider: 'fourvenues',
    event_code: p.eventCode,
    event_name: p.eventName,
    venue,
    night: p.night ?? new Date().toISOString().slice(0, 10),
    settle: p.isGuestlist ? 'free' : 'online',
    heads: p.heads ?? 1,
    qr_payload: code,
    pdf_url: pdf,
    source: 'email',
  }).select('id').single()
  if (error) throw new Error(`file ticket: ${error.message}`)
  return { id: row.id as string, fresh: true }
}

/** A copy to the account's real address, from our verified domain. */
async function forward(
  sb: Sb, userId: string, subject: string, html: string, text: string, from: string,
  eventName: string | null,
): Promise<boolean> {
  if (!sender) return false
  const { data: user } = await sb.from('users').select('email').eq('id', userId).maybeSingle()
  const to = (user as { email?: string | null } | null)?.email
  if (!to) return false
  const note = eventName
    ? `Your ticket for ${escapeHtml(eventName)} is saved in the Club Fuoco app, under Tickets — the QR is there, ready for the door.`
    : 'This came to your Club Fuoco ticket address. Anything we recognise as a ticket is saved in the app, under Tickets.'
  // Club Fuoco's lockup above the platform's own email. Gold, never pink —
  // the brand accent is #C09950.
  const header = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto 18px;padding:18px 20px;border-radius:14px;background:#F8F5EE;border:1px solid #E9E2D3">
  <div style="font-size:11px;letter-spacing:3px;color:#C09950;font-weight:600">CLUB FUOCO</div>
  <div style="font-size:14px;line-height:1.45;color:#221E1A;margin-top:8px">${note}</div>
  <div style="font-size:11px;color:#9F9486;margin-top:8px">Below is the original email from ${escapeHtml(senderName(from))}.</div>
</div>`
  const { error } = await sender.emails.send({
    from: FORWARD_FROM,
    to,
    subject,
    html: header + (html || `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(text)}</pre>`),
    replyTo: from || undefined,
  } as Parameters<typeof sender.emails.send>[0])
  if (error) console.warn('[inbound/resend] forward failed:', error.message)
  return !error
}

function senderName(from: string): string {
  return from.match(/^\s*"?([^"<]+?)"?\s*</)?.[1]?.trim() ?? (from || 'the sender')
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
