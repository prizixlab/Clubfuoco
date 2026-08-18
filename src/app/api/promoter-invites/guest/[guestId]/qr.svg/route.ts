import { NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { createServiceClient } from '@/lib/supabase/server'

/** Renders a simple QR encoding the guest id — door staff scans it.
 *
 *  Gated on payment. This route takes no auth by design — the guest id IS the
 *  door secret, so anyone holding it is entitled to the code — but an UNPAID
 *  spot must never render one. A held row exists and counts against capacity
 *  from the moment checkout opens, so without this check the whole paid flow
 *  fails open: start a checkout, never pay, screenshot the QR, walk in.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guestId: string }> }
) {
  const { guestId } = await params

  const sb = await createServiceClient()
  const { data: guest } = await sb
    .from('promoter_guests')
    .select('id, payment_status')
    .eq('id', guestId)
    .maybeSingle()

  if (!guest) return new NextResponse('Not found', { status: 404 })

  // 'free' is every spot on every unpaid event, including all of them today.
  // Only a started-but-unfinished purchase is refused.
  const status = (guest as { payment_status?: string }).payment_status ?? 'free'
  if (status === 'pending' || status === 'refunded') {
    return new NextResponse('Payment required', { status: 402 })
  }

  const svg = await QRCode.toString(`fuoco-invite:${guestId}`, {
    type: 'svg',
    margin: 0,
    color: { dark: '#0A0807', light: '#FFF6E5' },
  })
  return new NextResponse(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      // Was public+300s. A pass that flips from unpaid to paid must not be
      // served from a CDN copy of its own refusal, and this is per-guest.
      'Cache-Control': 'private, no-store',
    },
  })
}
