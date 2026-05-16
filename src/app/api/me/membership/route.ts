import { NextResponse }    from 'next/server'
import { createClient }    from '@/lib/supabase/server'
import { requireAuth }     from '@/lib/auth'

// GET /api/me/membership
// Returns member number, renewal date, and assigned host for the dashboard.
export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createClient()

  const [userRes, membershipRes, hostRes] = await Promise.all([
    supabase
      .from('users')
      .select('member_number, membership_tier')
      .eq('id', user!.id)
      .single(),

    supabase
      .from('memberships')
      .select('valid_until, status')
      .eq('user_id', user!.id)
      .maybeSingle(),

    supabase
      .from('member_host_assignments')
      .select('fuoco_hosts ( id, name, role, phone, whatsapp_url, avatar_initial, years_with_fuoco, cities )')
      .eq('user_id', user!.id)
      .maybeSingle(),
  ])

  const memberNumber = userRes.data?.member_number ?? null
  const validUntil   = membershipRes.data?.valid_until ?? null
  const host         = (hostRes.data as any)?.fuoco_hosts ?? null

  return NextResponse.json({ memberNumber, validUntil, host })
}
