import { createHash } from 'crypto'

// ── Deferred invite links ────────────────────────────────────────────────────
//
// A Universal Link only opens the app if the app is already installed. Someone
// tapping /i/<token> without it goes: branded page → App Store → install →
// cold launch with NO token. The intent dies at the last step, and they land in
// a generic signup wizard with no idea what they were doing.
//
// Apple provides nothing for this. App Store `pt`/`ct` campaign parameters are
// not readable by the app, and IDFA-style fingerprinting is gone. Every
// solution is either EXPLICIT (the user hands us the token — the clipboard
// channel, handled on the client) or PROBABILISTIC (we guess). This file is the
// guess.
//
// THE RULE THAT MAKES A GUESS ACCEPTABLE: a handoff only ever PRE-FILLS. It
// never claims a spot, never joins a list, never spends money. The worst
// outcome of a wrong match is that someone sees an event page they didn't ask
// for and closes it. Nothing here should ever be wired to an action that has
// consequences.

/** How long a ticket stays claimable. Long enough to download an app on a bad
 *  connection, short enough that the collision window stays small. */
export const HANDOFF_TTL_MINUTES = 30

/**
 * The two sides of the match see different worlds, which constrains this
 * heavily:
 *
 *  - the WEB side is Mobile Safari, and its UA string is nothing like the app's
 *  - the APP side has no idea what the browser's UA was
 *
 * So the fingerprint can only use what BOTH can state: the server-observed IP,
 * the platform, and the iOS version — which Safari puts in its UA as
 * "CPU iPhone OS 18_5 like Mac OS X" and which the app reads from
 * UIDevice.current.systemVersion.
 *
 * That is coarse on purpose. It is not an identity and must never be treated as
 * one; two people behind the same carrier NAT on the same iOS version within
 * the TTL will collide. See the rule above for why that is survivable.
 */
export function fingerprint(ip: string, osVersion: string | null): string {
  // Peppered so the stored value isn't a reversible list of visitor IPs. Not a
  // security boundary — the table is service-role only — just hygiene.
  const pepper = process.env.INVITE_HANDOFF_SECRET ?? 'fuoco-invite-handoff-v1'
  return createHash('sha256')
    .update([pepper, ip.trim(), 'ios', osVersion ?? 'unknown'].join('|'))
    .digest('hex')
}

/**
 * "18.5" out of a Mobile Safari user-agent, or null.
 *
 * Only major.minor: iOS reports "18.5" from systemVersion while Safari's UA can
 * carry a patch segment ("18_5_1"), and a mismatch there would fail every match
 * for anyone on a point release.
 */
export function osVersionFromUA(ua: string | null): string | null {
  if (!ua) return null
  const m = ua.match(/(?:iPhone|CPU) OS (\d+)[._](\d+)/i)
  if (!m) return null
  return `${m[1]}.${m[2]}`
}

/** Same normalisation for the version the app reports, so both sides agree. */
export function normaliseOsVersion(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const m = raw.trim().match(/^(\d+)[._](\d+)/)
  return m ? `${m[1]}.${m[2]}` : null
}

/**
 * Is this request plausibly an iPhone?
 *
 * A ticket is only useful to an iOS install, and refusing to record anything
 * else keeps desktop and crawler traffic out of the match pool — every row that
 * can't match is a row that can only cause a false one.
 */
export function looksLikeIOS(ua: string | null): boolean {
  return !!ua && /iPhone|iPad|iPod/i.test(ua)
}
