import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { sealEntry, type SealedEntry } from './door-crypto'

// The offline night pack's whole premise is that it is useless without the
// physical QR: `GET /api/door/night` is unauthenticated for club nights, so the
// response is public by design and only the sealing keeps guest identities in.
//
// That premise was false. `token_ref` shipped in the clear as an "opaque row
// ref; safe to expose" — but a guestlist entry's token_ref is `pg_<guestId>`,
// and promoter_guests.id IS the secret the QR encodes and the key is derived
// from. Measured against production before the fix: 46 of 46 guests on a real
// club night decrypted from an unauthenticated fetch, no credentials at all.
//
// These tests are the standing guard. The first one is the attack, verbatim.

const HKDF_INFO = 'fuoco-door-v1'

/** Open an entry the way the door does, given the scanned token. */
function open(entry: SealedEntry, token: string): unknown {
  const salt = Buffer.from(entry.salt, 'hex')
  const out = Buffer.from(
    crypto.hkdfSync('sha256', Buffer.from(token, 'utf8'), salt, Buffer.from(HKDF_INFO), 64),
  )
  const gcm = (key: Buffer, ivHex: string, ctHex: string) => {
    const ct = Buffer.from(ctHex, 'hex')
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
    d.setAuthTag(ct.subarray(ct.length - 16))
    return Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()])
  }
  const ck = gcm(out.subarray(32, 64), entry.wrap_iv, entry.wrap)
  return JSON.parse(gcm(ck, entry.blob_iv, entry.blob).toString())
}

const GUEST_ID = '0b6b8687-0f84-46cb-b139-35e61f0ec40a'

function guestEntry(): SealedEntry {
  return sealEntry({
    strongToken: GUEST_ID,          // the uuid IS the scanned secret
    legacyToken: null,
    payload: {
      holder_name: 'Renata Solà',
      holder_avatar_url: null,
      kind: 'guestlist',
      entitlement: { label: 'Guestlist +1', count: 2, extras: [] },
    },
    allowed: 2,
    used: 0,
    billable: false,
    tokenRef: `pg_${GUEST_ID}`,
  })[0]
}

describe('night pack sealing', () => {
  it('cannot be opened from the pack alone', () => {
    const entry = guestEntry()

    // Everything an attacker gets from an unauthenticated GET.
    const wire = JSON.stringify(entry)

    // The secret must not be recoverable from any field, in any form.
    expect(wire).not.toContain(GUEST_ID)
    expect(wire).not.toContain('Renata')
    // …including with the `pg_` prefix stripped, which is all the old attack was.
    for (const value of Object.values(entry)) {
      if (typeof value === 'string') {
        expect(value.replace(/^pg_/, '')).not.toBe(GUEST_ID)
      }
    }
  })

  it('still opens for someone holding the QR', () => {
    const opened = open(guestEntry(), GUEST_ID) as Record<string, unknown>
    expect(opened.holder_name).toBe('Renata Solà')
    // token_ref rides inside the envelope now — the door needs it to admit and
    // to void, and this is the moment it has earned it.
    expect(opened.token_ref).toBe(`pg_${GUEST_ID}`)
  })

  it('fails closed on a tampered blob rather than returning garbage', () => {
    const entry = guestEntry()
    const flipped = { ...entry, blob: (entry.blob.startsWith('a') ? 'b' : 'a') + entry.blob.slice(1) }
    expect(() => open(flipped, GUEST_ID)).toThrow()
  })

  it('leaves the counting fields readable — they identify nobody', () => {
    const entry = guestEntry()
    expect(entry.allowed).toBe(2)
    expect(entry.used).toBe(0)
    expect(entry.billable).toBe(false)
  })
})
