import { describe, it, expect } from 'vitest'
import { isLeakyGooglePhoto, toProxyPhotoUrl } from './photo-url'

const leaky = 'https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=AaVGc3k7REF&key=AIzaSyDiux'

describe('isLeakyGooglePhoto', () => {
  it('flags a Google photo URL carrying a key', () => {
    expect(isLeakyGooglePhoto(leaky)).toBe(true)
  })
  it('ignores a proxy path, a Supabase URL, and non-strings', () => {
    expect(isLeakyGooglePhoto('/api/places/photo?ref=X&maxwidth=800')).toBe(false)
    expect(isLeakyGooglePhoto('https://x.supabase.co/storage/v1/object/public/venue-photos/a.jpg')).toBe(false)
    expect(isLeakyGooglePhoto(null)).toBe(false)
    expect(isLeakyGooglePhoto(undefined)).toBe(false)
  })
})

describe('toProxyPhotoUrl', () => {
  it('strips the key, keeping ref and maxwidth', () => {
    expect(toProxyPhotoUrl(leaky)).toBe('/api/places/photo?ref=AaVGc3k7REF&maxwidth=800')
  })
  it('defaults maxwidth when absent', () => {
    const u = 'https://maps.googleapis.com/maps/api/place/photo?photo_reference=REF&key=K'
    expect(toProxyPhotoUrl(u)).toBe('/api/places/photo?ref=REF&maxwidth=800')
  })
  it('never emits a key', () => {
    expect(toProxyPhotoUrl(leaky)).not.toMatch(/key=/)
  })
  it('passes non-Google URLs through unchanged', () => {
    const supa = 'https://x.supabase.co/storage/v1/object/public/venue-photos/a.jpg'
    expect(toProxyPhotoUrl(supa)).toBe(supa)
    expect(toProxyPhotoUrl('/api/places/photo?ref=Y&maxwidth=800')).toBe('/api/places/photo?ref=Y&maxwidth=800')
  })
  it('is idempotent — re-running does not double-transform', () => {
    expect(toProxyPhotoUrl(toProxyPhotoUrl(leaky))).toBe('/api/places/photo?ref=AaVGc3k7REF&maxwidth=800')
  })
})
