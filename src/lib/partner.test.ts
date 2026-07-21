import { describe, expect, it } from 'vitest'
import { offerRunsOn } from './partner'

// offerRunsOn is the SERVER booking gate — the thing standing between a stale
// or hand-rolled client and a booking we can't honour. Client-side filtering is
// presentation; this is enforcement, so it gets real coverage.

interface OfferRow {
  skipped_dates?: string[] | null
  brand_id?: string
  valid_days?: string | null
}

/** Minimal stand-in shaped like the supabase query builder calls it makes. */
function fakeSb(offers: OfferRow[] | null, brands: Record<string, unknown>[] = [], error = false) {
  return {
    from(table: string) {
      if (table === 'partner_brands') {
        return { select: () => Promise.resolve({ data: brands, error: null }) }
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: offers, error: error ? { message: 'boom' } : null }).then(res),
      }
      return chain
    },
  } as never
}

const SUNDAY = '2026-07-26'
const SATURDAY = '2026-07-25'
const WEDNESDAY = '2026-07-22'

describe('offerRunsOn — valid_days enforcement', () => {
  it('allows a "Sun – Fri" offer on a Sunday', async () => {
    const sb = fakeSb([{ valid_days: 'Sun – Fri', skipped_dates: [] }])
    expect(await offerRunsOn(sb, 'club', 'free_guestlist', SUNDAY)).toBe(true)
  })

  it('REFUSES a "Sun – Fri" offer on a Saturday', async () => {
    // The bug this closes: the feed hid it, the booking still went through.
    const sb = fakeSb([{ valid_days: 'Sun – Fri', skipped_dates: [] }])
    expect(await offerRunsOn(sb, 'club', 'free_guestlist', SATURDAY)).toBe(false)
  })

  it('allows an "Every night" offer on any night', async () => {
    const sb = fakeSb([{ valid_days: 'Every night', skipped_dates: [] }])
    expect(await offerRunsOn(sb, 'club', 'vip_table', SATURDAY)).toBe(true)
  })

  it('refuses a single-day offer on the wrong day', async () => {
    const sb = fakeSb([{ valid_days: 'Wed', skipped_dates: [] }])
    expect(await offerRunsOn(sb, 'club', 'vip_table', SATURDAY)).toBe(false)
    expect(await offerRunsOn(fakeSb([{ valid_days: 'Wed', skipped_dates: [] }]), 'club', 'vip_table', WEDNESDAY)).toBe(true)
  })

  it('treats unparseable valid_days as "no restriction" rather than refusing', async () => {
    // Bad data must not block a legitimate booking — same leniency the
    // missing-table path applies.
    const sb = fakeSb([{ valid_days: 'closed', skipped_dates: [] }])
    expect(await offerRunsOn(sb, 'club', 'free_guestlist', SATURDAY)).toBe(true)
  })
})

describe('offerRunsOn — skipped dates', () => {
  it('refuses a night the supplier turned off, even on a valid weekday', async () => {
    const sb = fakeSb([{ valid_days: 'Every night', skipped_dates: [SUNDAY] }])
    expect(await offerRunsOn(sb, 'club', 'free_guestlist', SUNDAY)).toBe(false)
  })

  it('still allows other nights', async () => {
    const sb = fakeSb([{ valid_days: 'Every night', skipped_dates: [SUNDAY] }])
    expect(await offerRunsOn(sb, 'club', 'free_guestlist', SATURDAY)).toBe(true)
  })
})

describe('offerRunsOn — hidden supplier', () => {
  it('refuses offers from a supplier hidden in the portal', async () => {
    const sb = fakeSb(
      [{ valid_days: 'Every night', skipped_dates: [], brand_id: 'b1' }],
      [{ id: 'b1', key: 'x', name: 'Hidden Co', color: '#000', offers_hidden: true }],
    )
    expect(await offerRunsOn(sb, 'club', 'free_guestlist', SATURDAY)).toBe(false)
  })

  it('allows offers from a visible supplier', async () => {
    const sb = fakeSb(
      [{ valid_days: 'Every night', skipped_dates: [], brand_id: 'b1' }],
      [{ id: 'b1', key: 'x', name: 'Visible Co', color: '#000', offers_hidden: false }],
    )
    expect(await offerRunsOn(sb, 'club', 'free_guestlist', SATURDAY)).toBe(true)
  })
})

describe('offerRunsOn — drift tolerance', () => {
  it('does not block when the table/column is missing', async () => {
    expect(await offerRunsOn(fakeSb(null, [], true), 'club', 'free_guestlist', SATURDAY)).toBe(true)
  })

  it('does not block when the club has no offer of that kind', async () => {
    expect(await offerRunsOn(fakeSb([]), 'club', 'free_guestlist', SATURDAY)).toBe(true)
  })
})
