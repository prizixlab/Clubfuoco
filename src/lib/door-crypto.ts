import crypto from 'crypto'

// ── Encrypted night manifest ─────────────────────────────────────────────────
//
// GOAL: the offline cache on a door phone must be USELESS without the physical
// QR. So no master key ever reaches the device — each guest's details are sealed
// with a key derived from that guest's own scan token. Scanning supplies the
// key; nothing else does.
//
// Envelope scheme, per entry:
//   CK              = random 256-bit content key
//   blob            = AES-256-GCM(CK, guest payload)
//   wrap_new        = AES-256-GCM(K_new, CK)     K_new from HKDF(scan_token)
//   wrap_old        = AES-256-GCM(K_old, CK)     K_old from PBKDF2(CF- token)
//   lookup_new/old  = a second half of that same derived material
//
// Two wraps rather than two copies of the payload, so a legacy ticket and a new
// ticket both open the same entry without duplicating guest data.
//
// WHY the lookup id is derived from the SAME slow KDF for legacy tokens: a CF-
// code is only ~41 bits. If the lookup were a fast HMAC, an attacker holding the
// cache could brute-force the lookup space cheaply, recover the token, and then
// pay the PBKDF2 cost just once. Deriving the lookup from PBKDF2 too means the
// brute force itself costs 2^41 × PBKDF2 — infeasible. New tokens are 128-bit,
// so a fast HKDF is safe for them.

export const PBKDF2_ITERS = 120_000        // ~60-100ms on an iPhone
const HKDF_INFO = 'fuoco-door-v1'

export interface SealedEntry {
  lookup: string              // hex; how the app finds this entry from a scan
  legacy: boolean             // true → derive with PBKDF2, false → HKDF
  salt: string                // hex, per-entry
  wrap_iv: string
  wrap: string                // encrypted content key
  blob_iv: string
  blob: string                // encrypted guest payload
  allowed: number             // NOT secret — needed for counting, reveals nothing
  used: number
  billable: boolean
  token_ref: string           // opaque row ref; safe to expose
}

export interface EncryptedManifest {
  venue: string
  venue_name: string
  night: string
  issued_at: string
  server_time: string
  entries: SealedEntry[]
  scheme: 'v1'
}

/** 128-bit token, uppercase hex — QR alphanumeric-friendly, 32 chars. */
export function generateScanToken(): string {
  return crypto.randomBytes(16).toString('hex').toUpperCase()
}

/** Fast path for strong (128-bit) tokens → 64 bytes: [0..32) lookup, [32..64) key. */
function deriveStrong(token: string, salt: Buffer): { lookup: Buffer; key: Buffer } {
  const out = Buffer.from(
    crypto.hkdfSync('sha256', Buffer.from(token, 'utf8'), salt, Buffer.from(HKDF_INFO), 64),
  )
  return { lookup: out.subarray(0, 32), key: out.subarray(32, 64) }
}

/** Slow path for weak CF- codes → same 64-byte split, but brute-force-resistant. */
function deriveLegacy(token: string, salt: Buffer): { lookup: Buffer; key: Buffer } {
  const out = crypto.pbkdf2Sync(token, salt, PBKDF2_ITERS, 64, 'sha256')
  return { lookup: out.subarray(0, 32), key: out.subarray(32, 64) }
}

export function derive(token: string, salt: Buffer, legacy: boolean) {
  return legacy ? deriveLegacy(token, salt) : deriveStrong(token, salt)
}

function gcmEncrypt(key: Buffer, plaintext: Buffer): { iv: string; out: string } {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(plaintext), c.final(), c.getAuthTag()])
  return { iv: iv.toString('hex'), out: ct.toString('hex') }
}

/**
 * Seal one guest. `strongToken` is bookings.scan_token; `legacyToken` is the
 * already-issued CF- code (or a guest id) whose QR is out in the world already.
 * At least one must be present.
 */
export function sealEntry(args: {
  strongToken?: string | null
  legacyToken?: string | null
  payload: unknown
  allowed: number
  used: number
  billable: boolean
  tokenRef: string
}): SealedEntry[] {
  const ck = crypto.randomBytes(32)
  const plain = Buffer.from(JSON.stringify(args.payload), 'utf8')
  const blob = gcmEncrypt(ck, plain)

  const out: SealedEntry[] = []
  const mk = (token: string, legacy: boolean): SealedEntry => {
    const salt = crypto.randomBytes(16)
    const { lookup, key } = derive(token, salt, legacy)
    const wrap = gcmEncrypt(key, ck)
    return {
      lookup: lookup.toString('hex'),
      legacy,
      salt: salt.toString('hex'),
      wrap_iv: wrap.iv,
      wrap: wrap.out,
      blob_iv: blob.iv,
      blob: blob.out,
      allowed: args.allowed,
      used: args.used,
      billable: args.billable,
      token_ref: args.tokenRef,
    }
  }
  // Each accepted token gets its own sealed record pointing at the same payload.
  if (args.strongToken) out.push(mk(args.strongToken, false))
  if (args.legacyToken) out.push(mk(args.legacyToken, true))
  return out
}
