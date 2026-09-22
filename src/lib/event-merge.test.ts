import { describe, it, expect } from 'vitest'
import {
  mergeScrapedEvent, lockFields, unlockFields, originRank, ORIGIN_RANK,
  type ExistingEvent,
} from './event-merge'

const cols = (r: { patch: Record<string, unknown> }) => Object.keys(r.patch).sort()
const reasonFor = (r: ReturnType<typeof mergeScrapedEvent>, column: string) =>
  r.skipped.find(s => s.column === column)?.reason

describe('originRank', () => {
  it('ranks a promoter above every scraper', () => {
    expect(originRank('promoter')).toBeGreaterThan(originRank('scrape:ra'))
    expect(originRank('promoter')).toBeGreaterThan(originRank('scrape:eventbrite'))
    expect(originRank('venue')).toBeGreaterThan(originRank('staff'))
  })

  it('ranks our own derived data below every observation', () => {
    for (const o of ORIGIN_RANK) {
      if (o === 'inferred') continue
      expect(originRank(o)).toBeGreaterThan(originRank('inferred'))
    }
  })

  it('treats an unknown origin as the least authoritative thing there is', () => {
    // A typo in a scraper must never win a field from a promoter.
    expect(originRank('scrape:typo')).toBeLessThan(originRank('inferred'))
    expect(originRank(null)).toBeLessThan(originRank('inferred'))
    expect(originRank(undefined)).toBeLessThan(originRank('inferred'))
  })
})

describe('mergeScrapedEvent — a new row', () => {
  it('keeps everything the scrape supplied', () => {
    const r = mergeScrapedEvent(undefined, {
      title: 'HALE-BOPP Vol.4', date: '2026-09-04', sold_out: false,
    }, 'scrape:ra')
    expect(cols(r)).toEqual(['date', 'sold_out', 'title'])
  })

  it('still drops blanks — a scrape saying nothing is not a value', () => {
    const r = mergeScrapedEvent(undefined, {
      title: 'Boris Friday', description: null, artists: [], venue_name: '  ',
    }, 'scrape:ra')
    expect(cols(r)).toEqual(['title'])
    expect(reasonFor(r, 'description')).toBe('empty')
    expect(reasonFor(r, 'artists')).toBe('empty')
    expect(reasonFor(r, 'venue_name')).toBe('empty')
  })

  it('does not treat false or zero as blank', () => {
    const r = mergeScrapedEvent(undefined, { sold_out: false, base_price: 0 }, 'scrape:ra')
    expect(r.patch).toEqual({ sold_out: false, base_price: 0 })
  })
})

describe('mergeScrapedEvent — locked fields', () => {
  const existing: ExistingEvent = {
    origin: 'scrape:ra',
    locked_fields: ['start_time', 'lineup'],
    title: 'Old title',
    start_time: '2026-09-04T23:00:00+00:00',
    lineup: [{ id: '1', name: 'Corrected By Hand' }],
  }

  it('refuses to overwrite a column a human set', () => {
    const r = mergeScrapedEvent(existing, {
      title: 'New title',
      start_time: '2026-09-04T15:00:00+00:00',
      lineup: [{ id: '9', name: 'Scraped Again' }],
    }, 'scrape:ra')

    expect(cols(r)).toEqual(['title'])
    expect(reasonFor(r, 'start_time')).toBe('locked')
    expect(reasonFor(r, 'lineup')).toBe('locked')
  })

  it('this is the overnight bug: the 06:00 scrape can no longer eat a correction', () => {
    // Exactly the sequence that used to lose data: promoter fixes the door
    // time, sync-events runs, the correction survives.
    let row: ExistingEvent = {
      origin: 'scrape:ra', locked_fields: [], start_time: '2026-09-04T15:00:00+00:00',
    }
    // A human corrects it.
    row = {
      ...row,
      start_time: '2026-09-05T00:30:00+00:00',
      locked_fields: lockFields(row.locked_fields, ['start_time']),
    }
    // Three mornings of scraping.
    for (let day = 0; day < 3; day++) {
      const r = mergeScrapedEvent(row, { start_time: '2026-09-04T15:00:00+00:00' }, 'scrape:ra')
      expect(r.patch).toEqual({})
      row = { ...row, ...r.patch }
    }
    expect(row.start_time).toBe('2026-09-05T00:30:00+00:00')
  })

  it('leaves unlocked columns fully writable on the same row', () => {
    const r = mergeScrapedEvent(existing, { title: 'Fresh', image: 'https://x/y.jpg' }, 'scrape:ra')
    expect(cols(r)).toEqual(['image', 'title'])
  })
})

describe('mergeScrapedEvent — origin authority', () => {
  const promoterNight: ExistingEvent = {
    origin: 'promoter',
    locked_fields: [],
    title: 'Promoter Title',
    image: null,
    display_price: 20,
  }

  it('will not replace a promoter\'s value with a scraped one', () => {
    const r = mergeScrapedEvent(promoterNight, {
      title: 'Scraped Title', display_price: 15,
    }, 'scrape:ra')
    expect(r.patch).toEqual({})
    expect(reasonFor(r, 'title')).toBe('origin')
    expect(reasonFor(r, 'display_price')).toBe('origin')
  })

  it('still fills a blank on a promoter\'s row — a second opinion, not a correction', () => {
    const r = mergeScrapedEvent(promoterNight, {
      image: 'https://images.ra.co/flyer.jpg',
    }, 'scrape:ra')
    expect(r.patch).toEqual({ image: 'https://images.ra.co/flyer.jpg' })
  })

  it('lets a scrape correct another scrape at the same authority', () => {
    const r = mergeScrapedEvent(
      { origin: 'scrape:ra', locked_fields: [], title: 'Old' },
      { title: 'New' }, 'scrape:ra')
    expect(r.patch).toEqual({ title: 'New' })
  })

  it('never lets a scraper change the row\'s own identity or origin', () => {
    const r = mergeScrapedEvent(
      { origin: 'promoter', locked_fields: [], title: 'x' },
      {
        origin: 'scrape:ra', locked_fields: [], ra_event_id: '999',
        created_at: 'now', club_id: 'some-other-club', club_match: 0.4,
      },
      'scrape:ra')
    expect(r.patch).toEqual({})
    for (const c of ['origin', 'locked_fields', 'ra_event_id', 'created_at', 'club_id', 'club_match']) {
      expect(reasonFor(r, c)).toBe('origin')
    }
  })
})

describe('mergeScrapedEvent — idempotence', () => {
  it('writes nothing when the source has not changed', () => {
    const existing: ExistingEvent = {
      origin: 'scrape:ra', locked_fields: [],
      title: 'Same', artists: ['A', 'B'], lineup: [{ id: '1', name: 'A' }],
      sold_out: false, base_price: 0,
    }
    const r = mergeScrapedEvent(existing, {
      title: 'Same', artists: ['A', 'B'], lineup: [{ id: '1', name: 'A' }],
      sold_out: false, base_price: 0,
    }, 'scrape:ra')
    expect(r.patch).toEqual({})
    expect(r.skipped.every(s => s.reason === 'unchanged')).toBe(true)
  })

  it('notices a real change inside an array or json column', () => {
    const existing: ExistingEvent = {
      origin: 'scrape:ra', locked_fields: [], lineup: [{ id: '1', name: 'A' }],
    }
    const r = mergeScrapedEvent(existing, {
      lineup: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }],
    }, 'scrape:ra')
    expect(cols(r)).toEqual(['lineup'])
  })

  it('does not rewrite a value with an equivalent blank', () => {
    const r = mergeScrapedEvent(
      { origin: 'scrape:ra', locked_fields: [], description: null },
      { description: '' }, 'scrape:ra')
    expect(r.patch).toEqual({})
  })
})

describe('lockFields / unlockFields', () => {
  it('adds a claim without duplicating it', () => {
    expect(lockFields([], ['title'])).toEqual(['title'])
    expect(lockFields(['title'], ['title'])).toEqual(['title'])
    expect(lockFields(['title'], ['image', 'title'])).toEqual(['image', 'title'])
  })

  it('copes with a null column and ignores blank names', () => {
    expect(lockFields(null, ['title'])).toEqual(['title'])
    expect(lockFields(undefined, ['  ', 'image'])).toEqual(['image'])
  })

  it('releases a claim so the row follows the source again', () => {
    expect(unlockFields(['image', 'title'], ['title'])).toEqual(['image'])
    expect(unlockFields(['title'], ['title'])).toEqual([])
    expect(unlockFields(null, ['title'])).toEqual([])
  })

  it('round-trips: lock then unlock leaves no trace', () => {
    const locked = lockFields([], ['title', 'start_time'])
    expect(unlockFields(locked, ['title', 'start_time'])).toEqual([])
  })

  it('an unlocked field becomes writable by a scrape again', () => {
    const row: ExistingEvent = {
      origin: 'scrape:ra', locked_fields: lockFields([], ['title']), title: 'Human',
    }
    expect(mergeScrapedEvent(row, { title: 'Scraped' }, 'scrape:ra').patch).toEqual({})

    const released = { ...row, locked_fields: unlockFields(row.locked_fields, ['title']) }
    expect(mergeScrapedEvent(released, { title: 'Scraped' }, 'scrape:ra').patch)
      .toEqual({ title: 'Scraped' })
  })
})
