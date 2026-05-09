import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'

function toSlug(name: string) {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// PATCH /api/admin/discover/[id]  { action: 'approve' | 'reject' }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user!.id).single()
  if (!['admin', 'staff'].includes(profile?.role ?? '')) return err('Forbidden', 403)

  const { id }     = await params
  const { action } = await req.json()

  if (action === 'reject') {
    await supabase.from('venue_suggestions').update({ status: 'rejected' }).eq('id', id)
    return ok({ rejected: true })
  }

  if (action === 'approve') {
    // Fetch the suggestion
    const { data: suggestion, error } = await supabase
      .from('venue_suggestions')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !suggestion) return err('Suggestion not found', 404)

    // Check not already imported
    const { data: existing } = await supabase
      .from('clubs')
      .select('id')
      .eq('google_place_id', suggestion.place_id)
      .maybeSingle()
    if (existing) {
      await supabase.from('venue_suggestions').update({ status: 'approved' }).eq('id', id)
      return err('Already imported', 409)
    }

    const slug = toSlug(suggestion.name)

    // Import as club
    const { data: club, error: clubErr } = await supabase
      .from('clubs')
      .insert({
        name:            suggestion.name,
        slug,
        address:         suggestion.address,
        lat:             suggestion.lat,
        lng:             suggestion.lng,
        cover_image_url: suggestion.photos?.[0] ?? null,
        gallery_urls:    suggestion.photos?.slice(1) ?? [],
        rating:          suggestion.rating,
        ratings_total:   suggestion.ratings_total,
        google_place_id: suggestion.place_id,
        photos:          suggestion.photos ?? [],
        is_active:       true,
        is_featured:     false,
        is_partner:      false,
        last_synced_at:  new Date().toISOString(),
      })
      .select()
      .single()

    if (clubErr) return err(clubErr.message)

    // Insert Gemini-suggested tags
    const tags = (suggestion.ai_tags ?? []).map((tag: string) => ({
      club_id:  club.id,
      tag,
      category: inferCategory(tag),
    }))
    if (tags.length > 0) {
      await supabase.from('club_tags').insert(tags)
    }

    // Mark suggestion as approved
    await supabase.from('venue_suggestions').update({ status: 'approved' }).eq('id', id)

    return ok(club)
  }

  return err('Invalid action')
}

function inferCategory(tag: string): string {
  const music  = ['techno','house','latin','hip_hop','indie','electronic','jazz','live_music']
  const vibe   = ['upscale','budget','mid_range','speakeasy']
  const type   = ['nightclub','bar','lounge','rooftop','cocktail_bar','restaurant','beach_club','terrace']
  if (music.includes(tag))  return 'music'
  if (vibe.includes(tag))   return 'vibe'
  if (type.includes(tag))   return 'venue_type'
  return 'feature'
}
