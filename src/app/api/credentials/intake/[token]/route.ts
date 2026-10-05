import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { logAudit } from '@/lib/portal-audit'
import { resolveIntakeToken, consumeIntakeToken } from '@/lib/credential-intake'
import { storeCredential } from '@/lib/credentials'
import { ok, err } from '@/lib/utils'

// GET  /api/credentials/intake/:token — is this link live, and who is it for?
// POST /api/credentials/intake/:token — submit the key, burn the link
//
// Deliberately UNauthenticated: the recipient is a partner with no Club Fuoco
// account, and the 256-bit single-use token IS the authentication. Same posture
// as the promoter-invite claim endpoint, with a shorter fuse.
//
// Nothing here ever reads a secret back out. The only direction is in.

const PROVIDER_LABEL: Record<string, string> = { fourvenues: 'Fourvenues' }

// Long enough to catch a truncated paste, loose enough not to guess at a format
// nobody has published. Fourvenues' docs show examples but no charset contract,
// so rejecting on shape would be inventing a rule they never stated.
const MIN_KEY_LEN = 12
const MAX_KEY_LEN = 512

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const sb = await createServiceClient()
  const ctx = await resolveIntakeToken(sb, token)
  // One answer for unknown / used / revoked / expired, so this can't be used to
  // enumerate which tokens ever existed.
  if (!ctx) return err('This link is no longer valid', 404)

  return ok({
    provider: ctx.provider,
    provider_label: PROVIDER_LABEL[ctx.provider] ?? ctx.provider,
    kind: ctx.kind,
    display_name: ctx.displayName,
    expires_at: ctx.expiresAt,
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const body = await req.json().catch(() => ({}))

  const secret = typeof body.key === 'string' ? body.key.trim() : ''
  if (!secret) return err('Paste your API key to continue')
  if (secret.length < MIN_KEY_LEN) return err('That looks too short to be an API key')
  if (secret.length > MAX_KEY_LEN) return err('That looks too long to be an API key')

  // An optional expiry the partner may know from their own portal. Free text is
  // useless to a sweep, so anything unparseable is dropped rather than stored.
  let expiresAt: string | null = null
  if (typeof body.expires_at === 'string' && body.expires_at.trim()) {
    const d = new Date(body.expires_at)
    if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now()) expiresAt = d.toISOString()
  }
  const label = typeof body.label === 'string' && body.label.trim()
    ? body.label.trim().slice(0, 120)
    : null

  const sb = await createServiceClient()
  const ctx = await resolveIntakeToken(sb, token)
  if (!ctx) return err('This link is no longer valid', 404)

  let credentialId: string
  try {
    const record = await storeCredential(sb, {
      ownerType: ctx.ownerType,
      ownerId: ctx.ownerId,
      provider: ctx.provider,
      kind: ctx.kind,
      secret,
      label: label ?? `${PROVIDER_LABEL[ctx.provider] ?? ctx.provider} key`,
      expiresAt,
      notes: ctx.displayName ? `Submitted by ${ctx.displayName}` : null,
      createdBy: 'intake',
    })
    credentialId = record.id
  } catch (e) {
    // The most likely cause is a missing CREDENTIAL_MASTER_KEY, which is ours to
    // fix and not something to explain to a partner. Don't burn their link over
    // our misconfiguration — they can retry the same URL once we've fixed it.
    console.error('[credential-intake] store failed:', e)
    return err('We could not store that key just now. Please try again shortly.', 500)
  }

  // Burn the link AFTER the key is safely stored. Conditional on it still being
  // unused, so a double-submit can't overwrite what the first one saved.
  const burned = await consumeIntakeToken(sb, ctx.id, credentialId)
  if (!burned) {
    return err('This link has already been used', 409)
  }

  await logAudit(sb, {
    action: 'credential.received',
    summary: `Received a ${PROVIDER_LABEL[ctx.provider] ?? ctx.provider} API key from “${ctx.displayName ?? 'partner'}”`,
    target_type: ctx.ownerType,
    target_id: ctx.ownerId ?? undefined,
    meta: { provider: ctx.provider, credential_id: credentialId, has_expiry: !!expiresAt },
  })

  return ok({ received: true })
}
