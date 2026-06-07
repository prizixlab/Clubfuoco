import crypto from 'crypto'

// Public reference code shown on the Rumbalist confirmation screen + Wallet
// pass. 8 chars from a 36-char alphabet → 36^8 ≈ 2.8 trillion combinations,
// so collisions are vanishingly rare even at millions of bookings. The server
// retries on the rare unique-constraint hit, guaranteeing every booking gets
// a code no other booking has.

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function generateReferenceCode(): string {
  const buf = crypto.randomBytes(8)
  let out = ''
  for (let i = 0; i < 8; i++) {
    out += ALPHABET[buf[i] % 36]
  }
  return `CF-${out}`
}
