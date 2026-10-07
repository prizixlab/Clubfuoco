import { createServiceClient } from '@/lib/supabase/server'
import { ok } from '@/lib/utils'

// GET /api/fourvenues/status — which Fourvenues sellers are on sale right now.
//
// The app sells each brand's Fourvenues lists, tickets and tables from a
// catalog file it keeps for up to an hour. That file says nothing about the
// portal, so a brand switched off ("Hide all offers" → offers_hidden) stayed
// bookable until the copy aged out. The app asks this on launch, on every
// return to the foreground and every minute while open.
//
//   brands   key → on sale, for every brand (1.15+: per-brand switch)
//   on_sale  HypeList's answer — what 1.14 reads, from when it was the only one
//
// Public, uncached. A failed read answers on sale, so an outage here can't
// silently take working suppliers off sale — the switch is the portal's to
// flip, not the database's.
export const dynamic = 'force-dynamic'

export async function GET() {
  const sb = await createServiceClient()
  const { data, error } = await sb.from('partner_brands').select('key, offers_hidden')
  const brands: Record<string, boolean> = {}
  for (const b of (error ? [] : data ?? []) as { key: string; offers_hidden: boolean | null }[]) {
    brands[b.key] = !b.offers_hidden
  }
  const res = ok({ on_sale: brands.hypelist ?? true, brands })
  res.headers.set('Cache-Control', 'no-store')
  return res
}
