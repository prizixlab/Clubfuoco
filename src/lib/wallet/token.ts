import crypto from 'crypto'

const SECRET = process.env.WALLET_TOKEN_SECRET ?? 'dev-wallet-secret-change-me'

/**
 * Generate a deterministic 32-char hex auth token for a user's wallet pass.
 * Stored in the pass JSON as `authenticationToken`; Apple echoes it back
 * in the `Authorization: ApplePass <token>` header on every registration call.
 */
export function generateWalletToken(userId: string): string {
  return crypto
    .createHmac('sha256', SECRET)
    .update(userId)
    .digest('hex')
    .slice(0, 32)
}

/**
 * Validate the token Apple sent and return true if it matches the userId.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function validateWalletToken(token: string, userId: string): boolean {
  const expected = generateWalletToken(userId)
  if (token.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
}

/**
 * Extract userId from serial number (format: "membership-{userId}").
 * Returns null if the format doesn't match.
 */
export function userIdFromSerial(serialNumber: string): string | null {
  const prefix = 'membership-'
  if (!serialNumber.startsWith(prefix)) return null
  const id = serialNumber.slice(prefix.length)
  return id.length > 0 ? id : null
}
