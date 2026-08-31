import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { ok, err } from '@/lib/utils'

// Portal events desk. Two jobs the schema now supports and nothing else drives:
//
//   1. Pin an event — OUR editorial choice of what heads the consumer Events
//      tab, deliberately distinct from `featured`, which is promotion a
//      promoter pays for.
//   2. Publish a house event — one we run ourselves, stored as an ordinary
//      promoter_nights row with `is_house` so it inherits capacity, guest
//      lists, QR passes, the door pack and saved-events for free.
//
// Every read here is the OPERATOR's view, not the guest's: it deliberately
// includes unapproved, unpublished, private and past rows, because deciding
// what to pin means seeing what exists. The guest-facing gate lives in
// `v_events_feed` and is applied by /api/events, not here.

export interface PortalEvent {
  id: string
  title: string | null
  night_date: string
  club_id: string | null
  club_name: string | null
  location_name: string | null
  is_published: boolean
  visibility: string
  review_status: string
  featured: boolean
  is_house: boolean
  pinned_at: string | null
  pin_rank: number | null
  pin_note: string | null
  total_capacity: number
  price_cents: number
  photo_urls: string[]
  /** Guest-visible right now — the same predicate v_events_feed applies. */
  live: boolean
}

/** Today in Barcelona. The venues are here, so "past" is decided in their day,
 *  not in the server's UTC one — otherwise an event still running at 01:00
 *  local reads as yesterday. */
function todayMadrid(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function clubName(row: unknown): string | null {
  const c = (row as { club?: { name?: string } | { name?: string }[] }).club
  const name = Array.isArray(c) ? c[0]?.name : c?.name
  return name ?? null
}

const SELECT =
  'id, title, night_date, club_id, location_name, is_published, visibility, ' +
  'review_status, featured, is_house, pinned_at, pin_rank, pin_note, ' +
  'total_capacity, price_cents, photo_urls, club:clubs(name)'

// GET /api/portal/events?scope=upcoming|past
export async function GET(req: Request) {
  const denied = await requirePortal()
  if (denied) return denied
  const sb = await createServiceClient()

  const scope = new URL(req.url).searchParams.get('scope') === 'past' ? 'past' : 'upcoming'
  const today = todayMadrid()

  let q = sb.from('promoter_nights').select(SELECT)
  q = scope === 'past'
    ? q.lt('night_date', today).order('night_date', { ascending: false }).limit(60)
    : q.gte('night_date', today).order('night_date', { ascending: true }).limit(200)

  const { data, error } = await q
  if (error) return err(error.message, 500)

  const rows: PortalEvent[] = (data ?? []).map(r => {
    const row = r as unknown as Record<string, unknown>
    return {
      id: row.id as string,
      title: (row.title as string) ?? null,
      night_date: row.night_date as string,
      club_id: (row.club_id as string) ?? null,
      club_name: clubName(r),
      location_name: (row.location_name as string) ?? null,
      is_published: row.is_published as boolean,
      visibility: row.visibility as string,
      review_status: row.review_status as string,
      featured: row.featured as boolean,
      is_house: row.is_house as boolean,
      pinned_at: (row.pinned_at as string) ?? null,
      pin_rank: (row.pin_rank as number) ?? null,
      pin_note: (row.pin_note as string) ?? null,
      total_capacity: row.total_capacity as number,
      price_cents: row.price_cents as number,
      photo_urls: (row.photo_urls as string[]) ?? [],
      live:
        (row.is_published as boolean) &&
        row.review_status === 'approved' &&
        row.visibility === 'public' &&
        (row.night_date as string) >= today,
    }
  })

  return ok({ today, scope, events: rows })
}

// POST /api/portal/events — publish a house event.
//
// House rows go in APPROVED and PUBLISHED: review exists to check promoters'
// submissions, and we are not reviewing ourselves. They are also forced free —
// a house event has no Stripe Connect account behind it, so a price would fail
// at the guest's checkout. The DB constraint enforces that too; this is the
// early, legible half of the same rule.
export async function POST(req: Request) {
  const denied = await requirePortal()
  if (denied) return denied
  const sb = await createServiceClient()

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return err('Invalid JSON', 400) }

  const title = String(body.title ?? '').trim()
  const nightDate = String(body.night_date ?? '').trim()

  if (!title) return err('A title is required', 400)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nightDate)) return err('night_date must be YYYY-MM-DD', 400)
  if (nightDate < todayMadrid()) return err('That date is already past', 400)

  const capacity = Number(body.total_capacity ?? 100)
  if (!Number.isInteger(capacity) || capacity < 1) return err('Capacity must be a positive whole number', 400)

  // A house event is placed EITHER at one of our venues or at a free-text
  // address. Requiring one of the two stops an event that nobody can find.
  const clubId = body.club_id ? String(body.club_id) : null
  const locationName = String(body.location_name ?? '').trim() || null
  if (!clubId && !locationName) return err('Pick a venue, or give the location a name', 400)

  const photos = Array.isArray(body.photo_urls)
    ? (body.photo_urls as unknown[]).map(String).filter(Boolean)
    : []

  const { data, error } = await sb
    .from('promoter_nights')
    .insert({
      title,
      night_date: nightDate,
      club_id: clubId,
      location_name: locationName,
      address: String(body.address ?? '').trim() || null,
      description: String(body.description ?? '').trim() || null,
      open_time: body.open_time ? String(body.open_time) : null,
      close_time: body.close_time ? String(body.close_time) : null,
      total_capacity: capacity,
      max_plus_ones: body.max_plus_ones == null ? null : Number(body.max_plus_ones),
      photo_urls: photos,
      is_house: true,
      // Ours, so it skips the promoter review queue.
      review_status: 'approved',
      is_published: true,
      visibility: 'public',
      // Never priced — see the note above and the house-free check constraint.
      price_cents: 0,
      currency: 'eur',
      // No promoter account created this. `created_by` defaults to auth.uid(),
      // which is null for the service client; set explicitly so the intent is
      // recorded rather than inferred from an absent value.
      created_by: null,
      // `featured` is the PAID flag and is never set from here — a house event
      // cannot buy promotion from itself. Pin it instead.
      featured: false,
    })
    .select('id')
    .single()

  if (error) return err(error.message, 500)
  return ok({ id: data.id })
}
