import { Resend } from 'resend'
import QRCode    from 'qrcode'
import { eur, type DisclosureNight } from '@/lib/disclosure'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

const FROM   = process.env.RESEND_FROM ?? 'Club Fuoco <onboarding@resend.dev>'
// Partner/supplier mail reads better from a dedicated address than from the
// ticket sender. Any mailbox on the already-verified clubfuoco.com domain sends
// with no extra setup; override via env if you want a different one.
const PARTNER_FROM = process.env.RESEND_PARTNER_FROM ?? 'Club Fuoco <partners@clubfuoco.com>'
const ADMIN  = process.env.ADMIN_EMAILS?.split(',')[0] ?? ''
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://clubfuoco.com'

function fmtPrice(cents: number, currency = 'EUR') {
  if (cents === 0) return 'Free'
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(cents / 100)
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}
function fmtDateShort(iso: string) {
  const d = new Date(iso)
  return {
    day:     d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase(),
    date:    d.getDate(),
    month:   d.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase(),
    year:    d.getFullYear(),
    time:    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
  }
}

// Generate QR code as base64 PNG (white QR on black — looks clean at the door)
async function makeQR(orderId: string): Promise<string> {
  const verifyUrl = `${APP_URL}/verify/${orderId}`
  return QRCode.toDataURL(verifyUrl, {
    width:            280,
    margin:           2,
    errorCorrectionLevel: 'H',
    color: { dark: '#000000', light: '#ffffff' },
  })
}

// Strip data: prefix → raw base64 for Resend attachment
function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.replace(/^data:image\/png;base64,/, '')
}

// ── Supplier password-setup email ────────────────────────────────────────────
// Sent when the portal provisions a list/supplier's FuocoPromoters access. The
// actionLink is a Supabase invite/recovery link (generated, not sent, by
// Supabase) that lands on /supplier/set-password. Returns whether it sent, so
// the caller can tell the operator if email isn't configured.
export async function sendSupplierPasswordSetup({
  to, brandName, actionLink, isReset,
}: {
  to:         string
  brandName:  string
  actionLink: string
  isReset:    boolean
}): Promise<boolean> {
  if (!resend) return false

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0A0A0A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0A;padding:32px 0;">
<tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">
  <tr><td style="padding:0 0 28px;text-align:center;">
    <p style="margin:0;font-size:11px;letter-spacing:0.25em;text-transform:uppercase;color:#C09950;font-weight:700;">CLUB FUOCO · PARTNER ACCESS</p>
  </td></tr>
  <tr><td style="background:#141416;border-radius:16px;border:1px solid rgba(255,255,255,0.1);padding:32px 28px;">
    <h1 style="margin:0 0 12px;font-size:22px;color:#F5F5F7;font-weight:700;">${isReset ? 'Reset your password' : 'Create your password'}</h1>
    <p style="margin:0 0 24px;font-size:15px;color:rgba(245,245,247,0.65);line-height:1.6;">
      ${isReset
        ? `Use the button below to set a new password for the <strong style="color:#F5F5F7;">${brandName}</strong> account.`
        : `You've been given access to manage <strong style="color:#F5F5F7;">${brandName}</strong>'s guestlist offers in the Fuoco for Promoters app. Set a password to get started.`}
    </p>
    <a href="${actionLink}" style="display:inline-block;background:#C09950;color:#141416;font-weight:700;font-size:15px;padding:14px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.02em;">
      ${isReset ? 'Reset password' : 'Create password'}
    </a>
    <p style="margin:24px 0 0;font-size:13px;color:rgba(245,245,247,0.45);line-height:1.6;">
      After setting your password, open the <strong style="color:rgba(245,245,247,0.7);">Fuoco for Promoters</strong> app and sign in with this email address and your new password. This link expires — if it's stopped working, ask your Club Fuoco contact to resend it.
    </p>
  </td></tr>
  <tr><td style="padding:24px 0 0;text-align:center;">
    <p style="margin:0;font-size:11px;color:rgba(245,245,247,0.25);line-height:1.6;">Club Fuoco · Barcelona</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`

  await resend.emails.send({
    from:    PARTNER_FROM,
    to,
    subject: isReset ? 'Reset your Club Fuoco partner password' : 'Set up your Club Fuoco partner access',
    html,
  })
  return true
}

// ── User ticket email ─────────────────────────────────────────────────────────
export async function sendTicketConfirmation({
  to, orderId, eventName, venueName, eventDate,
  quantity, basePriceCents, markupCents, totalCents, currency, platform,
}: {
  to:              string
  orderId:         string
  eventName:       string
  venueName:       string
  eventDate:       string | null
  quantity:        number
  basePriceCents:  number
  markupCents:     number
  totalCents:      number
  currency:        string
  platform:        string
}) {
  if (!resend) return

  const ref      = orderId.slice(0, 8).toUpperCase()
  const qrDataUrl = await makeQR(orderId)
  const qrBase64  = dataUrlToBase64(qrDataUrl)

  const dt      = eventDate ? fmtDateShort(eventDate) : null
  const dateStr = eventDate ? fmtDate(eventDate) : 'Date TBC'

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your ticket — ${eventName}</title>
</head>
<body style="margin:0;padding:0;background:#111;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#111;padding:24px 0;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">

  <!-- Logo bar -->
  <tr><td style="padding:0 0 28px;text-align:center;">
    <p style="margin:0;font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:#ff4d00;font-weight:700;">CLUB FUOCO</p>
  </td></tr>

  <!-- Ticket body -->
  <tr><td style="background:#1a1a1a;border-radius:20px;overflow:hidden;border:1px solid #2e2e2e;">

    <!-- Top band -->
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="background:linear-gradient(135deg,#ff4d00 0%,#cc2200 100%);padding:28px 28px 24px;">
          <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:rgba(255,255,255,0.7);">
            Club Fuoco · 1 Ticket
          </p>
          <h1 style="margin:0 0 8px;font-size:26px;font-weight:800;color:#fff;line-height:1.2;">${eventName}</h1>
          <p style="margin:0;font-size:16px;color:rgba(255,255,255,0.85);font-weight:500;">${venueName}</p>
        </td>
      </tr>

      <!-- Date / time row -->
      ${dt ? `
      <tr>
        <td style="background:#222;padding:16px 28px;border-bottom:1px solid #2e2e2e;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:56px;text-align:center;background:#ff4d00;border-radius:10px;padding:8px 0;">
                <p style="margin:0;font-size:9px;color:rgba(255,255,255,0.8);letter-spacing:0.1em;">${dt.day}</p>
                <p style="margin:0;font-size:24px;font-weight:800;color:#fff;line-height:1.1;">${dt.date}</p>
                <p style="margin:0;font-size:9px;color:rgba(255,255,255,0.8);letter-spacing:0.1em;">${dt.month}</p>
              </td>
              <td style="padding-left:16px;">
                <p style="margin:0 0 2px;font-size:15px;font-weight:700;color:#fff;">${dateStr}</p>
                <p style="margin:0;font-size:13px;color:#888;">${venueName} · Barcelona</p>
              </td>
              <td style="text-align:right;">
                <p style="margin:0;font-size:11px;color:#555;text-transform:uppercase;letter-spacing:0.1em;">Total</p>
                <p style="margin:0;font-size:20px;font-weight:800;color:#ff4d00;">${fmtPrice(totalCents, currency)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>` : ''}

      <!-- Perforated divider -->
      <tr>
        <td style="background:#1a1a1a;padding:0 20px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:24px;height:24px;background:#111;border-radius:50%;"></td>
              <td style="border-top:2px dashed #2e2e2e;"></td>
              <td style="width:24px;height:24px;background:#111;border-radius:50%;"></td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- QR code section -->
      <tr>
        <td style="padding:32px 28px;text-align:center;background:#1a1a1a;">
          <p style="margin:0 0 20px;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#555;">Scan at the door</p>
          <div style="display:inline-block;background:#fff;padding:16px;border-radius:16px;">
            <img src="cid:qrcode" width="200" height="200" alt="Entry QR code" style="display:block;">
          </div>
          <p style="margin:20px 0 0;font-size:22px;font-weight:800;color:#fff;letter-spacing:0.15em;">${ref}</p>
          <p style="margin:4px 0 0;font-size:11px;color:#555;letter-spacing:0.05em;">Booking reference</p>
        </td>
      </tr>

      <!-- Perforated divider -->
      <tr>
        <td style="background:#1a1a1a;padding:0 20px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:24px;height:24px;background:#111;border-radius:50%;"></td>
              <td style="border-top:2px dashed #2e2e2e;"></td>
              <td style="width:24px;height:24px;background:#111;border-radius:50%;"></td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Price breakdown -->
      <tr>
        <td style="padding:20px 28px 28px;background:#1a1a1a;">
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
            <tr>
              <td style="padding:6px 0;color:#666;">Ticket (×${quantity})</td>
              <td style="padding:6px 0;color:#888;text-align:right;">${fmtPrice(basePriceCents, currency)}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#666;">Service fee</td>
              <td style="padding:6px 0;color:#888;text-align:right;">${fmtPrice(markupCents, currency)}</td>
            </tr>
            <tr>
              <td style="padding:10px 0 0;font-weight:700;color:#fff;font-size:14px;border-top:1px solid #2e2e2e;">Total charged</td>
              <td style="padding:10px 0 0;font-weight:800;color:#ff4d00;font-size:14px;text-align:right;border-top:1px solid #2e2e2e;">${fmtPrice(totalCents, currency)}</td>
            </tr>
          </table>
        </td>
      </tr>

    </table>
  </td></tr>

  <!-- Footer note -->
  <tr><td style="padding:24px 0 0;text-align:center;">
    <p style="margin:0 0 6px;font-size:12px;color:#444;line-height:1.6;">
      Show the QR code above at the door — screenshot it or keep this email handy.
    </p>
    <p style="margin:0;font-size:11px;color:#333;line-height:1.6;">
      Club Fuoco · Barcelona · Questions? Reply to this email or message us in the app.
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`

  await resend.emails.send({
    from:    FROM,
    to,
    subject: `Your ticket — ${eventName}`,
    html,
    attachments: [
      {
        filename:   `ticket-${ref}.png`,
        content:    qrBase64,
        contentType: 'image/png',
        contentId: 'qrcode',   // referenced as cid:qrcode in the HTML
      },
    ],
  })
}

// ── Rumba guest list confirmation ────────────────────────────────────────────
export async function sendRumbaConfirmation({
  to, name, rumbaTitle, venueName, eventDate, plusOnes, signupId,
}: {
  to:         string
  name:       string
  rumbaTitle: string
  venueName:  string
  eventDate:  string
  plusOnes:   number
  signupId:   string
}) {
  if (!resend) return

  const dt      = fmtDateShort(eventDate)
  const dateStr = fmtDate(eventDate)
  const qrDataUrl = await makeQR(signupId)
  const qrBase64  = dataUrlToBase64(qrDataUrl)
  const ref       = signupId.slice(0, 8).toUpperCase()

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>You're on the list — ${rumbaTitle}</title>
</head>
<body style="margin:0;padding:0;background:#111;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#111;padding:24px 0;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">

  <!-- Logo bar -->
  <tr><td style="padding:0 0 28px;text-align:center;">
    <p style="margin:0;font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:#ff4d00;font-weight:700;">CLUB FUOCO</p>
  </td></tr>

  <!-- Ticket body -->
  <tr><td style="background:#1a1a1a;border-radius:20px;overflow:hidden;border:1px solid #2e2e2e;">
    <table width="100%" cellpadding="0" cellspacing="0">

      <!-- Top band — fire gradient -->
      <tr>
        <td style="background:linear-gradient(135deg,#cc2200 0%,#ff4d00 50%,#ff7c00 100%);padding:28px 28px 24px;">
          <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:rgba(255,255,255,0.75);">
            Guest List Confirmation
          </p>
          <h1 style="margin:0 0 8px;font-size:26px;font-weight:800;color:#fff;line-height:1.2;">You're on the list</h1>
          <p style="margin:0;font-size:17px;color:rgba(255,255,255,0.9);font-weight:600;">${rumbaTitle}</p>
        </td>
      </tr>

      <!-- Date / venue row -->
      <tr>
        <td style="background:#222;padding:16px 28px;border-bottom:1px solid #2e2e2e;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:56px;text-align:center;background:#ff4d00;border-radius:10px;padding:8px 0;">
                <p style="margin:0;font-size:9px;color:rgba(255,255,255,0.8);letter-spacing:0.1em;">${dt.day}</p>
                <p style="margin:0;font-size:24px;font-weight:800;color:#fff;line-height:1.1;">${dt.date}</p>
                <p style="margin:0;font-size:9px;color:rgba(255,255,255,0.8);letter-spacing:0.1em;">${dt.month}</p>
              </td>
              <td style="padding-left:16px;">
                <p style="margin:0 0 2px;font-size:15px;font-weight:700;color:#fff;">${dateStr}</p>
                <p style="margin:0;font-size:13px;color:#888;">${venueName} · ${dt.time}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Guest details -->
      <tr>
        <td style="padding:16px 28px;background:#1a1a1a;border-bottom:1px solid #2e2e2e;">
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
            <tr>
              <td style="padding:6px 0;color:#666;">Name on list</td>
              <td style="padding:6px 0;color:#fff;font-weight:600;text-align:right;">${name}</td>
            </tr>
            ${plusOnes > 0 ? `
            <tr>
              <td style="padding:6px 0;color:#666;">Plus ones</td>
              <td style="padding:6px 0;color:#fff;text-align:right;">+${plusOnes} guest${plusOnes > 1 ? 's' : ''}</td>
            </tr>` : ''}
            <tr>
              <td style="padding:6px 0;color:#666;">Total entry</td>
              <td style="padding:6px 0;color:#ff4d00;font-weight:700;text-align:right;">${1 + plusOnes} ${1 + plusOnes === 1 ? 'person' : 'people'}</td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Perforated divider -->
      <tr>
        <td style="background:#1a1a1a;padding:0 20px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:24px;height:24px;background:#111;border-radius:50%;"></td>
              <td style="border-top:2px dashed #2e2e2e;"></td>
              <td style="width:24px;height:24px;background:#111;border-radius:50%;"></td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- QR code section -->
      <tr>
        <td style="padding:32px 28px;text-align:center;background:#1a1a1a;">
          <p style="margin:0 0 8px;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#555;">Show this at the door</p>
          <div style="display:inline-block;background:#fff;padding:16px;border-radius:16px;">
            <img src="cid:rumba-qrcode" width="180" height="180" alt="Door QR code" style="display:block;">
          </div>
          <p style="margin:20px 0 0;font-size:18px;font-weight:800;color:#fff;letter-spacing:0.15em;">${ref}</p>
          <p style="margin:4px 0 0;font-size:11px;color:#555;letter-spacing:0.05em;">List reference</p>
        </td>
      </tr>

      <!-- Perforated divider -->
      <tr>
        <td style="background:#1a1a1a;padding:0 20px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:24px;height:24px;background:#111;border-radius:50%;"></td>
              <td style="border-top:2px dashed #2e2e2e;"></td>
              <td style="width:24px;height:24px;background:#111;border-radius:50%;"></td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Note -->
      <tr>
        <td style="padding:20px 28px 28px;background:#1a1a1a;">
          <p style="margin:0;font-size:13px;color:#666;line-height:1.6;text-align:center;">
            Screenshot this email or keep it handy.<br>
            Show the QR code to staff at the door.
          </p>
        </td>
      </tr>

    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:24px 0 0;text-align:center;">
    <p style="margin:0;font-size:11px;color:#333;line-height:1.6;">
      Club Fuoco · Barcelona · Questions? Reply to this email or message us in the app.
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`

  await resend.emails.send({
    from:    FROM,
    to,
    subject: `You're on the list — ${rumbaTitle}`,
    html,
    attachments: [
      {
        filename:    `rumba-${ref}.png`,
        content:     qrBase64,
        contentType: 'image/png',
        contentId:   'rumba-qrcode',
      },
    ],
  })
}

// ── Admin fulfillment alert ───────────────────────────────────────────────────
export async function sendAdminTicketAlert({
  orderId, userEmail, eventName, venueName, eventDate,
  quantity, totalCents, currency, platform, platformEventId,
}: {
  orderId:         string
  userEmail:       string
  eventName:       string
  venueName:       string
  eventDate:       string | null
  quantity:        number
  totalCents:      number
  currency:        string
  platform:        string
  platformEventId: string | null
}) {
  if (!resend || !ADMIN) return

  const ref     = orderId.slice(0, 8).toUpperCase()
  const dateStr = eventDate ? fmtDate(eventDate) : 'Date TBC'

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff;color:#111;padding:32px;max-width:520px;">
  <div style="border-left:4px solid #ff4d00;padding-left:16px;margin-bottom:24px;">
    <h2 style="color:#ff4d00;margin:0 0 4px;font-size:20px;">New ticket order</h2>
    <p style="color:#666;margin:0;font-size:14px;">Action required — purchase this ticket and forward it to the customer.</p>
  </div>

  <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">
    <tr style="background:#f9f9f9;"><td style="padding:10px 12px;color:#666;width:140px;border-radius:4px 0 0 4px;">Reference</td><td style="padding:10px 12px;font-weight:700;color:#ff4d00;border-radius:0 4px 4px 0;">${ref}</td></tr>
    <tr><td style="padding:10px 12px;color:#666;">Customer email</td><td style="padding:10px 12px;"><a href="mailto:${userEmail}" style="color:#111;font-weight:600;">${userEmail}</a></td></tr>
    <tr style="background:#f9f9f9;"><td style="padding:10px 12px;color:#666;">Event</td><td style="padding:10px 12px;font-weight:600;">${eventName}</td></tr>
    <tr><td style="padding:10px 12px;color:#666;">Venue</td><td style="padding:10px 12px;">${venueName}</td></tr>
    <tr style="background:#f9f9f9;"><td style="padding:10px 12px;color:#666;">Date</td><td style="padding:10px 12px;">${dateStr}</td></tr>
    <tr><td style="padding:10px 12px;color:#666;">Quantity</td><td style="padding:10px 12px;">${quantity}×</td></tr>
    <tr style="background:#f9f9f9;"><td style="padding:10px 12px;color:#666;">Charged</td><td style="padding:10px 12px;font-weight:700;font-size:16px;">${fmtPrice(totalCents, currency)}</td></tr>
  </table>


  <div style="background:#fff8f5;border:1px solid #ffd0bb;border-radius:8px;padding:16px;font-size:13px;line-height:1.6;">
    <strong>Steps:</strong><br>
    1. Click the button above and buy ${quantity}× ticket(s) for this event<br>
    2. Forward the RA confirmation / ticket PDF to <strong>${userEmail}</strong><br>
    3. The customer already has a Club Fuoco booking confirmation with QR code sent automatically
  </div>
</body>
</html>`

  await resend.emails.send({
    from:    FROM,
    to:      ADMIN,
    subject: `[Action] ${ref} — ${eventName} · ${userEmail}`,
    html,
  })
}

// ── Credential intake email ──────────────────────────────────────────────────
// Sent from the portal when an operator asks a partner for an API key. The link
// is single-use and short-lived (see src/lib/credential-intake.ts), which is the
// whole reason this mail exists: it gives the partner somewhere to put a secret
// that isn't a reply to this email.
//
// The key itself must never come back through this channel, so the copy says so
// plainly rather than leaving it to good manners.
export async function sendCredentialIntake({
  to, displayName, providerLabel, link, expiresAt, fromName,
}: {
  to:            string
  displayName:   string
  providerLabel: string
  link:          string
  expiresAt:     string
  fromName?:     string
}): Promise<boolean> {
  if (!resend) return false

  const expires = new Date(expiresAt).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
  const who = fromName ?? 'Club Fuoco'

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0A0A0A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0A;padding:32px 0;">
<tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">
  <tr><td style="padding:0 0 28px;text-align:center;">
    <p style="margin:0;font-size:11px;letter-spacing:0.25em;text-transform:uppercase;color:#C09950;font-weight:700;">CLUB FUOCO · PARTNER ACCESS</p>
  </td></tr>
  <tr><td style="background:#141416;border-radius:16px;border:1px solid rgba(255,255,255,0.1);padding:32px 28px;">
    <h1 style="margin:0 0 12px;font-size:22px;color:#F5F5F7;font-weight:700;">Your ${providerLabel} API key</h1>
    <p style="margin:0 0 20px;font-size:15px;color:rgba(245,245,247,0.65);line-height:1.6;">
      Hi ${displayName}, ${who} needs your ${providerLabel} API key so that bookings made through Club Fuoco produce a real ${providerLabel} ticket for your door.
    </p>
    <p style="margin:0 0 24px;font-size:15px;color:rgba(245,245,247,0.65);line-height:1.6;">
      Use the secure page below to send it. The link works <strong style="color:#F5F5F7;">once</strong> and expires on ${expires}.
    </p>
    <a href="${link}" style="display:inline-block;background:#C09950;color:#141416;font-weight:700;font-size:15px;padding:14px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.02em;">
      Send the key securely
    </a>
    <p style="margin:24px 0 0;font-size:13px;color:rgba(245,245,247,0.45);line-height:1.6;">
      Please don't reply to this email with the key, and don't send it over WhatsApp. An API key is a password, and email keeps a copy forever. If the link has expired, just ask us for a new one.
    </p>
  </td></tr>
  <tr><td style="padding:24px 0 0;text-align:center;">
    <p style="margin:0;font-size:11px;color:rgba(245,245,247,0.25);line-height:1.6;">Club Fuoco · Barcelona</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`

  await resend.emails.send({
    from:    PARTNER_FROM,
    to,
    subject: `Your ${providerLabel} API key for Club Fuoco`,
    html,
  })
  return true
}

// ── Promoter disclosure email ────────────────────────────────────────────────
// Sent from the portal's "Send disclosure" on a promoter card: per logged night,
// what the club pays per table and Club Fuoco's share, and the guestlist price
// for men/women with the 50% split. The binding statement goes in verbatim —
// this mail is the written record the contract clause refers to.
export async function sendPromoterDisclosure({
  to, displayName, nights, statement, sentAt,
}: {
  to:          string
  displayName: string
  nights:      DisclosureNight[]
  statement:   string
  sentAt:      string
}): Promise<boolean> {
  if (!resend) return false
  const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

  const cell = 'padding:10px 8px;border-top:1px solid rgba(255,255,255,0.08);font-size:13px;color:#F5F5F7;vertical-align:top;'
  const head = 'padding:0 8px 8px;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:rgba(245,245,247,0.45);text-align:left;font-weight:600;'
  const rows = nights.map(n => `
    <tr>
      <td style="${cell}">${esc(fmtDate(n.night_date + 'T12:00:00'))}<br><span style="color:rgba(245,245,247,0.55);font-size:12px;">${esc(n.label)}</span></td>
      <td style="${cell}">${eur(n.table_club_pays)}</td>
      <td style="${cell}">${eur(n.table_our_share)}</td>
      <td style="${cell}">${eur(n.gl_man)}<br><span style="color:#C09950;font-size:12px;">50%: ${eur(n.gl_man_split)}</span></td>
      <td style="${cell}">${eur(n.gl_woman)}<br><span style="color:#C09950;font-size:12px;">50%: ${eur(n.gl_woman_split)}</span></td>
    </tr>`).join('')

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0A0A0A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0A;padding:32px 0;">
<tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;">
  <tr><td style="padding:0 0 28px;text-align:center;">
    <p style="margin:0;font-size:11px;letter-spacing:0.25em;text-transform:uppercase;color:#C09950;font-weight:700;">CLUB FUOCO · PROMOTER DISCLOSURE</p>
  </td></tr>
  <tr><td style="background:#141416;border-radius:16px;border:1px solid rgba(255,255,255,0.1);padding:32px 24px;">
    <h1 style="margin:0 0 8px;font-size:22px;color:#F5F5F7;font-weight:700;">Disclosure for ${esc(displayName)}</h1>
    <p style="margin:0 0 24px;font-size:13px;color:rgba(245,245,247,0.55);">Issued ${esc(fmtDate(sentAt))}</p>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <th style="${head}">Night</th>
        <th style="${head}">Club pays / table</th>
        <th style="${head}">Our share</th>
        <th style="${head}">Guestlist men</th>
        <th style="${head}">Guestlist women</th>
      </tr>
      ${rows}
    </table>
    <p style="margin:28px 0 0;padding:16px;border:1px solid rgba(192,153,80,0.45);border-radius:8px;font-size:13px;color:#F5F5F7;line-height:1.6;">
      ${esc(statement)}
    </p>
  </td></tr>
  <tr><td style="padding:24px 0 0;text-align:center;">
    <p style="margin:0;font-size:11px;color:rgba(245,245,247,0.25);line-height:1.6;">Club Fuoco · Barcelona</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`

  const { error } = await resend.emails.send({
    from:    PARTNER_FROM,
    to,
    subject: `Club Fuoco disclosure — ${displayName}`,
    html,
  })
  if (error) throw new Error(error.message)
  return true
}
