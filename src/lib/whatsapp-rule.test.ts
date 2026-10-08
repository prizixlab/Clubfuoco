import { describe, expect, it } from 'vitest'
import { mentionsWhatsApp } from './whatsapp-rule'
import { OfferSchema } from './portal-schemas'

describe('mentionsWhatsApp', () => {
  it('catches names, links and nested data', () => {
    expect(mentionsWhatsApp('WhatsApp')).toBe(true)
    expect(mentionsWhatsApp('Book on Whats App')).toBe(true)
    expect(mentionsWhatsApp('https://wa.me/34670976380')).toBe(true)
    expect(mentionsWhatsApp({ rates: [{ name: 'Reserva por WHATSAPP' }] })).toBe(true)
  })
  it('leaves ordinary offers alone', () => {
    expect(mentionsWhatsApp('Free till 1:00 AM', 'Smart casual', null, undefined)).toBe(false)
  })
})

describe('promoter offers can’t route guests to WhatsApp', () => {
  const base = {
    club_id: '00000000-0000-0000-0000-000000000001', kind: 'free_guestlist', title: 'Free Guestlist',
    subtitle: 'Free till 1:00 AM', price_eur: null, party_size: null, time_window: 'Door till 1',
    valid_days: 'Every night', dress_code: 'Casual', music: 'House',
  }
  it('accepts a normal offer', () => { expect(OfferSchema.safeParse(base).success).toBe(true) })
  it('refuses one that says to book on WhatsApp', () => {
    expect(OfferSchema.safeParse({ ...base, subtitle: 'Message us on WhatsApp to book' }).success).toBe(false)
  })
})
