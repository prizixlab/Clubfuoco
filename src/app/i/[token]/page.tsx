import { createServiceClient, createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import InviteClaimClient from './InviteClaimClient'

/**
 * Public guestlist invite page — anyone with the link can claim a spot.
 * Backs the "open invite link" promoters generate in the Fuoco For Promoters
 * app. Server-renders night/club info using the service role (anon visitors
 * can't read RLS-protected tables otherwise), then hands off to a tiny client
 * component that owns the form + claim POST + ticket reveal.
 */
export const dynamic = 'force-dynamic'

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const sb = await createServiceClient()
  const { data: alloc } = await sb
    .from('promoter_allocations')
    .select(`
      id, spots, group_visible, invite_token,
      night:promoter_nights (
        id, title, night_date, open_time, close_time,
        location_name, address, lat, lng, auto_checkin,
        club:clubs ( id, name, address, cover_image_url )
      ),
      promoter:users!promoter_allocations_promoter_id_fkey ( id, full_name )
    `)
    .eq('invite_token', token)
    .single()

  if (!alloc || !alloc.night) notFound()

  // Group view (only loaded if group_visible)
  let guests: { id: string; full_name: string; plus_ones: number }[] = []
  if (alloc.group_visible) {
    const { data } = await sb
      .from('promoter_guests')
      .select('id, full_name, plus_ones')
      .eq('allocation_id', alloc.id)
      .order('created_at', { ascending: true })
    guests = data ?? []
  }

  // Prefill from the logged-in Fuoco session, if any.
  let prefillName: string | null = null
  try {
    const cookieClient = await createClient()
    const { data: { user } } = await cookieClient.auth.getUser()
    if (user) {
      const { data: profile } = await cookieClient
        .from('users')
        .select('full_name')
        .eq('id', user.id)
        .single()
      prefillName = (profile?.full_name as string | undefined) ?? null
    }
  } catch {
    // signed out — fall through, form starts empty
  }

  return (
    <InviteClaimClient
      token={token}
      allocation={{
        id: alloc.id,
        spots: alloc.spots,
        groupVisible: alloc.group_visible,
      }}
      night={alloc.night as any}
      promoterName={(alloc as any).promoter?.full_name ?? null}
      initialGuests={guests}
      prefillName={prefillName}
    />
  )
}
