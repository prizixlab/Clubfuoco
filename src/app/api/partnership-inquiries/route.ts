import { createServiceClient } from '@/lib/supabase/server'
import { Resend } from 'resend'
import { ok, err } from '@/lib/utils'

// Public POST endpoint for the partner inquiry form at /partners.
// Writes the inquiry to Supabase and sends an internal notification email.
// No auth — anyone can submit; spam mitigation lives at the Resend / DB layer.

const ADMIN_EMAIL = process.env.PARTNERSHIP_INBOX ?? process.env.ADMIN_EMAILS?.split(',')[0]?.trim()
const FROM        = process.env.RESEND_FROM ?? 'Club Fuoco <hello@clubfuoco.com>'

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return err('Invalid JSON') }

  const company  = String(body.company  ?? '').slice(0, 200).trim()
  const contact  = String(body.contact  ?? '').slice(0, 200).trim()
  const role     = String(body.role     ?? '').slice(0, 100).trim()
  const message  = String(body.message  ?? '').slice(0, 4000).trim()
  const audience = String(body.audience ?? '').slice(0, 50).trim()

  if (!company || !contact) return err('company and contact are required')

  // Persist to Supabase. The table is best-effort; if it doesn't exist yet we
  // still notify the inbox so a real human gets the message.
  const supabase = await createServiceClient()
  await supabase
    .from('partnership_inquiries')
    .insert({ company, contact, role, message, audience })
    .then(({ error }) => {
      if (error) console.error('[partnership_inquiries] insert failed:', error.message)
    })

  // Notify the inbox so we see the submission in real time.
  if (ADMIN_EMAIL && process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    try {
      await resend.emails.send({
        from: FROM,
        to:   ADMIN_EMAIL,
        subject: `Partnership inquiry — ${company}`,
        html: `
          <h2 style="font-family:system-ui,sans-serif">New partnership inquiry</h2>
          <table style="font-family:system-ui,sans-serif;font-size:14px;border-collapse:collapse">
            <tr><td><b>Audience</b></td><td>${escape(audience)}</td></tr>
            <tr><td><b>Company</b></td><td>${escape(company)}</td></tr>
            <tr><td><b>Contact</b></td><td>${escape(contact)}</td></tr>
            <tr><td><b>Role</b></td><td>${escape(role)}</td></tr>
            <tr><td valign="top"><b>Message</b></td><td>${escape(message).replace(/\n/g, '<br/>')}</td></tr>
          </table>
        `,
      })
    } catch (e) {
      console.error('[partnership_inquiries] notify failed:', e)
    }
  }

  return ok({ received: true })
}

function escape(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
