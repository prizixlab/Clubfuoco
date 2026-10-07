import type { SupabaseClient } from '@supabase/supabase-js'

// Promoters who sell ONLY through Fourvenues. Nothing of ours may ever be
// issued for them — no Fuoco QR, no invite link, no reserve spot, no portal
// guestlist. Their doors scan Fourvenues codes, so a Fuoco QR at a HypeList
// room is a ticket nobody honours (a Bling Bling "Free Guestlist" booked
// through /api/rumbalist/join-guestlist on 7 Oct 2026 minted CF-468ZE5BO).
// Their nights are sold in the app from the Fourvenues feed instead.
//
// Keyed by brand, not by `promoter_nights.fourvenues_code`: a code also marks
// promoters who DO sell through us (Bacheloneta's platform-settled night).
export const FOURVENUES_ONLY_BRAND_KEYS: ReadonlySet<string> = new Set(['hypelist'])

// HypeList's promoter account (hypelist@clubfuoco.com), so the guard holds
// even if the brand lookup below fails.
const KNOWN_OWNERS = ['6df4970e-b0e1-4dc4-81fd-dde134820a82']

export function isFourvenuesOnlyBrandKey(key: unknown): boolean {
  return typeof key === 'string' && FOURVENUES_ONLY_BRAND_KEYS.has(key.toLowerCase())
}

/** Auth uids of the promoter accounts behind Fourvenues-only brands. */
export async function fourvenuesOnlyOwners(sb: SupabaseClient): Promise<Set<string>> {
  const owners = new Set(KNOWN_OWNERS)
  const { data } = await sb
    .from('partner_brands')
    .select('owner_user_id')
    .in('key', [...FOURVENUES_ONLY_BRAND_KEYS])
  for (const r of (data ?? []) as { owner_user_id: string | null }[]) {
    if (r.owner_user_id) owners.add(r.owner_user_id)
  }
  return owners
}

/** Is this night run by a Fourvenues-only promoter? */
export async function fourvenuesOnlyNight(sb: SupabaseClient, nightId: string): Promise<boolean> {
  const { data } = await sb
    .from('promoter_nights')
    .select('created_by')
    .eq('id', nightId)
    .maybeSingle()
  const by = (data as { created_by?: string | null } | null)?.created_by
  return !!by && (await fourvenuesOnlyOwners(sb)).has(by)
}

/** Does this allocation belong to, or sit on a night of, a Fourvenues-only promoter? */
export async function fourvenuesOnlyAllocation(sb: SupabaseClient, allocationId: string): Promise<boolean> {
  const { data } = await sb
    .from('promoter_allocations')
    .select('promoter_id, night:promoter_nights(created_by)')
    .eq('id', allocationId)
    .maybeSingle()
  if (!data) return false
  const row = data as {
    promoter_id?: string | null
    night?: { created_by?: string | null } | { created_by?: string | null }[] | null
  }
  const night = Array.isArray(row.night) ? row.night[0] : row.night
  const owners = await fourvenuesOnlyOwners(sb)
  return [row.promoter_id, night?.created_by].some(id => !!id && owners.has(id))
}
