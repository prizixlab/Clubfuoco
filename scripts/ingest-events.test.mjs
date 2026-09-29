import { describe, it, expect } from 'vitest'
import { planWrites, SCRAPE_OWNED, ORIGIN, AUTHORITATIVE_ORIGINS } from './ingest-events.mjs'
import { ORIGIN_RANK, originRank } from '../src/lib/event-merge.ts'

// A payload row as the ingest builds it.
const row = (id, over = {}) => ({
  ra_event_id: id,
  title: `Event ${id}`,
  date: '2026-10-01',
  start_time: '2026-10-01T23:00:00+02:00',
  venue_name: 'Ku',
  club_id: 'club-1',
  club_match: 'exact',
  promoters: ['P'],
  artists: ['A'],
  interested: 3,
  attending: 2,
  cost: '15',
  ra_url: 'https://ra.co/events/1',
  image: 'https://img/1.jpg',
  description: 'desc',
  first_seen: '2026-09-01',
  last_seen: '2026-09-29',
  origin: ORIGIN,
  source_ref: `ra_${id}`,
  source_at: '2026-09-29T06:00:00.000Z',
  ...over,
})

const priorRow = (over = {}) => ({
  first_seen: '2026-09-01', locked_fields: [], origin: ORIGIN, ...over,
})

describe('planWrites — the fast path', () => {
  it('bulk-upserts a brand new event', () => {
    const p = planWrites([row('1')], new Map())
    expect(p.bulk).toHaveLength(1)
    expect(p.patches).toHaveLength(0)
    expect(p.protectedFields).toBe(0)
  })

  it('bulk-upserts an existing plain scrape row nobody has touched', () => {
    const p = planWrites([row('1')], new Map([['1', priorRow()]]))
    expect(p.bulk).toHaveLength(1)
    expect(p.patches).toHaveLength(0)
  })

  it('carries provenance on every bulk row, which also repairs bare rows', () => {
    // The 1676 rows that lost source_ref are repaired by exactly this: an
    // upsert that includes the column overwrites the null.
    const p = planWrites([row('1')], new Map([['1', priorRow({ source_ref: null })]]))
    expect(p.bulk[0].origin).toBe('scrape:ra')
    expect(p.bulk[0].source_ref).toBe('ra_1')
    expect(p.bulk[0].source_at).toBeTruthy()
  })
})

describe('planWrites — locked fields', () => {
  it('patches around a column a human set, and counts it', () => {
    const p = planWrites([row('1')], new Map([['1', priorRow({ locked_fields: ['start_time'] })]]))
    expect(p.bulk).toHaveLength(0)
    expect(p.patches).toHaveLength(1)
    expect(p.patches[0].patch).not.toHaveProperty('start_time')
    expect(p.patches[0].patch.title).toBe('Event 1')
    expect(p.protectedFields).toBe(1)
  })

  it('never writes first_seen, even on the careful path', () => {
    const p = planWrites([row('1')], new Map([['1', priorRow({ locked_fields: ['title'] })]]))
    expect(p.patches[0].patch).not.toHaveProperty('first_seen')
  })

  it('never writes locked_fields itself — that array is the human\'s', () => {
    const p = planWrites([row('1')], new Map([['1', priorRow({ locked_fields: ['title'] })]]))
    expect(p.patches[0].patch).not.toHaveProperty('locked_fields')
    expect(SCRAPE_OWNED).not.toContain('locked_fields')
  })

  it('survives repeated runs without eroding the lock', () => {
    const existing = new Map([['1', priorRow({ locked_fields: ['start_time', 'image'] })]])
    for (let day = 0; day < 5; day++) {
      const p = planWrites([row('1')], existing)
      expect(p.patches[0].patch).not.toHaveProperty('start_time')
      expect(p.patches[0].patch).not.toHaveProperty('image')
    }
  })
})

describe('planWrites — a row somebody else owns', () => {
  for (const origin of ['promoter', 'venue', 'staff']) {
    it(`asserts nothing but freshness on a ${origin} row`, () => {
      const p = planWrites([row('1')], new Map([['1', priorRow({ origin })]]))
      expect(p.patches).toHaveLength(1)
      const { patch } = p.patches[0]
      // last_seen is a fact about RA, not a claim about their night.
      expect(patch.last_seen).toBe('2026-09-29')
      expect(patch.source_at).toBeTruthy()
      for (const col of ['title', 'start_time', 'club_id', 'image', 'description']) {
        expect(patch).not.toHaveProperty(col)
      }
    })
  }

  it('does not restamp the origin of a row it does not own', () => {
    const p = planWrites([row('1')], new Map([['1', priorRow({ origin: 'promoter' })]]))
    expect(p.patches[0].patch).not.toHaveProperty('origin')
    expect(p.patches[0].patch).not.toHaveProperty('source_ref')
  })

  it('still owns a row written by the other scraper', () => {
    // scrape:eventbrite is not authoritative over scrape:ra — same tier.
    const p = planWrites([row('1')], new Map([['1', priorRow({ origin: 'scrape:eventbrite' })]]))
    expect(p.bulk).toHaveLength(1)
  })
})

describe('policy agrees with the ticket scrape', () => {
  it('every authoritative origin really does outrank this scrape', () => {
    for (const o of AUTHORITATIVE_ORIGINS) {
      expect(ORIGIN_RANK).toContain(o)
      expect(originRank(o)).toBeGreaterThan(originRank(ORIGIN))
    }
  })

  it('this scrape\'s own origin is a known one', () => {
    expect(ORIGIN_RANK).toContain(ORIGIN)
  })

  it('never claims a column that is nobody\'s to scrape', () => {
    for (const col of ['ra_event_id', 'origin', 'locked_fields', 'created_at', 'first_seen']) {
      expect(SCRAPE_OWNED).not.toContain(col)
    }
  })

  it('leaves the ticketing columns to the ticket scrape', () => {
    for (const col of ['base_price', 'display_price', 'currency', 'sold_out']) {
      expect(SCRAPE_OWNED).not.toContain(col)
    }
  })

  it('DOES own club_id, which the ticket scrape must not touch', () => {
    // The one deliberate divergence: this script is the venue resolver.
    expect(SCRAPE_OWNED).toContain('club_id')
    expect(SCRAPE_OWNED).toContain('club_match')
  })
})

describe('planWrites — mixed batch', () => {
  it('routes each row to the right path and counts correctly', () => {
    const existing = new Map([
      ['2', priorRow()],
      ['3', priorRow({ locked_fields: ['title'] })],
      ['4', priorRow({ origin: 'promoter' })],
    ])
    const p = planWrites([row('1'), row('2'), row('3'), row('4')], existing)
    expect(p.bulk.map(r => r.ra_event_id)).toEqual(['1', '2'])
    expect(p.patches.map(r => r.ra_event_id)).toEqual(['3', '4'])
    expect(p.protectedFields).toBeGreaterThan(0)
  })

  it('handles an empty run', () => {
    expect(planWrites([], new Map())).toEqual({ bulk: [], patches: [], protectedFields: 0 })
  })
})
