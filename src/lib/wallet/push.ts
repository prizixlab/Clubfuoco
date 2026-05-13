import { createServiceClient } from '@/lib/supabase/server'
import { sendPassUpdate } from './apn'

const PASS_TYPE_ID = process.env.APPLE_PASS_TYPE_ID ?? ''

/**
 * Notify all registered Apple Wallet devices for a user to fetch an updated pass.
 *
 * Call this whenever the user's membership tier, status, or expiry changes so
 * their Wallet card auto-updates (or shows as expired/removed) on-device.
 *
 * Never throws — push failures are logged but swallowed so the main flow isn't blocked.
 */
export async function pushWalletUpdate(userId: string): Promise<void> {
  if (!PASS_TYPE_ID) return

  try {
    const supabase     = await createServiceClient()
    const serialNumber = `membership-${userId}`

    const { data: registrations } = await supabase
      .from('wallet_pass_registrations')
      .select('push_token, device_library_identifier')
      .eq('serial_number', serialNumber)
      .eq('pass_type_identifier', PASS_TYPE_ID)

    if (!registrations?.length) return

    const results = await Promise.allSettled(
      registrations.map((r) => sendPassUpdate(r.push_token, PASS_TYPE_ID))
    )

    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.warn(
          `[wallet push] failed for device ${registrations[i].device_library_identifier}:`,
          r.reason
        )
      }
    })
  } catch (err) {
    console.error('[wallet push] unexpected error:', err)
  }
}
