import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { getBrand } from '@/lib/partner'
import { ok, err } from '@/lib/utils'

// GET /api/portal/brands/:id/events — the events this brand's promoter runs.
//
// Events and offers are different things and the brand page shows them apart:
// an OFFER is a standing per-venue product (`partner_offers`, keyed by
// valid_days), an EVENT is one dated night (`promoter_nights`). A promoter can
// have many of one and none of the other.
//
// Ownership goes through the brand's `owner_user_id`, because that is the only
// link there is — promoter_nights has no brand_id, it has `created_by`. A
// brand with no owner yet (a prospective list seeded before its promoter has
// access) therefore has no events rather than an error.
//
// This is the OPERATOR's view, matching /api/portal/events: unpublished,
// unapproved, private and past nights are all included, because seeing what
// exists is the point.
export interface BrandEvent {
  id: string
  title: string | null
  night_date: string
  club_id: string | null
  club_name: string | null
  /** Free-text venue for a night at a custom location (no `clubs` row). */
  location_name: string | null
  open_time: string | null
  close_time: string | null
  is_published: boolean
  review_status: string
  visibility: string
  featured: boolean
  price_cents: number
  total_capacity: number | null
  /** Past relative to today, so the UI can separate upcoming from history. */
  past: boolean
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params
  const sb = await createServiceClient()

  const brand = await getBrand(sb, id)
  if (!brand) return err('Brand not found', 404)
  // No promoter account linked → nothing can be attributed to them yet.
  if (!brand.owner_user_id) return ok({ events: [], owner: null })

  // Paged, not `.limit(2000)`. PostgREST caps a response at 1000 rows however
  // large a limit is asked for, so a limit above it silently returns 1000 and
  // looks like the promoter simply has that many nights. BesoList is already
  // at 379 and climbing; a scraper-fed roster crosses 1000 without anyone
  // noticing the list stopped being complete. `id` is the tiebreaker so a page
  // boundary inside one date cannot drop or repeat a row.
  const PAGE = 1000
  const rows: Omit<BrandEvent, 'club_name' | 'past'>[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('promoter_nights')
      .select('id, title, night_date, club_id, location_name, open_time, close_time, is_published, review_status, visibility, featured, price_cents, total_capacity')
      .eq('created_by', brand.owner_user_id)
      .order('night_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) return err(error.message, 500)
    if (!data || data.length === 0) break
    rows.push(...(data as Omit<BrandEvent, 'club_name' | 'past'>[]))
    if (data.length < PAGE) break
  }

  // Resolve venue names in one query rather than per row.
  const clubIds = [...new Set(rows.map(r => r.club_id).filter((v): v is string => !!v))]
  const clubName = new Map<string, string>()
  if (clubIds.length) {
    const { data: clubs } = await sb.from('clubs').select('id, name').in('id', clubIds)
    for (const c of (clubs ?? []) as { id: string; name: string }[]) clubName.set(c.id, c.name)
  }

  // Compare as calendar dates, not timestamps: night_date is a local calendar
  // day, so a Date-based comparison would shift the boundary by the timezone.
  const today = new Date().toISOString().slice(0, 10)

  const events: BrandEvent[] = rows.map(r => ({
    ...r,
    club_name: r.club_id ? clubName.get(r.club_id) ?? null : null,
    past: r.night_date < today,
  }))

  return ok({ events, owner: brand.owner_user_id })
}
