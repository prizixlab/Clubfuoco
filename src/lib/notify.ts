import { createServiceClient } from '@/lib/supabase/server'

interface NotifyParams {
  user_id: string
  type: string
  title: string
  body?: string
  link?: string
}

export async function notify(params: NotifyParams) {
  try {
    const supabase = await createServiceClient()
    await supabase.from('notifications').insert(params)
  } catch {
    // Non-critical — never block the main flow
  }
}
