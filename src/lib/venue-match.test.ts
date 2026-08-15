import { describe, expect, it } from 'vitest'
import { meaningfulWords, normName, venueMatch } from './venue-match'

// Mirrors VenueMatch.runSelfChecks() in ios-native/ClubFuoco/Models/
// ExternalEvent.swift — the two implementations must agree, so every Swift
// self-check appears here too.

describe('normName', () => {
  it('lowercases and collapses punctuation to single spaces', () => {
    expect(normName('  Sala   Apolo! ')).toBe('sala apolo')
    expect(normName("Bar Blau's")).toBe('bar blau s')
  })
  it('folds diacritics so accented and plain spellings agree', () => {
    expect(normName('Montjuïc')).toBe('montjuic')
    expect(normName('Gràcia')).toBe('gracia')
    expect(normName('Cervecería')).toBe('cerveceria')
  })
  it('keeps digits', () => {
    expect(normName('Garage 442')).toBe('garage 442')
  })
})

describe('meaningfulWords', () => {
  it('drops words of 3 characters or fewer', () => {
    expect(meaningfulWords('Bar Hot Dog')).toEqual([])
  })
  it('drops stopwords but keeps the distinctive part', () => {
    expect(meaningfulWords('Skygarden Barcelona Rooftop')).toEqual(['skygarden'])
    expect(meaningfulWords('Azul Rooftop Barceloneta')).toEqual([])
  })
  it('keeps short distinctive venue names that a length rule would lose', () => {
    // 667 of 1000 club names reduce to one word, and the most recognisable
    // venues are the short ones — no minimum-length gate can be used here.
    for (const name of ['Moog', 'Apolo', 'Pacha', 'Shoko', 'Sutton']) {
      expect(meaningfulWords(name)).toEqual([name.toLowerCase()])
    }
  })
})

describe('venueMatch — rule 1: exact after normalisation', () => {
  it.each([
    ['Razzmatazz', 'Razzmatazz'],
    ['Macarena Club', 'Macarena Club'],
    ['Sala Apolo', 'sala  apolo!'],
    ['Montjuïc', 'Montjuic'],
    ['Purobeach Barcelona', 'purobeach barcelona'],
  ])('%s ~ %s', (a, b) => {
    expect(venueMatch(a, b)).toBe(true)
  })

  it('matches names made only of stopwords when they are identical', () => {
    expect(venueMatch('Beach Club', 'beach club')).toBe(true)
  })
})

describe('venueMatch — rule 2: two or more shared meaningful words', () => {
  it.each([
    ['Otto Zutz Barcelona', 'Otto Zutz Club'],
    ['Sala Apolo Nitsa', 'Apolo Nitsa Club'],
  ])('%s ~ %s', (a, b) => {
    expect(venueMatch(a, b)).toBe(true)
  })
})

describe('venueMatch — rule 3: one shared word that is a whole side', () => {
  it.each([
    // "city" is a corpus stopword, so both sides reduce to ["hall"]
    ['City Hall', 'Disco City Hall'],
    ['Razzmatazz', 'Razzmatazz sales 2 & 3'],
    ['Input', 'Input High Fidelity Dance Club'],
    ['Opium', 'Opium Barcelona Restaurant'],
    ['Apolo', 'Sala Apolo'],
    ['Moog', 'Moog Bar'],
    ['TBA - Backstage - Carrer Casp, 33', 'Backstage'],
  ])('%s ~ %s', (a, b) => {
    expect(venueMatch(a, b)).toBe(true)
  })

  it('counts a repeated word once, so "Bling Bling" is one word of identity', () => {
    expect(venueMatch('Bling Bling Barcelona', 'Bling Bling Nightclub')).toBe(true)
  })

  it('is symmetric', () => {
    expect(venueMatch('Sala Apolo', 'Apolo')).toBe(true)
    expect(venueMatch('Apolo', 'Sala Apolo')).toBe(true)
  })

  it('requires the shared word to be a whole side, not merely present', () => {
    // "sutton" is shared, but each side carries another distinct word, so
    // neither side's identity is just "sutton".
    expect(venueMatch('Sutton Barcelona Lisboa', 'Sutton Madrid Porto')).toBe(false)
  })
})

describe('venueMatch — generic words must not match', () => {
  // The regression this module exists for. Each pair was matched by the old
  // "any shared word > 3 chars" rule and is a distinct real venue.
  it.each([
    ['Azul Rooftop Barceloneta', 'Skygarden Barcelona Rooftop'],
    ['Azul Rooftop Barceloneta', 'Azimuth Rooftop Bar'],
    ['Azul Rooftop Barceloneta', 'Lolita Barceloneta'],
    ['Azul Rooftop Barceloneta', 'Azul Frida'],
    ['Almar Beach Club', 'El Kabron Beach Club'],
    ['Sunseabar Beach Club', 'Go Beach Club Barcelona'],
    ['Casa Montjuïc', 'Casa Amirall'],
    ['City Hall', 'Bar Hot Dog City'],
    ['Hola Club Sitges (Cala Vallcarca)', 'La Cala'],
    ['Garage 442', 'Garage Beer Co'],
    ['Teatre Grec', 'Bar Teatre'],
    ['Parc Nou. El Prat de Llobregat', 'Bar Llobregat'],
    ['TBA - Backstage - Carrer Casp, 33', 'El 9 Carrer'],
    ['TBA - Mansion Near Plaza Catalunya', 'Bar Plaza Reloj'],
    ['TBA - ROOTS - Carrer de Badajoz, 115 Sant Martí, 08018 Barcelona', 'Sant Jordi'],
    ['Beach Club', 'Rooftop Bar'],
  ])('%s does NOT match %s', (a, b) => {
    expect(venueMatch(a, b)).toBe(false)
  })
})

describe('venueMatch — degenerate input', () => {
  it.each([
    ['', 'Razzmatazz'],
    ['Razzmatazz', ''],
    ['', ''],
    ['   ', 'Razzmatazz'],
    ['!!!', '???'],
  ])('%s ~ %s is false', (a, b) => {
    expect(venueMatch(a, b)).toBe(false)
  })
})
