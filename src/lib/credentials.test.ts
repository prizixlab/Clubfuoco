import { beforeAll, describe, expect, it } from 'vitest'
import crypto from 'crypto'

// The master key has to exist before the module reads it, and these tests must
// not depend on a developer's real .env.local.
beforeAll(() => {
  process.env.CREDENTIAL_MASTER_KEY = crypto.randomBytes(32).toString('base64')
})

const load = async () => import('./credentials')

describe('credential sealing', () => {
  it('round-trips a key', async () => {
    const { sealSecret, openSecret } = await load()
    const key = 'fv_live_9c1f4b2ea77d4e0b8a3c5d6e7f801234'
    const { iv, ciphertext } = sealSecret(key)
    expect(ciphertext).not.toContain(key)
    expect(openSecret(iv, ciphertext)).toBe(key)
  })

  it('produces a different ciphertext each time', async () => {
    const { sealSecret } = await load()
    // A fresh IV per seal, so two promoters with the same key (or one key
    // re-submitted) do not produce identical rows that reveal the collision.
    const a = sealSecret('ABCDE12345XYZ')
    const b = sealSecret('ABCDE12345XYZ')
    expect(a.ciphertext).not.toBe(b.ciphertext)
    expect(a.iv).not.toBe(b.iv)
  })

  it('returns null on a tampered ciphertext rather than garbage', async () => {
    const { sealSecret, openSecret } = await load()
    const { iv, ciphertext } = sealSecret('P6J21FF2S-example-key')
    // Flip one hex digit in the body. GCM must reject it.
    const flipped = (ciphertext[0] === 'a' ? 'b' : 'a') + ciphertext.slice(1)
    expect(openSecret(iv, flipped)).toBeNull()
  })

  it('returns null when decrypted under a different master key', async () => {
    // The guarantee behind keeping the key out of the database: a stolen dump
    // is inert. masterKey() reads the env on every call, so swapping it here is
    // enough to stand in for a leak with no key.
    const { sealSecret, openSecret } = await load()
    const sealed = sealSecret('rotate-me')
    const original = process.env.CREDENTIAL_MASTER_KEY
    try {
      process.env.CREDENTIAL_MASTER_KEY = crypto.randomBytes(32).toString('base64')
      expect(openSecret(sealed.iv, sealed.ciphertext)).toBeNull()
    } finally {
      process.env.CREDENTIAL_MASTER_KEY = original
    }
  })

  it('refuses a master key that is not 32 bytes', async () => {
    const { sealSecret } = await load()
    const original = process.env.CREDENTIAL_MASTER_KEY
    try {
      process.env.CREDENTIAL_MASTER_KEY = Buffer.from('too short').toString('base64')
      expect(() => sealSecret('x')).toThrow(/32 bytes/)
    } finally {
      process.env.CREDENTIAL_MASTER_KEY = original
    }
  })
})

describe('credential identifiers', () => {
  it('fingerprints the same key to the same value, ignoring stray whitespace', async () => {
    const { fingerprint } = await load()
    expect(fingerprint(' abc123def456 ')).toBe(fingerprint('abc123def456'))
  })

  it('fingerprints different keys differently, and never contains the key', async () => {
    const { fingerprint } = await load()
    const key = 'ABCDE12345'
    const fp = fingerprint(key)
    expect(fp).not.toContain(key)
    expect(fp).not.toBe(fingerprint('ABCDE12346'))
    expect(fp).toHaveLength(64)
  })

  it('shows only the last four characters', async () => {
    const { last4 } = await load()
    expect(last4('fv_live_9c1f4b2ea77d4e0b_WXYZ')).toBe('WXYZ')
  })
})
