import { describe, it, expect } from 'vitest'
import {
  classifyVenue, venueShouldBeVisible, activeAfterBackfill,
  nameMatch, distanceMeters,
} from './venue-classify'

describe('classifyVenue', () => {
  it('tags bars and clubs as nightlife', () => {
    expect(classifyVenue(['night_club', 'point_of_interest'])).toBe('nightlife')
    expect(classifyVenue(['bar'])).toBe('nightlife')
  })
  it('tags a real non-nightlife category', () => {
    expect(classifyVenue(['restaurant', 'food'])).toBe('non_nightlife')
  })
  it('treats generic-only types as unknown', () => {
    expect(classifyVenue(['establishment', 'point_of_interest'])).toBe('unknown')
    expect(classifyVenue([])).toBe('unknown')
  })
})

describe('activeAfterBackfill', () => {
  it('never demotes a venue that is already live', () => {
    // Negro Rojo: human-curated active, Google types it restaurant.
    expect(activeAfterBackfill(true, ['restaurant', 'food'])).toBe(true)
    expect(venueShouldBeVisible(['restaurant'])).toBe(false)  // the old logic WOULD have hidden it
  })
  it('promotes a hidden venue that is confirmed nightlife', () => {
    expect(activeAfterBackfill(false, ['night_club'])).toBe(true)
  })
  it('leaves a hidden non-nightlife venue hidden', () => {
    expect(activeAfterBackfill(false, ['restaurant'])).toBe(false)
  })
  it('leaves a hidden unknown venue hidden (no evidence to promote on)', () => {
    expect(activeAfterBackfill(false, ['establishment'])).toBe(false)
  })
})

describe('nameMatch', () => {
  it('strong: accent/punctuation-insensitive exact or prefix', () => {
    expect(nameMatch("L'Electricitat", 'Bar Electricitat')).toBe('strong')
    expect(nameMatch('La Unión', 'La Union')).toBe('strong')
    expect(nameMatch('Bitacora', 'Bar Bitàcora')).toBe('strong')        // exact after accent strip
  })
  it('fuzzy: one edit away — needs proximity to confirm', () => {
    expect(nameMatch('Albaycin', 'Albayzín Cervecería')).toBe('fuzzy')  // c↔z mid-word
    expect(nameMatch('Xiloca', 'Xiloka BCN Bar Restaurant')).toBe('fuzzy') // c↔k mid-word
  })
  it('none: genuinely different venues', () => {
    expect(nameMatch('Bar Chivago', 'Three Dots and a Dash')).toBe('none')
    expect(nameMatch('Bar Benuga', 'Behaus Café & Bistró')).toBe('none')
    expect(nameMatch('Bar Los Amigos', 'Granja els Amics')).toBe('none')
  })
  it('does not match on a generic word alone', () => {
    expect(nameMatch('Bar Lobo', 'Bar Electricitat')).toBe('none')
  })
})

describe('distanceMeters', () => {
  it('is ~0 for the same point', () => {
    const p = { lat: 41.3909, lng: 2.1353 }
    expect(distanceMeters(p, p)).toBeLessThan(1)
  })
  it('measures a known short hop', () => {
    // ~1.1km across Barcelona centre; allow slack.
    const d = distanceMeters({ lat: 41.3874, lng: 2.1686 }, { lat: 41.3809, lng: 2.1228 })
    expect(d).toBeGreaterThan(3000)
    expect(d).toBeLessThan(4500)
  })
})
