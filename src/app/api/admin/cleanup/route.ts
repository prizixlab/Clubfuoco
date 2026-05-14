import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { classifyVenue } from '@/lib/gemini'

// Vercel function timeout — needed because each run can take up to ~3 min
export const maxDuration = 300

// How many venues to review per run.
// Free Gemini tier = 15 RPM + 1,500 RPD. We do 14 per run × 3 runs/day = 42/day,
// well under the daily quota and within RPM with a 4.5 s spacer.
const BATCH_SIZE  = 14
// Delay between Gemini calls to stay under 15 RPM (4.5 s = ~13 RPM)
const DELAY_MS    = 4_500
// Confidence threshold below which we deactivate the venue
const NOT_NIGHTLIFE_THRESHOLD = 0.55

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * GET /api/admin/cleanup
 *
 * Post-import Gemini review:
 * – Finds clubs imported by /api/admin/discover (last_synced_at IS NULL)
 * – Asks Gemini whether each one is actually a nightlife venue
 * – If clearly NOT nightlife (confidence < threshold), sets is_active = false
 * – Always sets last_synced_at = now() so we don't re-review the same venues
 * – Adds suggested_tags to club_tags table for good venues
 *
 * Protected by CRON_SECRET bearer token or ?manual=1 query param.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const isCron     = authHeader === `Bearer ${process.env.CRON_SECRET}`
  const isManual   = req.nextUrl.searchParams.get('manual') === '1'
  if (!isCron && !isManual) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()

  // Fetch clubs that haven't been reviewed by Gemini yet (last_synced_at IS NULL)
  const { data: venues, error } = await supabase
    .from('clubs')
    .select('id, name, address, google_place_id, cover_image_url, rating, ratings_total')
    .is('last_synced_at', null)
    .not('google_place_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!venues || venues.length === 0) {
    return NextResponse.json({ ok: true, message: 'No venues pending Gemini review', reviewed: 0 })
  }

  const results = { reviewed: 0, kept: 0, removed: 0, errors: 0 }

  for (const venue of venues) {
    try {
      const classification = await classifyVenue({
        name:        venue.name,
        address:     venue.address ?? '',
        types:       [],  // types not stored on the club row — rely on name/address/photo
        rating:      venue.rating,
        ratings_total: venue.ratings_total ?? 0,
        photo_url:   venue.cover_image_url,
      })

      const isGood = classification.is_nightlife && classification.confidence >= NOT_NIGHTLIFE_THRESHOLD
      const now    = new Date().toISOString()

      // Update the club: mark reviewed, deactivate if clearly not nightlife
      await supabase
        .from('clubs')
        .update({
          is_active:     isGood,
          last_synced_at: now,
        })
        .eq('id', venue.id)

      // Insert suggested tags for venues that pass the check
      if (isGood && classification.suggested_tags.length > 0) {
        const tagRows = classification.suggested_tags.map(tag => ({
          club_id:  venue.id,
          tag,
          category: inferTagCategory(tag),
        }))

        // upsert so re-runs don't duplicate
        await supabase
          .from('club_tags')
          .upsert(tagRows, { onConflict: 'club_id,tag', ignoreDuplicates: true })
      }

      if (isGood) {
        results.kept++
        console.log(`[cleanup] ✓ KEPT  "${venue.name}" — ${classification.reasoning}`)
      } else {
        results.removed++
        console.log(`[cleanup] ✗ REMOVED "${venue.name}" (confidence ${classification.confidence.toFixed(2)}) — ${classification.reasoning}`)
      }

      results.reviewed++
    } catch (e: any) {
      results.errors++
      const msg = e?.message ?? String(e)
      console.error(`[cleanup] Error reviewing "${venue.name}": ${msg}`)

      // Only mark as reviewed if it's NOT a rate-limit error — so we can retry next run
      const isRateLimit = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')
      if (!isRateLimit) {
        await supabase
          .from('clubs')
          .update({ last_synced_at: new Date().toISOString() })
          .eq('id', venue.id)
      }
    }

    // Rate-limit: pause between calls (free tier ~15 RPM)
    if (results.reviewed < venues.length) {
      await sleep(DELAY_MS)
    }
  }

  console.log(`[cleanup] Done. Reviewed ${results.reviewed}, kept ${results.kept}, removed ${results.removed}, errors ${results.errors}`)
  return NextResponse.json({ ok: true, ...results })
}

/** Map tag name to a broad category for club_tags.category */
function inferTagCategory(tag: string): string {
  const music = ['techno', 'house', 'latin', 'hip_hop', 'indie', 'electronic', 'jazz', 'live_music']
  const vibe  = ['upscale', 'budget', 'mid_range', 'beach_club', 'terrace', 'speakeasy', 'rooftop', 'lounge']
  if (music.includes(tag)) return 'music'
  if (vibe.includes(tag))  return 'vibe'
  return 'type'
}
