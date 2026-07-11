import type { createServiceClient } from '@/lib/supabase/server'

type SB = Awaited<ReturnType<typeof createServiceClient>>

// The active guestlist partner's identity, shown to users. Swappable at runtime
// (see supabase/migrations/20260711_partner_config.sql) so a partner switch
// doesn't need a rebuild or App Store release.
export interface PartnerBrand {
  key:      string
  name:     string
  logo_url: string | null
  color:    string
}

// A per-club offer (free guestlist / VIP), denormalized for display. Mirrors the
// old RUMBALIST_OFFERS shape so consumers don't have to change.
export interface PartnerOffer {
  kind:        'free_guestlist' | 'vip_table'
  title:       string
  subtitle:    string
  price_eur:   number | null
  party_size:  number | null
  time_window: string
  valid_days:  string
  dress_code:  string
  music:       string
}

const OFFER_COLS =
  'club_id, kind, title, subtitle, price_eur, party_size, time_window, valid_days, dress_code, music'

function toOffer(r: Record<string, unknown>): PartnerOffer {
  return {
    kind:        r.kind as PartnerOffer['kind'],
    title:       r.title as string,
    subtitle:    r.subtitle as string,
    price_eur:   r.price_eur == null ? null : Number(r.price_eur),
    party_size:  r.party_size == null ? null : Number(r.party_size),
    time_window: r.time_window as string,
    valid_days:  r.valid_days as string,
    dress_code:  r.dress_code as string,
    music:       r.music as string,
  }
}

export async function getActiveBrand(sb: SB): Promise<(PartnerBrand & { id: string }) | null> {
  const { data } = await sb
    .from('partner_brands')
    .select('id, key, name, logo_url, color')
    .eq('is_active', true)
    .maybeSingle()
  return (data as (PartnerBrand & { id: string }) | null) ?? null
}

// All of the active brand's offers, grouped by club id (the RUMBALIST_OFFERS map).
export async function getPartnerOffersByClub(sb: SB): Promise<Record<string, PartnerOffer[]>> {
  const brand = await getActiveBrand(sb)
  if (!brand) return {}
  const { data } = await sb
    .from('partner_offers')
    .select(OFFER_COLS)
    .eq('brand_id', brand.id)
    .order('club_id', { ascending: true })
    .order('sort_order', { ascending: true })
  const map: Record<string, PartnerOffer[]> = {}
  for (const r of data ?? []) (map[(r as { club_id: string }).club_id] ??= []).push(toOffer(r))
  return map
}

// The active brand's offers for one club (replacement for getRumbalistOffers).
export async function getPartnerOffers(sb: SB, clubId: string | null | undefined): Promise<PartnerOffer[]> {
  if (!clubId) return []
  const brand = await getActiveBrand(sb)
  if (!brand) return []
  const { data } = await sb
    .from('partner_offers')
    .select(OFFER_COLS)
    .eq('brand_id', brand.id)
    .eq('club_id', clubId)
    .order('sort_order', { ascending: true })
  return (data ?? []).map(toOffer)
}
