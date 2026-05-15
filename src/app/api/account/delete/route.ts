import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'

// POST /api/account/delete — permanently delete the requesting user's account.
// The user is verified by requireAuth(); the service client then removes the
// auth user. Rows in public tables with `references auth.users(id) on delete
// cascade` are removed automatically; we also best-effort delete the profile.
export async function POST() {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createServiceClient()

  // Best-effort: remove the profile row (in case no cascade is configured)
  await supabase.from('users').delete().eq('id', user!.id)

  // Delete the auth user — this is the irreversible step
  const { error } = await supabase.auth.admin.deleteUser(user!.id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: { deleted: true } })
}
