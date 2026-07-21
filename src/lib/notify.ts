import { createServiceClient } from '@/lib/supabase/server'
import { sendPushToUser, type PushApp } from '@/lib/push'

interface NotifyParams {
  user_id: string
  type: string
  title: string
  body?: string
  link?: string
  /**
   * Also send an APNs push to the user's devices for this app.
   *
   * OPT-IN on purpose. Every notify() call already writes an in-app row; making
   * push automatic would retroactively start pinging users for events that have
   * always been silent (ticket_paid, group_join…), some of which already send an
   * email. Turn it on per notification type, deliberately.
   *
   * No-op unless APNs env is configured AND the user has a registered device
   * token for that app, so it is safe to set before push is live.
   */
  push?: PushApp
}

export async function notify({ push, ...params }: NotifyParams) {
  try {
    const supabase = await createServiceClient()
    await supabase.from('notifications').insert(params)
    if (push) {
      // The in-app row is the durable record; push is best-effort delivery on
      // top of it. sendPushToUser swallows its own errors.
      await sendPushToUser(
        supabase,
        params.user_id,
        { title: params.title, body: params.body, payload: { type: params.type, link: params.link ?? '' } },
        push,
      )
    }
  } catch {
    // Non-critical — never block the main flow
  }
}
