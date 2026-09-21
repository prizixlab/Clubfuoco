import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'

// POST /api/account/delete — permanently delete the requesting user's account.
// The user is verified by requireAuth(); the service client then removes the
// auth user. All references cascade automatically:
//   auth.users → public.users (CASCADE) → owned rows (CASCADE) / audit rows
//   (SET NULL — anonymized).
// See supabase/migrations/20260615_user_delete_cascade.sql for the full policy.
export async function POST() {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createServiceClient()

  // Delete the auth user — this is the irreversible step; everything else
  // cascades (see migration 20260615_user_delete_cascade.sql).
  const { error } = await supabase.auth.admin.deleteUser(user!.id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: { deleted: true } })
}
