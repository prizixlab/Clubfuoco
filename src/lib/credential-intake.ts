import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CredentialKind, OwnerType, Provider } from '@/lib/credentials'

// ── One-time credential intake links ─────────────────────────────────────────
//
// The partner letter promises this in as many words: "we'll send a one-time
// link that expires on use." The alternative is a partner pasting an API key
// into email or WhatsApp, where it then lives forever in two companies'
// mailboxes and any number of backups. This is the thing that lets us tell them
// not to do that.
//
// Only the SHA-256 of the token is stored. The emailed URL is the one copy in
// existence, so a leak of this table cannot be replayed into a submission —
// same reasoning as door_devices.token_hash.

const TOKEN_BYTES = 32           // 256-bit; this URL is the only authentication
export const INTAKE_TTL_DAYS = 7

export const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex')

export interface IntakeContext {
  id: string
  ownerType: OwnerType
  ownerId: string | null
  provider: Provider
  kind: CredentialKind
  displayName: string | null
  sentTo: string | null
  expiresAt: string
}

type SB = SupabaseClient

/**
 * Mint a link. Returns the raw token exactly once — it is never recoverable
 * afterwards, so a lost link is re-sent by minting a new one, not by looking
 * the old one up.
 */
export async function createIntakeToken(
  sb: SB,
  args: {
    ownerType: OwnerType
    ownerId: string | null
    provider: Provider
    kind: CredentialKind
    displayName?: string | null
    sentTo?: string | null
    createdBy?: string | null
  },
): Promise<{ token: string; expiresAt: string }> {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url')
  const expiresAt = new Date(Date.now() + INTAKE_TTL_DAYS * 86_400_000).toISOString()

  // Supersede any link still outstanding for this owner+provider. Two live
  // links means two people can set the key and the second silently wins, which
  // is exactly the confusion this flow exists to avoid.
  let stale = sb.from('credential_intake_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('owner_type', args.ownerType)
    .eq('provider', args.provider)
    .is('used_at', null)
    .is('revoked_at', null)
  stale = args.ownerId ? stale.eq('owner_id', args.ownerId) : stale.is('owner_id', null)
  await stale

  const { error } = await sb.from('credential_intake_tokens').insert({
    token_hash: hashToken(token),
    owner_type: args.ownerType,
    owner_id: args.ownerId,
    provider: args.provider,
    kind: args.kind,
    display_name: args.displayName ?? null,
    sent_to: args.sentTo ?? null,
    expires_at: expiresAt,
    created_by: args.createdBy ?? null,
  })
  if (error) throw new Error(error.message)

  return { token, expiresAt }
}

/**
 * Resolve a token from the URL. Returns null for unknown, used, revoked or
 * expired — deliberately one indistinguishable answer, so the page cannot be
 * used to probe which tokens ever existed.
 */
export async function resolveIntakeToken(sb: SB, token: string): Promise<IntakeContext | null> {
  if (!token || token.length < 20) return null

  const { data } = await sb
    .from('credential_intake_tokens')
    .select('id, owner_type, owner_id, provider, kind, display_name, sent_to, expires_at, used_at, revoked_at')
    .eq('token_hash', hashToken(token))
    .maybeSingle()
  if (!data) return null

  const row = data as {
    id: string; owner_type: OwnerType; owner_id: string | null
    provider: Provider; kind: CredentialKind
    display_name: string | null; sent_to: string | null
    expires_at: string; used_at: string | null; revoked_at: string | null
  }
  if (row.used_at || row.revoked_at) return null
  if (new Date(row.expires_at).getTime() < Date.now()) return null

  return {
    id: row.id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    provider: row.provider,
    kind: row.kind,
    displayName: row.display_name,
    sentTo: row.sent_to,
    expiresAt: row.expires_at,
  }
}

/**
 * Burn the link.
 *
 * Conditional on used_at still being null, so two submissions racing each other
 * cannot both win — the loser is told the link is spent rather than quietly
 * overwriting the key the winner just set.
 */
export async function consumeIntakeToken(
  sb: SB,
  intakeId: string,
  credentialId: string,
): Promise<boolean> {
  const { data } = await sb
    .from('credential_intake_tokens')
    .update({ used_at: new Date().toISOString(), credential_id: credentialId })
    .eq('id', intakeId)
    .is('used_at', null)
    .select('id')
    .maybeSingle()
  return !!data
}

export function intakeUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://clubfuoco.com'
  return `${base}/credentials/${token}`
}
