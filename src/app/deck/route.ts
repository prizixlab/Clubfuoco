// No supabase-js here on purpose: its storage .download() goes through the
// Storage CDN, which kept serving a previous deck for minutes after an
// upload. We hit the storage REST endpoint directly with a cache-buster and
// `no-store` so a freshly uploaded deck is live immediately.

/**
 * GET /deck — the investor deck.
 *
 * This URL is sent to investors in cold outreach and must NEVER change, so
 * the file behind it is swappable instead: re-run `scripts/upload_deck.py`
 * with a new PDF and every link already in someone's inbox serves the new
 * deck. Nothing about the URL is versioned.
 *
 * The bucket is private and the PDF is streamed through here with the
 * service key, so the raw Storage URL can't be passed around or indexed,
 * and access can later be gated or logged in this one place.
 */

const BUCKET = 'investor'
const OBJECT = 'deck.pdf'
const FILENAME = 'Club-Fuoco-Pre-Seed.pdf'   // what it saves as

export const dynamic = 'force-dynamic'

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return new Response('Deck unavailable', { status: 503 })
  }

  const src =
    `${url.replace(/\/$/, '')}/storage/v1/object/${BUCKET}/${OBJECT}` +
    `?t=${Date.now()}`

  const upstream = await fetch(src, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
    cache: 'no-store',
  })

  if (!upstream.ok) {
    // Don't leak storage internals to a prospective investor.
    console.error('[deck] storage fetch failed:', upstream.status)
    return new Response('Deck unavailable', { status: 404 })
  }

  return new Response(await upstream.arrayBuffer(), {
    headers: {
      'Content-Type': 'application/pdf',
      // inline so it opens in the browser rather than forcing a download
      'Content-Disposition': `inline; filename="${FILENAME}"`,
      // Never cache at the edge or in the browser. The whole point of this
      // route is that the deck behind the URL can change at any moment, and
      // an investor opening a link from an old email must get the CURRENT
      // deck. The file is ~1MB, so re-fetching costs nothing that matters.
      'Cache-Control': 'no-store, max-age=0, must-revalidate',
    },
  })
}
