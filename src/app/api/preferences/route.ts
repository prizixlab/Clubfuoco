import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'

export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createServiceClient()

  const { data } = await supabase
    .from('users')
    .select('preferences, onboarding_done')
    .eq('id', user!.id)
    .single()

  return ok(data)
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createServiceClient()

  const preferences = await request.json()

  const { error } = await supabase
    .from('users')
    .update({ preferences, onboarding_done: true })
    .eq('id', user!.id)

  if (error) return err(error.message)
  return ok({ saved: true })
}
