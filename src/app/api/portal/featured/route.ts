import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { logAudit } from '@/lib/portal-audit'
import { ok, err } from '@/lib/utils'

// The Featured desk — what leads Explore, chosen rather than computed.
//
//   tier 1  the big hero card at the head of the featured shelf
//   tier 2  the line of smaller cards under it
//
// Events and venues are eligible for either tier, so a slot points at exactly
// one of a promoter_nights row or a clubs row (the DB constraint enforces it).
//
// This GET returns BOTH the current slots and the pool they can be picked
// from, because the desk is useless without the pool and two round trips to
// draw one page is silly.

export interface FeaturedSlot {
  id: string
  tier: 1 | 2
  rank: number
  note: string | null
  kind: 'event' | 'venue'
  /** The featured thing's own id — a night id or a club id. */
  target_id: string
  title: string
  /** Venue name for an event; neighbourhood/address for a venue. */
  subtitle: string | null
  image: string | null
  /** Events only — so the desk can show a night that has already passed. */
  night_date: string | null
  /** Events only — false once the night is in the past or was unpublished. */
  live: boolean
}

export interface FeaturedCandidate {
  kind: 'event' | 'venue'
  id: string
  title: string
  subtitle: string | null
  night_date: string | null
  /** Already in a slot — the picker shows it as taken rather than hiding it. */
  taken: boolean
}

function todayMadrid(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

/// A club cover we can actually render — most `clubs.cover_image_url` values
/// are Google Places proxy URLs that do not load in the app, and a broken
/// image on the hero card is worse than no image. Mirrors the same filter in
/// /api/events/feed and the native NearbyClubRow.
function usableCover(url: string | null): string | null {
  if (!url) return null
  if (url.includes('maps.googleapis.com/maps/api/place/photo')) return null
  if (url.includes('/api/places/photo')) return null
  return url
}

interface SlotRow {
  id: string; tier: number; rank: number; note: string | null
  night_id: string | null; club_id: string | null; created_at: string
}

export async function GET() {
  const denied = await requirePortal()
  if (denied) return denied
  const sb = await createServiceClient()
  const today = todayMadrid()

  const { data: slotData, error: slotErr } = await sb
    .from('featured_slots')
    .select('id, tier, rank, note, night_id, club_id, created_at')
    .order('tier', { ascending: true })
    .order('rank', { ascending: true })
    .order('created_at', { ascending: true })

  // The desk is deployable before the migration is applied: an absent table
  // reads as "nothing featured yet" rather than a broken page.
  if (slotErr) {
    if (/featured_slots|does not exist|relation|schema cache/i.test(slotErr.message)) {
      return ok({ today, slots: [], candidates: await pool(sb, today, new Set()), needs_migration: true })
    }
    return err(slotErr.message, 500)
  }

  const slots = (slotData ?? []) as SlotRow[]

  // Resolve both kinds in one batch each rather than per row.
  const nightIds = slots.map(s => s.night_id).filter((v): v is string => !!v)
  const clubIds = slots.map(s => s.club_id).filter((v): v is string => !!v)

  const nights = new Map<string, Record<string, unknown>>()
  if (nightIds.length > 0) {
    const { data } = await sb
      .from('promoter_nights')
      .select('id, title, night_date, photo_urls, location_name, club_id, is_published, visibility, review_status')
      .in('id', nightIds)
    for (const n of data ?? []) nights.set(n.id as string, n as Record<string, unknown>)
  }

  // Club names are wanted for BOTH kinds: a featured venue's own name, and the
  // venue an featured event is held at.
  const allClubIds = [...new Set([
    ...clubIds,
    ...[...nights.values()].map(n => n.club_id).filter((v): v is string => typeof v === 'string'),
  ])]
  const clubs = new Map<string, { name: string; cover: string | null; area: string | null }>()
  if (allClubIds.length > 0) {
    const { data } = await sb
      .from('clubs')
      .select('id, name, cover_image_url, neighborhood, address')
      .in('id', allClubIds)
    for (const c of data ?? []) {
      clubs.set(c.id as string, {
        name: c.name as string,
        cover: usableCover(c.cover_image_url as string | null),
        area: ((c.neighborhood as string) ?? (c.address as string)) ?? null,
      })
    }
  }

  const out: FeaturedSlot[] = []
  for (const s of slots) {
    if (s.night_id) {
      const n = nights.get(s.night_id)
      // A slot whose night was deleted is skipped rather than rendered blank;
      // the cascade normally removes it first.
      if (!n) continue
      const photos = (n.photo_urls as string[]) ?? []
      const club = typeof n.club_id === 'string' ? clubs.get(n.club_id) : undefined
      out.push({
        id: s.id, tier: s.tier === 1 ? 1 : 2, rank: s.rank, note: s.note,
        kind: 'event', target_id: s.night_id,
        title: (n.title as string) ?? 'Untitled night',
        subtitle: club?.name ?? (n.location_name as string) ?? null,
        image: photos[0] ?? club?.cover ?? null,
        night_date: (n.night_date as string) ?? null,
        live: !!n.is_published && n.review_status === 'approved'
          && n.visibility === 'public' && (n.night_date as string) >= today,
      })
    } else if (s.club_id) {
      const c = clubs.get(s.club_id)
      if (!c) continue
      out.push({
        id: s.id, tier: s.tier === 1 ? 1 : 2, rank: s.rank, note: s.note,
        kind: 'venue', target_id: s.club_id,
        title: c.name, subtitle: c.area, image: c.cover,
        night_date: null, live: true,
      })
    }
  }

  const taken = new Set(out.map(s => `${s.kind}:${s.target_id}`))
  return ok({ today, slots: out, candidates: await pool(sb, today, taken) })
}

/// What can be put in a slot: every upcoming night of ours, and every venue.
///
/// Scraped RA listings are deliberately absent — they have no consumer detail
/// page, so featuring one would put a card at the top of the feed that opens
/// nothing.
async function pool(
  sb: Awaited<ReturnType<typeof createServiceClient>>,
  today: string,
  taken: Set<string>,
): Promise<FeaturedCandidate[]> {
  const out: FeaturedCandidate[] = []

  const { data: nights } = await sb
    .from('promoter_nights')
    .select('id, title, night_date, location_name, club_id')
    .gte('night_date', today)
    .order('night_date', { ascending: true })
    .limit(200)

  const clubIds = [...new Set((nights ?? [])
    .map(n => n.club_id).filter((v): v is string => typeof v === 'string'))]
  const names = new Map<string, string>()
  if (clubIds.length > 0) {
    const { data } = await sb.from('clubs').select('id, name').in('id', clubIds)
    for (const c of data ?? []) names.set(c.id as string, c.name as string)
  }

  for (const n of nights ?? []) {
    const id = n.id as string
    out.push({
      kind: 'event', id,
      title: (n.title as string) ?? 'Untitled night',
      subtitle: (typeof n.club_id === 'string' ? names.get(n.club_id) : null)
        ?? (n.location_name as string) ?? null,
      night_date: (n.night_date as string) ?? null,
      taken: taken.has(`event:${id}`),
    })
  }

  // Partner venues lead the list — they are the ones we would actually
  // promote — but every club stays pickable.
  const { data: clubs } = await sb
    .from('clubs')
    .select('id, name, neighborhood, address, is_partner')
    .order('is_partner', { ascending: false })
    .order('name', { ascending: true })
    .limit(400)

  for (const c of clubs ?? []) {
    const id = c.id as string
    out.push({
      kind: 'venue', id,
      title: c.name as string,
      subtitle: ((c.neighborhood as string) ?? (c.address as string)) ?? null,
      night_date: null,
      taken: taken.has(`venue:${id}`),
    })
  }

  return out
}

// POST /api/portal/featured — put something in a tier.
// { kind: 'event' | 'venue', id: string, tier: 1 | 2, note?: string }
export async function POST(request: NextRequest) {
  const denied = await requirePortal()
  if (denied) return denied

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return err('Invalid JSON')

  const kind = body.kind
  const id = typeof body.id === 'string' ? body.id : ''
  const tier = Number(body.tier)
  if (kind !== 'event' && kind !== 'venue') return err('kind must be event or venue')
  if (!id) return err('id is required')
  if (tier !== 1 && tier !== 2) return err('tier must be 1 or 2')

  const sb = await createServiceClient()

  // New slots go to the end of their tier rather than the top: adding
  // something should never silently reorder what is already there.
  const { data: last } = await sb
    .from('featured_slots')
    .select('rank')
    .eq('tier', tier)
    .order('rank', { ascending: false })
    .limit(1)
  const rank = ((last?.[0]?.rank as number) ?? -1) + 1

  const row: Record<string, unknown> = {
    tier, rank,
    note: typeof body.note === 'string' && body.note.trim() !== '' ? body.note.trim() : null,
    night_id: kind === 'event' ? id : null,
    club_id: kind === 'venue' ? id : null,
  }

  const { error } = await sb.from('featured_slots').insert(row)
  if (error) {
    if (/duplicate key|featured_slots_(night|club)_uniq/i.test(error.message)) {
      return err('That is already featured — move it between tiers instead of adding it twice.')
    }
    if (/featured_slots|does not exist|relation|schema cache/i.test(error.message)) {
      return err('Featured needs a schema change that has not been applied yet — run ' +
                 'supabase/migrations/20260911_featured_slots.sql in the SQL editor.', 503)
    }
    return err(error.message, 500)
  }

  await logAudit(sb, {
    action: 'featured.add',
    summary: `Featured ${kind} in tier ${tier}`,
    target_type: kind, target_id: id, meta: { tier, rank },
  })
  return ok({ added: true, tier, rank })
}
