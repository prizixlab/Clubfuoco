import { describe, it, expect } from 'vitest'
import {
  fingerprint, osVersionFromUA, normaliseOsVersion, looksLikeIOS,
} from './invite-handoff'

// The whole mechanism rests on two sides that never see each other producing
// the same string. Safari reports the OS one way, UIDevice another, and if they
// disagree the handoff silently never matches — no error, just an invite that
// quietly fails to survive the install. These tests pin the agreement.

const SAFARI_18_5 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'

describe('osVersionFromUA', () => {
  it('reads the version out of Mobile Safari', () => {
    expect(osVersionFromUA(SAFARI_18_5)).toBe('18.5')
  })

  it('drops the patch segment', () => {
    // Safari carries "18_5_1" on a point release while UIDevice still says
    // "18.5.1" → both must land on 18.5, or nobody on a point release ever
    // matches.
    const ua = SAFARI_18_5.replace('OS 18_5 ', 'OS 18_5_1 ')
    expect(osVersionFromUA(ua)).toBe('18.5')
  })

  it('handles an iPad and an in-app webview', () => {
    expect(osVersionFromUA('Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X)')).toBe('17.2')
    expect(osVersionFromUA(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) Instagram 300.0'
    )).toBe('18.4')
  })

  it('is null for anything that is not iOS', () => {
    expect(osVersionFromUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBeNull()
    expect(osVersionFromUA('Mozilla/5.0 (Linux; Android 14)')).toBeNull()
    expect(osVersionFromUA(null)).toBeNull()
    expect(osVersionFromUA('')).toBeNull()
  })
})

describe('normaliseOsVersion', () => {
  it('agrees with the UA parser on the same device', () => {
    // Safari's UA and UIDevice.current.systemVersion, same phone.
    expect(normaliseOsVersion('18.5')).toBe(osVersionFromUA(SAFARI_18_5))
  })

  it('drops the patch segment the same way', () => {
    expect(normaliseOsVersion('18.5.1')).toBe('18.5')
  })

  it('rejects rubbish rather than inventing a version', () => {
    expect(normaliseOsVersion('')).toBeNull()
    expect(normaliseOsVersion('nineteen')).toBeNull()
    expect(normaliseOsVersion(19)).toBeNull()
    expect(normaliseOsVersion(null)).toBeNull()
  })
})

describe('fingerprint', () => {
  it('matches across the web→app boundary for one phone', () => {
    const web = fingerprint('88.12.4.9', osVersionFromUA(SAFARI_18_5))
    const app = fingerprint('88.12.4.9', normaliseOsVersion('18.5'))
    expect(app).toBe(web)
  })

  it('separates different networks and different iOS versions', () => {
    const base = fingerprint('88.12.4.9', '18.5')
    expect(fingerprint('88.12.4.10', '18.5')).not.toBe(base)
    expect(fingerprint('88.12.4.9', '18.4')).not.toBe(base)
  })

  it('is stable under surrounding whitespace', () => {
    // x-forwarded-for arrives as "ip, proxy, proxy" and the split can leave
    // padding; an unstable fingerprint here fails silently.
    expect(fingerprint(' 88.12.4.9 ', '18.5')).toBe(fingerprint('88.12.4.9', '18.5'))
  })

  it('does not leak the IP into the stored value', () => {
    const fp = fingerprint('88.12.4.9', '18.5')
    expect(fp).not.toContain('88.12')
    expect(fp).toMatch(/^[0-9a-f]{64}$/)
  })

  it('still produces a usable key when the version is unknown', () => {
    // Coarser, so likelier to collide — but the alternative is not recording a
    // ticket at all, and a pre-fill is the only thing at stake.
    expect(fingerprint('88.12.4.9', null)).toMatch(/^[0-9a-f]{64}$/)
    expect(fingerprint('88.12.4.9', null)).not.toBe(fingerprint('88.12.4.9', '18.5'))
  })
})

describe('looksLikeIOS', () => {
  it('accepts iPhones and in-app webviews, rejects the rest', () => {
    expect(looksLikeIOS(SAFARI_18_5)).toBe(true)
    expect(looksLikeIOS('Mozilla/5.0 (iPhone) Instagram 300.0')).toBe(true)
    expect(looksLikeIOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(false)
    expect(looksLikeIOS('curl/8.4.0')).toBe(false)
    expect(looksLikeIOS(null)).toBe(false)
  })
})
