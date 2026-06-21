import { NextResponse } from 'next/server'
import QRCode from 'qrcode'

/** Renders a simple QR encoding the guest id — door staff scans it. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guestId: string }> }
) {
  const { guestId } = await params
  const svg = await QRCode.toString(`fuoco-invite:${guestId}`, {
    type: 'svg',
    margin: 0,
    color: { dark: '#0A0807', light: '#FFF6E5' },
  })
  return new NextResponse(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=300',
    },
  })
}
