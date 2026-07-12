import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { getBrand } from '@/lib/partner'
import { ok, err } from '@/lib/utils'

// POST /api/portal/brands/:id/provision-login — grant the supplier access to the
// FuocoPromoters app. Finds or creates a Supabase account for the brand's
// login_email, marks it a pre-approved promoter (so it passes the app's gate
// without the IG-application flow), and links it to the brand via owner_user_id.
//
// No email is sent: the account is created with email_confirm so the supplier
// just signs in with their email via the app's normal one-time-code flow.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params
  const sb = await createServiceClient()

  const brand = await getBrand(sb, id)
  if (!brand) return err('Brand not found', 404)
  const email = brand.login_email?.trim().toLowerCase()
  if (!email) return err('Set a login email for this brand first')

  // Find an existing account for this email, else create one (no email sent).
  let userId: string | null = null
  let reused = false
  const { data: existing } = await sb.from('users').select('id').eq('email', email).maybeSingle()
  if (existing) {
    userId = (existing as { id: string }).id
    reused = true
  } else {
    const { data: created, error: createErr } = await sb.auth.admin.createUser({
      email,
      email_confirm: true,   // no confirmation email; OTP sign-in works immediately
    })
    if (createErr || !created?.user) return err(createErr?.message ?? 'Could not create account', 500)
    userId = created.user.id
  }

  // Don't let one login own two brands — the supplier UI resolves exactly one.
  const { data: clash } = await sb
    .from('partner_brands')
    .select('id, name')
    .eq('owner_user_id', userId)
    .neq('id', id)
    .maybeSingle()
  if (clash) return err(`That login is already linked to “${(clash as { name: string }).name}”`)

  // Pre-approve as a promoter so the app admits them, and link the brand.
  const { error: userErr } = await sb.from('users')
    .update({ account_kind: 'promoter', is_promoter: true })
    .eq('id', userId)
  if (userErr) return err(userErr.message, 500)

  const { error: linkErr } = await sb.from('partner_brands')
    .update({ owner_user_id: userId })
    .eq('id', id)
  if (linkErr) return err(linkErr.message, 500)

  return ok({ provisioned: true, email, reused })
}

// DELETE /api/portal/brands/:id/provision-login — revoke access. Unlinks the
// brand from its account (leaves the account itself intact).
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params
  const sb = await createServiceClient()
  const { error } = await sb.from('partner_brands').update({ owner_user_id: null }).eq('id', id)
  if (error) return err(error.message, 500)
  return ok({ revoked: true })
}
