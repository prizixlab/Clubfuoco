import { NextRequest, NextResponse } from 'next/server'

const KEY = process.env.GOOGLE_PLACES_API_KEY!

// GET /api/places/photo?ref=PHOTO_REFERENCE&maxwidth=800
// Proxies Google Places photo so the API key never reaches the client.
// Google returns a redirect to the actual image — we follow it and stream back.
export async function GET(request: NextRequest) {
  const ref      = request.nextUrl.searchParams.get('ref')
  const maxwidth = request.nextUrl.searchParams.get('maxwidth') ?? '800'

  if (!ref) return NextResponse.json({ error: 'ref required' }, { status: 400 })

  const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxwidth}&photo_reference=${ref}&key=${KEY}`

  // fetch follows redirects by default
  const res = await fetch(url)
  if (!res.ok) return NextResponse.json({ error: 'photo fetch failed' }, { status: 502 })

  const contentType = res.headers.get('content-type') ?? 'image/jpeg'
  const buffer = await res.arrayBuffer()

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400', // cache 24h — photo refs don't change often
    },
  })
}
