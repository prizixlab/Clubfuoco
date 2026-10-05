import { createServiceClient } from '@/lib/supabase/server'
import { ok } from '@/lib/utils'

// GET /api/fourvenues/status — is HypeList on sale in the app right now?
//
// The app sells HypeList's Fourvenues lists, tickets and tables from a
// catalog file it keeps for up to an hour. That file says nothing about the
// portal, so switching HypeList off ("Hide all offers" → offers_hidden) left
// everything bookable until the copy aged out. The app asks this on launch,
// on every return to the foreground and every minute while open, and shows
// nothing from HypeList while it answers false.
//
// Public, uncached, one column. A failed read answers on_sale: true so an
// outage here can't silently take a working supplier off sale — the switch is
// the portal's to flip, not the database's.
export const dynamic = 'force-dynamic'

export async function GET() {
  const sb = await createServiceClient()
  const { data, error } = await sb
    .from('partner_brands')
    .select('offers_hidden')
    .eq('key', 'hypelist')
    .maybeSingle()
  const onSale = error || !data ? true : !(data as { offers_hidden: boolean | null }).offers_hidden
  const res = ok({ on_sale: onSale })
  res.headers.set('Cache-Control', 'no-store')
  return res
}
