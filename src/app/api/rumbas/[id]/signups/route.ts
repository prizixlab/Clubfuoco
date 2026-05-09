import { NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireAuth, requireRole } from '@/lib/auth'
import { ok, err } from '@/lib/utils'
import { sendRumbaConfirmation } from '@/lib/email'

// GET /api/rumbas/[id]/signups — staff/admin only — full signup list
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { response } = await requireRole(['staff', 'admin'])
  if (response) return response

  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('rumba_signups')
    .select('*')
    .eq('rumba_id', id)
    .order('created_at', { ascending: true })

  if (error) return err(error.message, 500)
  return ok(data)
}

// POST /api/rumbas/[id]/signups — authenticated user — join the list
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { user, response } = await requireAuth()
  if (response) return response

  const body = await request.json()
  const { name, plus_ones } = body

  if (!name) return err('name is required')

  const plusOnesNum = Math.min(Math.max(parseInt(plus_ones ?? '0', 10) || 0, 0), 3)

  const supabase = await createServiceClient()

  // Check if rumba exists and is active
  const { data: rumba, error: rumbaError } = await supabase
    .from('rumbas')
    .select('*')
    .eq('id', id)
    .eq('is_active', true)
    .single()

  if (rumbaError || !rumba) return err('Rumba not found or not active', 404)

  // Check capacity
  const { count } = await supabase
    .from('rumba_signups')
    .select('id', { count: 'exact', head: true })
    .eq('rumba_id', id)
    .neq('status', 'denied')

  if ((count ?? 0) >= rumba.capacity) {
    return err('This rumba is full', 409)
  }

  // Check if already signed up
  const { data: existing } = await supabase
    .from('rumba_signups')
    .select('id, status')
    .eq('rumba_id', id)
    .eq('user_id', user!.id)
    .single()

  if (existing) return err('Already signed up for this rumba', 409)

  // Get user email
  const { data: profile } = await supabase
    .from('users')
    .select('email')
    .eq('id', user!.id)
    .single()

  const email = profile?.email ?? user!.email ?? ''

  const { data: signup, error: signupError } = await supabase
    .from('rumba_signups')
    .insert({
      rumba_id: id,
      user_id: user!.id,
      name,
      email,
      plus_ones: plusOnesNum,
      status: 'confirmed',
    })
    .select()
    .single()

  if (signupError) return err(signupError.message, 500)

  // Get position on list
  const { count: position } = await supabase
    .from('rumba_signups')
    .select('id', { count: 'exact', head: true })
    .eq('rumba_id', id)
    .neq('status', 'denied')
    .lte('created_at', signup.created_at)

  // Send confirmation email
  try {
    await sendRumbaConfirmation({
      to: email,
      name,
      rumbaTitle: rumba.title,
      venueName: rumba.venue_name,
      eventDate: rumba.event_date,
      plusOnes: plusOnesNum,
      signupId: signup.id,
    })
  } catch (e) {
    console.error('Failed to send rumba confirmation email:', e)
  }

  return ok({ ...signup, position: position ?? 1 }, 201)
}
