// Seed the active "Rumba" partner brand + its per-club offers, matching the
// current hard-coded data byte-for-byte so the de-hardcoding is invisible until
// someone flips the active brand. Idempotent. Run after the partner_config
// migration is applied:  node scripts/seed-partner.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = Object.fromEntries(
  readFileSync(join(root, '.env.local'), 'utf8')
    .split('\n').filter(l => l.includes('=')).map(l => {
      const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)
const URL = env.NEXT_PUBLIC_SUPABASE_URL
const SRK = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, 'Content-Type': 'application/json' }

const BUCKET = 'brand'
const LOGO_PATH = 'rumba/logo.png'

// ── Offer builders — identical defaults/shape to src/lib/rumbalist-offers.ts ──
const FREE = (subtitle, music, dress_code, valid_days = 'Sun – Fri', time_window = 'Door open till closing') =>
  ({ kind: 'free_guestlist', title: 'Free Guestlist', subtitle, price_eur: null, party_size: null, time_window, valid_days, dress_code, music })
const VIP = (price, music, valid_days = 'Any night', size = 5) =>
  ({ kind: 'vip_table', title: 'VIP Table', subtitle: `From €${price} · ${size} people · Fully consumable on bottles`, price_eur: price, party_size: size, time_window: 'Reservation for the night', valid_days, dress_code: 'Smart casual', music })

const OFFERS = {
  'b3f7747f-d911-490d-a688-d04add6a1c8b': [
    FREE('Free till 1:00 AM', 'R&B · Hip Hop · Commercial House · Reggaeton', 'Elegant — no sneakers or sportswear', 'Every night'),
    VIP(300, 'Reggaeton · Commercial · Hits · Pop', 'Every night'),
  ],
  'd184f2f1-8db3-4d03-ae11-ad19b650894d': [
    FREE('Free till 02:30 AM', 'Reggaeton · Hip Hop · Top Hits · Techno · House', 'Smart casual — no sportswear', 'Every night'),
    VIP(300, 'Reggaeton · Hip Hop · Top Hits · R&B · Techno · House · Electronic', 'Every night'),
  ],
  'a83428e5-5c7f-4f55-99e5-3f329f7c3210': [
    FREE('Free till 2:00 AM', 'Hip Hop · R&B · Dancehall', 'Casual — no sneakers or sportswear', 'Mon, Tue, Wed, Sun'),
  ],
  'bdafd62c-2543-4238-9951-e4a1a17bb7eb': [
    FREE('Free entry + free bar till 01:00 AM', 'Reggaeton · Hip Hop · Top Hits · R&B · Techno · House · Electronic', 'Casual'),
  ],
  '3c3716e0-0361-4a62-b4d2-ec1eb5d00bbb': [
    FREE('Free till 1:00 AM', 'Reggaeton · Top Hits · House', 'Casual — no sportswear or sneakers', 'Tue, Thu – Sun'),
    VIP(300, 'Hits · Reggaeton · R&B · Commercial House · Top Hits', 'Tue, Thu – Sun'),
  ],
  'ddca5d10-9b4f-47c4-81a2-2c36bef77e49': [
    FREE('Free till 01:00 AM', 'Hip Hop · R&B · Reggaeton · Electro · Commercial House · EDM', 'Casual — no sneakers or sportswear', 'Tue, Wed, Sun'),
    VIP(300, 'Hip Hop · R&B · Reggaeton · Electro · Commercial House · EDM', 'Tue, Wed, Sun'),
  ],
  'd649395c-d3db-4397-b200-42b575d1738a': [
    FREE('Free till 1:00 AM', 'Top Hits · Reggaeton', 'Casual elegant — no sportswear', 'Tue, Wed, Sun'),
    VIP(400, 'Deep House · Tech House · Hip Hop · R&B · Pop', 'Tue, Wed, Sun'),
  ],
  '07ce6a58-ceee-48e4-89ce-3c3e6b6ff2b2': [
    VIP(250, 'Reggaeton · Commercial House · R&B · Top Hits', 'Wed'),
  ],
  '60d6f94e-26cc-4d24-bacc-8a255e1c7924': [
    VIP(300, 'Reggaeton · R&B · Top Hits', 'Thu, Fri'),
  ],
  'e0cf6310-28e5-4117-ad5f-01179f87d8fd': [
    VIP(300, 'Reggaeton · House · Top Hits', 'Thu – Sat'),
  ],
}

async function j(method, path, body, extraHeaders) {
  const res = await fetch(`${URL}${path}`, {
    method, headers: { ...H, ...extraHeaders },
    body: body === undefined ? undefined : (body instanceof Uint8Array ? body : JSON.stringify(body)),
  })
  const text = await res.text()
  return { status: res.status, body: text ? (() => { try { return JSON.parse(text) } catch { return text } })() : null }
}

async function main() {
  // 1. Public storage bucket for brand assets (idempotent).
  await j('POST', '/storage/v1/bucket', { id: BUCKET, name: BUCKET, public: true })

  // 2. Upload the current logo, get its public URL.
  const logo = readFileSync(join(root, 'public/rumbalist-logo.png'))
  const up = await fetch(`${URL}/storage/v1/object/${BUCKET}/${LOGO_PATH}`, {
    method: 'POST',
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, 'Content-Type': 'image/png', 'x-upsert': 'true' },
    body: logo,
  })
  if (!up.ok && up.status !== 409) console.warn('logo upload:', up.status, await up.text())
  const logoUrl = `${URL}/storage/v1/object/public/${BUCKET}/${LOGO_PATH}`
  console.log('logo:', logoUrl)

  // 3. Upsert the active Rumba brand (by key).
  const existing = await j('GET', '/rest/v1/partner_brands?key=eq.rumba&select=id')
  let brandId
  if (Array.isArray(existing.body) && existing.body.length) {
    brandId = existing.body[0].id
    await j('PATCH', '/rest/v1/partner_brands?key=eq.rumba',
      { name: 'Rumba', logo_url: logoUrl, color: '#FF2D92', is_active: true })
  } else {
    const ins = await j('POST', '/rest/v1/partner_brands',
      { key: 'rumba', name: 'Rumba', logo_url: logoUrl, color: '#FF2D92', is_active: true },
      { Prefer: 'return=representation' })
    brandId = ins.body[0].id
  }
  console.log('brand:', brandId)

  // 4. Replace this brand's offers with the canonical set.
  await j('DELETE', `/rest/v1/partner_offers?brand_id=eq.${brandId}`)
  const rows = []
  for (const [clubId, offers] of Object.entries(OFFERS)) {
    offers.forEach((o, i) => rows.push({ ...o, brand_id: brandId, club_id: clubId, sort_order: i }))
  }
  const insOffers = await j('POST', '/rest/v1/partner_offers', rows, { Prefer: 'return=minimal' })
  console.log('offers inserted:', insOffers.status, `${rows.length} rows across ${Object.keys(OFFERS).length} clubs`)
}

main().catch(e => { console.error(e); process.exit(1) })
