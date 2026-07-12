import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { getBrand } from '@/lib/partner'
import { ok, err } from '@/lib/utils'

// Where the set-password email lands. Canonical production origin (not the
// request origin, which could be a preview/localhost) so the emailed link is
// always the live page. This path must be in Supabase Auth → Redirect URLs.
const SET_PASSWORD_URL = 'https://clubfuoco.com/supplier/set-password'

// POST /api/portal/brands/:id/provision-login — grant a supplier access to the
// FuocoPromoters app and email them a "create your password" link.
//   • new email  → admin invite (creates the account + sends the set-password link)
//   • known email → password-reset email (they set/replace their password)
// Either way the account is marked a pre-approved promoter and linked to the
// brand via owner_user_id. Re-POSTing for an already-provisioned brand just
// resends the link.
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

  // Find an existing account for this email.
  const { data: existing } = await sb.from('users').select('id').eq('email', email).maybeSingle()

  let userId: string
  let emailKind: 'invite' | 'reset'
  if (existing) {
    userId = (existing as { id: string }).id
    // Known account → send a set/replace-password email.
    const { error: resetErr } = await sb.auth.resetPasswordForEmail(email, { redirectTo: SET_PASSWORD_URL })
    if (resetErr) return err(resetErr.message, 500)
    emailKind = 'reset'
  } else {
    // New account → invite (creates the user AND sends the set-password link).
    const { data: invited, error: inviteErr } = await sb.auth.admin.inviteUserByEmail(email, { redirectTo: SET_PASSWORD_URL })
    if (inviteErr || !invited?.user) return err(inviteErr?.message ?? 'Could not send the invite', 500)
    userId = invited.user.id
    emailKind = 'invite'
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

  return ok({ provisioned: true, email, emailKind })
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
