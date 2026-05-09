import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'

// PATCH — admin marks instagram verified, maps verified, approves, or rejects
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createServiceClient()

  const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim())
  const { data: authUser } = await supabase.auth.admin.getUserById(user!.id)
  if (!ADMIN_EMAILS.includes(authUser?.user?.email ?? '')) return err('Forbidden', 403)

  const { action, admin_note } = await request.json()

  // Fetch the request
  const { data: req } = await supabase
    .from('club_verification_requests')
    .select('*')
    .eq('id', id)
    .single()
  if (!req) return err('Not found', 404)

  const updates: Record<string, any> = {}
  if (admin_note) updates.admin_note = admin_note

  if (action === 'verify_instagram') {
    updates.instagram_verified_at = new Date().toISOString()
    // If maps URL present or not required (claiming existing), move to review
    updates.status = (req.google_maps_url || req.club_id) ? 'pending_review' : 'pending_maps'

  } else if (action === 'verify_maps') {
    updates.maps_verified_at = new Date().toISOString()
    updates.status = 'pending_review'

  } else if (action === 'approve') {
    updates.status = 'approved'

    // If claiming, link the user to the club
    if (req.club_id) {
      await supabase.from('club_staff').upsert({
        user_id: req.user_id,
        club_id: req.club_id,
        role: 'admin',
      })
    } else {
      // New club — create it
      const { data: newClub } = await supabase
        .from('clubs')
        .insert({
          name: req.club_name,
          instagram_handle: req.instagram_handle,
          address: req.address,
          city: req.city,
          is_active: true,
          slug: req.club_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
        })
        .select()
        .single()

      if (newClub) {
        await supabase.from('club_staff').insert({
          user_id: req.user_id,
          club_id: newClub.id,
          role: 'admin',
        })
        updates.club_id = newClub.id
      }
    }

    // Update user account_type to 'club'
    await supabase.from('users').update({ account_type: 'club' }).eq('id', req.user_id)

    // Notify the user
    await notify({
      user_id: req.user_id,
      type: 'club_approved',
      title: 'Club verified!',
      body: `${req.club_name} is now live on Club Fuoco. Welcome aboard.`,
      link: '/club-dashboard',
    })

  } else if (action === 'reject') {
    updates.status = 'rejected'
    await notify({
      user_id: req.user_id,
      type: 'club_rejected',
      title: 'Verification update',
      body: admin_note ?? 'Your club verification request was not approved.',
      link: '/club-verify',
    })
  } else {
    return err('Unknown action')
  }

  const { data, error } = await supabase
    .from('club_verification_requests')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return err(error.message)
  return ok(data)
}
