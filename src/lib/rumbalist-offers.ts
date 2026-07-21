// FALLBACK ONLY — a bundled snapshot of offers, keyed by clubs.id. The live
// source of truth is partner_offers via GET /api/partner (PartnerContext);
// this map only seeds first paint / offline / pre-fetch states, and the venue
// detail page falls back to it while the live set is in flight. It carries NO
// ranking signal: the explore feed tiers and scores exclusively off the live
// set. Removal path: once an offline-capable cache of /api/partner exists
// (or offline seeding is dropped), delete this map and the getRumbalistOffers
// fallback in clubs/place/[id]/_client and PartnerContext.

export type OfferKind = 'free_guestlist' | 'vip_table'

export interface OfferBrand {
  key:      string
  name:     string
  logo_url: string | null
  color:    string
}

export interface RumbalistOffer {
  kind:        OfferKind
  title:       string
  subtitle:    string         // e.g. "Free till 1:00 AM"
  price_eur:   number | null  // null = free
  party_size:  number | null
  time_window: string
  valid_days:  string
  dress_code:  string
  music:       string
  // The supplier behind THIS offer. Offers come from many brands (any promoter
  // can publish one), so the booking flow brands itself per offer. Absent on
  // the bundled fallback map below — no live data, so no credit.
  brand?:      OfferBrand
  // Nights the supplier turned off, even though valid_days covers them
  // ("normally Monday, but not Monday the 20th").
  skipped_dates?: string[]
}

/** Is this offer actually running on `date` ("yyyy-MM-dd")? */
export function offerRunsOn(offer: RumbalistOffer, date: string): boolean {
  return !(offer.skipped_dates ?? []).includes(date)
}

const FREE = (sub: string, music: string, dress: string, days = 'Sun – Fri', time = 'Door open till closing'): RumbalistOffer => ({
  kind: 'free_guestlist',
  title: 'Free Guestlist',
  subtitle: sub,
  price_eur: null,
  party_size: null,
  time_window: time,
  valid_days: days,
  dress_code: dress,
  music,
})

const VIP = (price: number, music: string, days = 'Any night', size = 5): RumbalistOffer => ({
  kind: 'vip_table',
  title: 'VIP Table',
  subtitle: `From €${price} · ${size} people · Fully consumable on bottles`,
  price_eur: price,
  party_size: size,
  time_window: 'Reservation for the night',
  valid_days: days,
  dress_code: 'Smart casual',
  music,
})

// clubs.id → list of offers
export const RUMBALIST_OFFERS: Record<string, RumbalistOffer[]> = {
  // Opium Barcelona
  'b3f7747f-d911-490d-a688-d04add6a1c8b': [
    FREE('Free till 1:00 AM', 'R&B · Hip Hop · Commercial House · Reggaeton', 'Elegant — no sneakers or sportswear', 'Every night'),
    VIP(300, 'Reggaeton · Commercial · Hits · Pop', 'Every night'),
  ],
  // Pacha Barcelona
  'd184f2f1-8db3-4d03-ae11-ad19b650894d': [
    FREE('Free till 02:30 AM', 'Reggaeton · Hip Hop · Top Hits · Techno · House', 'Smart casual — no sportswear', 'Every night'),
    VIP(300, 'Reggaeton · Hip Hop · Top Hits · R&B · Techno · House · Electronic', 'Every night'),
  ],
  // Jamboree
  'a83428e5-5c7f-4f55-99e5-3f329f7c3210': [
    FREE('Free till 2:00 AM', 'Hip Hop · R&B · Dancehall', 'Casual — no sneakers or sportswear', 'Mon, Tue, Wed, Sun'),
  ],
  // Disco City Hall
  'bdafd62c-2543-4238-9951-e4a1a17bb7eb': [
    FREE('Free entry + free bar till 01:00 AM', 'Reggaeton · Hip Hop · Top Hits · R&B · Techno · House · Electronic', 'Casual'),
  ],
  // Twenties Barcelona
  '3c3716e0-0361-4a62-b4d2-ec1eb5d00bbb': [
    FREE('Free till 1:00 AM', 'Reggaeton · Top Hits · House', 'Casual — no sportswear or sneakers', 'Tue, Thu – Sun'),
    VIP(300, 'Hits · Reggaeton · R&B · Commercial House · Top Hits', 'Tue, Thu – Sun'),
  ],
  // Shôko (active duplicate)
  'ddca5d10-9b4f-47c4-81a2-2c36bef77e49': [
    FREE('Free till 01:00 AM', 'Hip Hop · R&B · Reggaeton · Electro · Commercial House · EDM', 'Casual — no sneakers or sportswear', 'Tue, Wed, Sun'),
    VIP(300, 'Hip Hop · R&B · Reggaeton · Electro · Commercial House · EDM', 'Tue, Wed, Sun'),
  ],
  // CDLC (Carpe Diem)
  'd649395c-d3db-4397-b200-42b575d1738a': [
    FREE('Free till 1:00 AM', 'Top Hits · Reggaeton', 'Casual elegant — no sportswear', 'Tue, Wed, Sun'),
    VIP(400, 'Deep House · Tech House · Hip Hop · R&B · Pop', 'Tue, Wed, Sun'),
  ],
  // Bling Bling
  '07ce6a58-ceee-48e4-89ce-3c3e6b6ff2b2': [
    VIP(250, 'Reggaeton · Commercial House · R&B · Top Hits', 'Wed'),
  ],
  // Downtown Barcelona
  '60d6f94e-26cc-4d24-bacc-8a255e1c7924': [
    VIP(300, 'Reggaeton · R&B · Top Hits', 'Thu, Fri'),
  ],
  // Sutton Club
  'e0cf6310-28e5-4117-ad5f-01179f87d8fd': [
    VIP(300, 'Reggaeton · House · Top Hits', 'Thu – Sat'),
  ],
}

export function getRumbalistOffers(clubId: string | null | undefined): RumbalistOffer[] {
  return clubId ? (RUMBALIST_OFFERS[clubId] ?? []) : []
}
