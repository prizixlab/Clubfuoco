import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { logAudit } from '@/lib/portal-audit'
import { sendCredentialIntake } from '@/lib/email'
import { createIntakeToken, intakeUrl, INTAKE_TTL_DAYS } from '@/lib/credential-intake'
import { listCredentials, type Provider, type CredentialKind } from '@/lib/credentials'
import { ok, err } from '@/lib/utils'

// GET  /api/portal/promoters/:id/credential-intake — what this promoter has now
// POST /api/portal/promoters/:id/credential-intake — email them a one-time link
//
// `:id` is a USER id, matching the fee control on the same card rather than the
// application id used by the sibling approve/reject routes. The roster emits
// rows for brands that never applied, so application_id is null for some
// promoters and cannot be the key for something every promoter needs.

const PROVIDERS: Record<Provider, { label: string; kind: CredentialKind }> = {
  fourvenues: { label: 'Fourvenues', kind: 'integrations_api' },
}

/** Addresses we invented for a partner's own account. Mail sent here reaches
 *  US, not them — see the promoter account convention. Worth refusing rather
 *  than silently mailing ourselves a link the partner never sees. */
const OUR_DOMAIN = /@clubfuoco\.com$/i

interface OwnerInfo { brandId: string | null; name: string; email: string | null }

async function resolveOwner(
  sb: Awaited<ReturnType<typeof createServiceClient>>,
  userId: string,
): Promise<OwnerInfo | null> {
  const { data: user } = await sb
    .from('users').select('id, full_name, email').eq('id', userId).maybeSingle()
  if (!user) return null
  const u = user as { full_name: string | null; email: string | null }

  // The credential belongs to the BRAND, not the person: a brand outlives the
  // individual whose login happens to own it today.
  const { data: brand } = await sb
    .from('partner_brands')
    .select('id, name, login_email')
    .eq('owner_user_id', userId)
    .maybeSingle()
  const b = brand as { id: string; name: string; login_email: string | null } | null

  return {
    brandId: b?.id ?? null,
    name: b?.name ?? u.full_name ?? 'this promoter',
    email: b?.login_email ?? u.email ?? null,
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params
  const sb = await createServiceClient()

  const owner = await resolveOwner(sb, id)
  if (!owner) return err('Promoter not found', 404)

  const provider = (req.nextUrl.searchParams.get('provider') ?? 'fourvenues') as Provider
  if (!PROVIDERS[provider]) return err('Unknown provider')

  const credentials = owner.brandId
    ? await listCredentials(sb, { ownerType: 'brand', ownerId: owner.brandId, provider })
    : []

  // Is a link already out there? The operator needs to know before sending a
  // second one, since minting a new link silently kills the first.
  let pending: { sent_to: string | null; expires_at: string; created_at: string } | null = null
  if (owner.brandId) {
    const { data } = await sb
      .from('credential_intake_tokens')
      .select('sent_to, expires_at, created_at')
      .eq('owner_type', 'brand').eq('owner_id', owner.brandId).eq('provider', provider)
      .is('used_at', null).is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .maybeSingle()
    pending = data as typeof pending
  }

  return ok({
    provider,
    provider_label: PROVIDERS[provider].label,
    brand_id: owner.brandId,
    name: owner.name,
    suggested_email: owner.email,
    email_is_ours: owner.email ? OUR_DOMAIN.test(owner.email) : false,
    ttl_days: INTAKE_TTL_DAYS,
    credentials,
    pending_intake: pending,
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const provider = (body.provider ?? 'fourvenues') as Provider
  const meta = PROVIDERS[provider]
  if (!meta) return err('Unknown provider')

  const sb = await createServiceClient()
  const owner = await resolveOwner(sb, id)
  if (!owner) return err('Promoter not found', 404)

  // A credential needs a brand to hang off. Provisioning one is a different
  // deliberate act, so say that rather than inventing an owner.
  if (!owner.brandId) {
    return err('This promoter has no brand yet — provision one before requesting a key')
  }

  const to = (typeof body.email === 'string' ? body.email : owner.email ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return err('A valid email address is required')

  // The stored address is often <name>@clubfuoco.com, which is OURS. Sending
  // there mails ourselves and the partner waits for a link that never came.
  // Overridable, because a real contact at that domain is conceivable.
  if (OUR_DOMAIN.test(to) && body.confirm_our_domain !== true) {
    return err(
      `${to} is a Club Fuoco address, so the link would come back to us rather than reach ${owner.name}. Send it to their real contact, or confirm to override.`,
    )
  }

  const { token, expiresAt } = await createIntakeToken(sb, {
    ownerType: 'brand',
    ownerId: owner.brandId,
    provider,
    kind: meta.kind,
    displayName: owner.name,
    sentTo: to,
    createdBy: 'portal',
  })

  const link = intakeUrl(token)
  const sent = await sendCredentialIntake({
    to,
    displayName: owner.name,
    providerLabel: meta.label,
    link,
    expiresAt,
  })

  await logAudit(sb, {
    action: 'credential.intake_sent',
    summary: `Sent “${owner.name}” a ${meta.label} API key intake link (${to})${sent ? '' : ' — EMAIL NOT SENT'}`,
    target_type: 'brand',
    target_id: owner.brandId,
    meta: { provider, to, emailSent: sent, expiresAt },
  })

  // The link is returned ONLY when email failed, so an operator with no Resend
  // configured can still hand it over another way. On success it stays out of
  // the response: fewer copies of a live credential URL in browser history and
  // logs is strictly better.
  return ok({
    sent,
    email: to,
    expires_at: expiresAt,
    link: sent ? undefined : link,
  })
}
