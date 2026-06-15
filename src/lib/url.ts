// Same-origin redirect guard. Auth flows accept a `?next=` hint so we can send
// the user back where they started (e.g. /join/ABC123). An attacker who can set
// `next` could otherwise turn our login into an open redirect — so we ONLY ever
// honour a plain, same-origin absolute path.
//
// Rejected: anything not starting with "/", protocol-relative "//evil.com",
// backslash tricks "/\evil.com", and any control/whitespace characters.
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  if (!raw.startsWith('/')) return null
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null
  if (/[\x00-\x1f\x7f\s]/.test(raw)) return null
  return raw
}

// Invite codes are 6 chars from generateInviteCode()'s alphabet. Normalise to
// uppercase and accept only short alphanumeric strings, so the value can't be
// used for path traversal, SQL wildcards, or oversized lookups.
export function normalizeInviteCode(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  const code = raw.trim().toUpperCase()
  return /^[A-Z0-9]{4,16}$/.test(code) ? code : null
}
