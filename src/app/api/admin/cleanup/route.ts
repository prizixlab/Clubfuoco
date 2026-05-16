import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { classifyVenue } from '@/lib/gemini'

// Vercel function timeout — this run keeps reviewing until it runs low on time.
export const maxDuration = 300

// Pace: ~4.5 s/call keeps us under the Gemini free-tier rate limit (15 RPM).
const DELAY_MS        = 4_500
// Stop starting new reviews ~35 s before the hard limit so we exit cleanly.
const TIME_BUDGET_MS  = 265_000
// Confidence at/above which a "doesn't belong" verdict actually hides the venue.
const HIDE_THRESHOLD  = 0.6
// Upper bound on rows pulled per run (a run gets through ~55 at this pace).
const MAX_BATCH       = 80

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * GET /api/admin/cleanup  — perpetual Gemini venue curation.
 *
 * Reviews visible venues against the Club Fuoco vibe (premium nightlife only),
 * ordered by `gemini_reviewed_at ASC NULLS FIRST`:
 *   • never-reviewed venues (incl. every new addition) are reviewed first
 *   • once reviewed, a venue is stamped and drops to the back of the queue
 *   • when every venue has been reviewed, the oldest review comes up next — so
 *     it loops forever, continuously re-checking the catalogue
 *
 * Each cron run works through as many as it can in its time budget, then stops.
 * If Gemini's daily quota is hit, it stops cleanly — the next run resumes from
 * the same queue position (no venue is re-reviewed or skipped).
 *
 * Protected by CRON_SECRET bearer token or ?manual=1.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const isCron     = authHeader === `Bearer ${process.env.CRON_SECRET}`
  const isManual   = req.nextUrl.searchParams.get('manual') === '1'
  if (!isCron && !isManual) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase  = await createServiceClient()
  const startedAt = Date.now()

  // Front of the queue: visible venues, never-reviewed first, then oldest review.
  // Partner / owner-claimed venues are skipped — those are never auto-hidden.
  const { data: venues, error } = await supabase
    .from('clubs')
    .select('id, name, address, cover_image_url, rating, ratings_total')
    .eq('is_active', true)
    .eq('is_partner', false)
    .is('owner_user_id', null)
    .not('google_place_id', 'is', null)
    .order('gemini_reviewed_at', { ascending: true, nullsFirst: true })
    .limit(MAX_BATCH)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!venues || venues.length === 0) {
    return NextResponse.json({ ok: true, message: 'No venues to review', reviewed: 0 })
  }

  const results = { reviewed: 0, kept: 0, hidden: 0, errors: 0, quotaHit: false }

  for (const v of venues) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break   // out of function time

    try {
      const c = await classifyVenue({
        name:          v.name,
        address:       v.address ?? '',
        types:         [],   // not stored on the row — Gemini judges name/address/photo
        rating:        v.rating,
        ratings_total: v.ratings_total ?? 0,
        photo_url:     v.cover_image_url,
      })

      const hide = !c.is_nightlife && c.confidence >= HIDE_THRESHOLD

      await supabase
        .from('clubs')
        .update({
          ...(hide ? { is_active: false } : {}),
          gemini_reviewed_at: new Date().toISOString(),
        })
        .eq('id', v.id)

      // For venues that stay, record Gemini's suggested tags.
      if (!hide && c.suggested_tags.length > 0) {
        await supabase.from('club_tags').upsert(
          c.suggested_tags.map(tag => ({ club_id: v.id, tag, category: inferTagCategory(tag) })),
          { onConflict: 'club_id,tag', ignoreDuplicates: true },
        )
      }

      if (hide) {
        results.hidden++
        console.log(`[cleanup] ✗ HIDE "${v.name}" (${c.confidence.toFixed(2)}) — ${c.reasoning}`)
      } else {
        results.kept++
      }
      results.reviewed++
    } catch (e: any) {
      const msg = e?.message ?? String(e)

      // Gemini daily quota / rate limit — stop cleanly, resume next run.
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
        results.quotaHit = true
        console.log('[cleanup] Gemini quota hit — stopping; will resume next run.')
        break
      }

      // Other error — stamp it so a permanently-bad venue doesn't block the queue.
      results.errors++
      console.error(`[cleanup] error on "${v.name}": ${msg}`)
      await supabase
        .from('clubs')
        .update({ gemini_reviewed_at: new Date().toISOString() })
        .eq('id', v.id)
    }

    if (Date.now() - startedAt <= TIME_BUDGET_MS) await sleep(DELAY_MS)
  }

  console.log(`[cleanup] reviewed ${results.reviewed} — kept ${results.kept}, hidden ${results.hidden}, errors ${results.errors}`)
  return NextResponse.json({ ok: true, ...results })
}

/** Map a suggested tag to a broad category for club_tags.category */
function inferTagCategory(tag: string): string {
  const music = ['techno', 'house', 'latin', 'hip_hop', 'indie', 'electronic', 'jazz', 'live_music']
  const vibe  = ['upscale', 'budget', 'mid_range', 'beach_club', 'terrace', 'speakeasy', 'rooftop', 'lounge']
  if (music.includes(tag)) return 'music'
  if (vibe.includes(tag))  return 'vibe'
  return 'type'
}
