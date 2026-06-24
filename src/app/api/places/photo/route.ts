import { NextRequest, NextResponse } from 'next/server'

const KEY = process.env.GOOGLE_PLACES_API_KEY!

// Edge runtime + 302 redirect. The old implementation downloaded the full
// image into Node memory and re-emitted the bytes — fine at low traffic,
// but it burned Vercel function duration + memory + bandwidth on every
// photo load (20+ per Explore feed × 10k nightly users = ~200k proxied
// images). Now: ask Google for the resolved CDN URL with redirect:
// 'manual', then 302 the client straight at it. The API key still never
// reaches the client, but the bytes flow direct from googleusercontent →
// device.
export const runtime = 'edge'

// GET /api/places/photo?ref=PHOTO_REFERENCE&maxwidth=800
export async function GET(request: NextRequest) {
  const ref      = request.nextUrl.searchParams.get('ref')
  const maxwidth = request.nextUrl.searchParams.get('maxwidth') ?? '800'

  if (!ref) return NextResponse.json({ error: 'ref required' }, { status: 400 })

  const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxwidth}&photo_reference=${ref}&key=${KEY}`

  // Don't follow the redirect — we want the resolved URL to hand back to
  // the client, not the image bytes.
  const res = await fetch(url, { redirect: 'manual' })
  const target = res.headers.get('location')
  if (!target) {
    return NextResponse.json({ error: 'photo redirect missing' }, { status: 502 })
  }

  return NextResponse.redirect(target, {
    status: 302,
    headers: {
      // Browsers/clients cache the 302 itself for 24h; subsequent hits to
      // our proxy URL get served from their own cache without ever
      // touching the function. The googleusercontent CDN cache is
      // separate and longer-lived.
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  })
}
