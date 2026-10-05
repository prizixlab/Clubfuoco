import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Partner API credentials ──────────────────────────────────────────────────
//
// THE POINT OF THIS FILE: every caller that needs a third-party API key asks
// `getCredential()` for it and never touches a table or an env var directly.
//
// That indirection is the whole architecture. Storage can move — env var today,
// encrypted rows tomorrow, a real secret manager later — and only this file
// changes. A Fourvenues client written against `promoter_profiles.some_key`
// would pin us to one shape and scatter the secret across call sites.
//
// The secret is also never handed back to a browser. Nothing in here returns
// plaintext to an API response; `describe*` functions exist for that, and they
// deliberately cannot see it.

export type Provider = 'fourvenues'
export type CredentialKind = 'integrations_api' | 'channel_manager'
export type OwnerType = 'promoter' | 'brand' | 'club' | 'platform'

export type CredentialStatus = 'pending' | 'active' | 'failed' | 'revoked' | 'expired'

/** Metadata only. Safe to return from an API, safe to log. */
export interface CredentialRecord {
  id: string
  owner_type: OwnerType
  owner_id: string | null
  provider: Provider
  kind: CredentialKind
  label: string | null
  last4: string | null
  fingerprint: string | null
  scopes: string[]
  status: CredentialStatus
  issued_at: string | null
  expires_at: string | null
  rotate_after: string | null
  last_verified_at: string | null
  last_verified_ok: boolean | null
  last_error: string | null
  last_used_at: string | null
  notes: string | null
  created_at: string
}

const META_COLUMNS =
  'id, owner_type, owner_id, provider, kind, label, last4, fingerprint, scopes, status, ' +
  'issued_at, expires_at, rotate_after, last_verified_at, last_verified_ok, last_error, ' +
  'last_used_at, notes, created_at'

/** Days before we ask for a rotation, matching what the partner letter promises. */
export const DEFAULT_ROTATE_DAYS = 90

type SB = SupabaseClient

// ── Crypto ───────────────────────────────────────────────────────────────────
// AES-256-GCM. The master key lives in CREDENTIAL_MASTER_KEY (base64, 32 bytes)
// and never in the database, so a table dump on its own decrypts nothing.
//
// Generate one with:  openssl rand -base64 32

const KEY_VERSION = 1

function masterKey(): Buffer {
  const raw = process.env.CREDENTIAL_MASTER_KEY
  if (!raw) {
    throw new Error(
      'CREDENTIAL_MASTER_KEY is not set — cannot read or write partner credentials',
    )
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error('CREDENTIAL_MASTER_KEY must be 32 bytes, base64-encoded')
  }
  return key
}

/** Exported for the round-trip test — the storage path must never be the only
 *  place this is exercised, since a silent decrypt failure reads as "no key". */
export function sealSecret(plaintext: string): { iv: string; ciphertext: string } {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', masterKey(), iv)
  const out = Buffer.concat([c.update(plaintext, 'utf8'), c.final(), c.getAuthTag()])
  return { iv: iv.toString('hex'), ciphertext: out.toString('hex') }
}

export function openSecret(iv: string, ciphertext: string): string | null {
  try {
    const buf = Buffer.from(ciphertext, 'hex')
    if (buf.length <= 16) return null
    const d = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'hex'))
    d.setAuthTag(buf.subarray(buf.length - 16))
    return Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString('utf8')
  } catch {
    // Wrong master key, or tampered ciphertext. Fail closed and silent — the
    // caller gets "no credential", which is the safe reading either way.
    return null
  }
}

/** Stable id for a secret that is not the secret. Lets us spot a re-send of the
 *  same key without ever comparing plaintext. */
export const fingerprint = (secret: string) =>
  crypto.createHash('sha256').update(secret.trim()).digest('hex')

/** All the portal is ever allowed to show. */
export const last4 = (secret: string) => secret.trim().slice(-4)

// ── Reading ──────────────────────────────────────────────────────────────────

interface Lookup {
  provider: Provider
  ownerType?: OwnerType
  ownerId?: string | null
  kind?: CredentialKind
}

function ownerFilter<T>(q: T, l: Lookup): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let out = (q as any).eq('provider', l.provider)
  if (l.kind) out = out.eq('kind', l.kind)
  out = out.eq('owner_type', l.ownerType ?? 'brand')
  out = l.ownerId ? out.eq('owner_id', l.ownerId) : out.is('owner_id', null)
  return out as T
}

/**
 * The secret, or null.
 *
 * Falls back to an env var for platform-level keys, so our OWN Channel Manager
 * key can be configured the ordinary way (FOURVENUES_API_KEY) before any of the
 * table below exists. Callers never learn which path answered.
 */
export async function getCredential(
  sb: SB,
  lookup: Lookup,
): Promise<{ secret: string; record: CredentialRecord } | null> {
  const { data } = await ownerFilter(
    sb.from('partner_credentials').select(META_COLUMNS),
    lookup,
  )
    .eq('status', 'active')
    .maybeSingle()

  const record = data as CredentialRecord | null

  if (!record) {
    const fromEnv = envFallback(lookup)
    if (!fromEnv) return null
    return { secret: fromEnv, record: syntheticEnvRecord(lookup, fromEnv) }
  }

  const { data: sec } = await sb
    .from('partner_credential_secrets')
    .select('iv, ciphertext')
    .eq('credential_id', record.id)
    .maybeSingle()
  if (!sec) return null

  const secret = openSecret((sec as { iv: string }).iv, (sec as { ciphertext: string }).ciphertext)
  if (!secret) return null

  // Best-effort touch. Never block a live API call on bookkeeping.
  void sb.from('partner_credentials')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', record.id)

  return { secret, record }
}

/** Platform-level keys may come from the environment — our own, not a partner's. */
function envFallback(l: Lookup): string | null {
  if ((l.ownerType ?? 'brand') !== 'platform') return null
  if (l.provider === 'fourvenues') return process.env.FOURVENUES_API_KEY ?? null
  return null
}

function syntheticEnvRecord(l: Lookup, secret: string): CredentialRecord {
  return {
    id: `env:${l.provider}`,
    owner_type: 'platform', owner_id: null,
    provider: l.provider, kind: l.kind ?? 'channel_manager',
    label: `${l.provider} (environment)`,
    last4: last4(secret), fingerprint: fingerprint(secret),
    scopes: [], status: 'active',
    issued_at: null, expires_at: null, rotate_after: null,
    last_verified_at: null, last_verified_ok: null, last_error: null,
    last_used_at: null, notes: null, created_at: new Date(0).toISOString(),
  }
}

/** Metadata for the portal. Cannot return a secret — there is no path to one. */
export async function listCredentials(
  sb: SB,
  filter: { ownerType?: OwnerType; ownerId?: string | null; provider?: Provider } = {},
): Promise<CredentialRecord[]> {
  let q = sb.from('partner_credentials').select(META_COLUMNS)
  if (filter.provider) q = q.eq('provider', filter.provider)
  if (filter.ownerType) q = q.eq('owner_type', filter.ownerType)
  if (filter.ownerId !== undefined) {
    q = filter.ownerId ? q.eq('owner_id', filter.ownerId) : q.is('owner_id', null)
  }
  const { data, error } = await q.order('created_at', { ascending: false })
  // Drift-defensive: the migration is applied by hand, and a portal screen must
  // not 500 because it hasn't been run yet.
  if (error) {
    if (/does not exist|relation|schema cache/i.test(error.message)) return []
    throw new Error(error.message)
  }
  // Cast through unknown: these tables land in a manual migration, so they are
  // not in the generated Database types and PostgREST's inference gives up.
  return (data ?? []) as unknown as CredentialRecord[]
}

// ── Writing ──────────────────────────────────────────────────────────────────

/**
 * Store a secret, replacing whatever that owner had for this provider.
 *
 * Supersede rather than overwrite: the old row is marked 'revoked' and kept, so
 * "which key was live when that ticket was created" stays answerable. Its
 * ciphertext goes, because a revoked secret is a liability with no use.
 */
export async function storeCredential(
  sb: SB,
  args: {
    ownerType: OwnerType
    ownerId: string | null
    provider: Provider
    kind: CredentialKind
    secret: string
    label?: string | null
    expiresAt?: string | null
    scopes?: string[]
    notes?: string | null
    createdBy?: string | null
  },
): Promise<CredentialRecord> {
  const secret = args.secret.trim()
  if (!secret) throw new Error('Empty secret')

  // Encrypt BEFORE touching the database. A thrown missing-master-key here
  // leaves no half-written row behind.
  const { iv, ciphertext } = sealSecret(secret)

  const now = new Date()
  const rotate = new Date(now.getTime() + DEFAULT_ROTATE_DAYS * 86_400_000)

  // Retire any live row for this owner+provider+kind (the partial unique index
  // permits exactly one, so this is what makes a re-submission work).
  const existing = await ownerFilter(
    sb.from('partner_credentials').select('id'),
    { provider: args.provider, kind: args.kind, ownerType: args.ownerType, ownerId: args.ownerId },
  ).in('status', ['pending', 'active', 'failed'])

  for (const row of (existing.data ?? []) as { id: string }[]) {
    await sb.from('partner_credentials')
      .update({ status: 'revoked', updated_at: now.toISOString() })
      .eq('id', row.id)
    await sb.from('partner_credential_secrets').delete().eq('credential_id', row.id)
  }

  const { data, error } = await sb
    .from('partner_credentials')
    .insert({
      owner_type: args.ownerType,
      owner_id: args.ownerId,
      provider: args.provider,
      kind: args.kind,
      label: args.label ?? null,
      fingerprint: fingerprint(secret),
      last4: last4(secret),
      scopes: args.scopes ?? [],
      status: 'active',
      issued_at: now.toISOString(),
      expires_at: args.expiresAt ?? null,
      rotate_after: rotate.toISOString(),
      notes: args.notes ?? null,
      created_by: args.createdBy ?? null,
    })
    .select(META_COLUMNS)
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Could not store credential')

  const record = data as unknown as CredentialRecord
  const { error: secErr } = await sb
    .from('partner_credential_secrets')
    .insert({ credential_id: record.id, iv, ciphertext, key_version: KEY_VERSION })
  if (secErr) {
    // Metadata with no secret is worse than nothing: it would read as an active
    // credential and fail at the worst moment. Roll it back.
    await sb.from('partner_credentials').delete().eq('id', record.id)
    throw new Error(secErr.message)
  }

  return record
}

/** Record the outcome of a health check. Called by the verify sweep. */
export async function markVerification(
  sb: SB,
  credentialId: string,
  result: { ok: boolean; error?: string | null; scopes?: string[] },
): Promise<void> {
  const patch: Record<string, unknown> = {
    last_verified_at: new Date().toISOString(),
    last_verified_ok: result.ok,
    last_error: result.ok ? null : (result.error ?? 'Verification failed'),
    updated_at: new Date().toISOString(),
  }
  // A key that starts failing stops us selling that promoter's nights BEFORE we
  // take money. Recovery is automatic: the next good check flips it back.
  if (result.ok) patch.status = 'active'
  else patch.status = 'failed'
  if (result.scopes) patch.scopes = result.scopes
  try {
    await sb.from('partner_credentials').update(patch).eq('id', credentialId)
  } catch {
    // advisory
  }
}

export async function revokeCredential(sb: SB, credentialId: string): Promise<void> {
  await sb.from('partner_credentials')
    .update({ status: 'revoked', updated_at: new Date().toISOString() })
    .eq('id', credentialId)
  await sb.from('partner_credential_secrets').delete().eq('credential_id', credentialId)
}

/** True when this owner can currently transact with this provider. The events
 *  feed uses it to hide nights we could take money for but not fulfil. */
export async function credentialHealthy(sb: SB, lookup: Lookup): Promise<boolean> {
  // Revoked rows are KEPT as history, so an owner accumulates several rows for
  // the same provider over time. A bare maybeSingle() here throws the moment a
  // key is rotated for the first time — filter to the live statuses, which the
  // partial unique index guarantees is at most one.
  const { data } = await ownerFilter(
    sb.from('partner_credentials').select('status'),
    lookup,
  ).in('status', ['pending', 'active', 'failed']).maybeSingle()
  const status = (data as { status?: string } | null)?.status
  if (status) return status === 'active'
  return !!envFallback(lookup)
}
