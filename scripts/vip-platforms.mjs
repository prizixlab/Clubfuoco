// ─────────────────────────────────────────────────────────────────────────────
// vip-platforms.mjs — STAGE 2 of the VIP-table sourcing pipeline. DRY RUN.
//
// Reads scripts/vip-websites-report.json, fetches each nightlife venue's home
// page (plus the most likely VIP/reservations sub-pages), and works out WHICH
// BOOKING PLATFORM the club has delegated its table sales to.
//
// This is the whole question. A club's own domain is a facade: almost none of
// them built a table-reservation system. They rent one — Fourvenues, Notikumi,
// CoverManager, Shopify, Dice — and that vendor owns the zone map, the rates
// and the checkout. So the integration surface is the vendor list, not the
// venue list, and this script measures how short that vendor list really is.
//
// Only fetches public pages, honours a polite delay, and follows no more than
// a handful of same-host links per venue. Writes scripts/vip-platforms-report.json.
//
// Run:  node scripts/vip-platforms.mjs
//       node scripts/vip-platforms.mjs --limit=40
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs'

const IN     = new URL('./vip-websites-report.json', import.meta.url).pathname
const REPORT = new URL('./vip-platforms-report.json', import.meta.url).pathname
const limitArg = process.argv.find(a => a.startsWith('--limit='))
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : Infinity

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

// Ordered: the first match wins as `primary`, so booking engines outrank
// site builders. Shopify/WooCommerce/Wix are recorded because a club selling
// tables through a storefront has no zone map at all — a different, worse
// integration story that we want counted separately, not lumped in as "web".
const PLATFORMS = [
  ['fourvenues',   /fourvenues\.com|site\.fourvenues|api\.fourvenues/i],
  ['notikumi',     /notikumi\.com|cdn\.notikumi/i],
  ['covermanager', /covermanager\.com/i],
  ['xceed',        /xceed\.me/i],
  ['dice',         /dice\.fm|link\.dice\.fm/i],
  ['eventbrite',   /eventbrite\.(com|es)/i],
  ['sevenrooms',   /sevenrooms\.com/i],
  ['opentable',    /opentable\.(com|es)/i],
  ['mozrest',      /mozrest\.com/i],
  ['resdiary',     /resdiary\.com/i],
  ['formitable',   /formitable\.com/i],
  ['tickettailor', /tickettailor\.com/i],
  ['shopify',      /cdn\.shopify\.com|myshopify\.com/i],
  ['woocommerce',  /woocommerce|wp-content\/plugins\/woocommerce/i],
  ['wix',          /wix\.com|wixstatic\.com|parastorage\.com/i],
  ['squarespace',  /squarespace\.com/i],
  ['typeform',     /typeform\.com/i],
  ['jotform',      /jotform\.com/i],
  ['whatsapp',     /wa\.me\/|api\.whatsapp\.com|web\.whatsapp\.com/i],
]

// Booking engines that expose a structured zone/table model we could integrate
// with. Everything else means the table sale is a form, a DM or a phone call.
const BOOKABLE = new Set(['fourvenues', 'notikumi', 'covermanager', 'sevenrooms', 'opentable', 'mozrest', 'resdiary', 'formitable'])

// Words that mark a link as leading to the table/VIP funnel rather than to the
// menu or the privacy policy. Spanish and Catalan first — that is what these
// sites are written in.
const VIP_LINK = /reservad|reserva|mesa|vip|bottle|taula|book|table|entradas|tickets/i
const VIP_TEXT = /reservado|mesas?|botella|vip|taula|bottle service|minimum spend|consumici/i

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function get(url, timeout = 15000) {
  const ctl = AbortController ? new AbortController() : null
  const t = setTimeout(() => ctl?.abort(), timeout)
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctl?.signal,
      headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8' },
    })
    const body = res.ok ? await res.text() : ''
    return { status: res.status, body: body.slice(0, 800_000), finalUrl: res.url }
  } catch (e) {
    return { status: 0, body: '', error: String(e.name || e) }
  } finally { clearTimeout(t) }
}

function detect(html) {
  const hits = []
  for (const [name, re] of PLATFORMS) if (re.test(html)) hits.push(name)
  return hits
}

/** Same-host links whose href or anchor text smells like the VIP funnel. */
function vipLinks(html, base) {
  const out = new Set()
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi
  let m
  while ((m = re.exec(html)) && out.size < 40) {
    const [, href, text] = m
    if (!VIP_LINK.test(href) && !VIP_LINK.test(text)) continue
    try {
      const u = new URL(href, base)
      if (!/^https?:$/.test(u.protocol)) continue
      u.hash = ''
      // Off-host links are the answer, not a page to crawl: a club that sends
      // you to fourvenues.com has told us everything we needed to know.
      out.add(u.toString())
    } catch { /* malformed href */ }
  }
  return [...out]
}

const input = JSON.parse(readFileSync(IN, 'utf8'))
const venues = input.rows
  .filter(r => r.website && r.types?.some(t => t === 'night_club' || t === 'bar'))
  .filter(r => r.business_status !== 'CLOSED_PERMANENTLY')
  .slice(0, LIMIT === Infinity ? undefined : LIMIT)

console.log(`probing ${venues.length} nightlife venues with a website…`)

const results = []
for (const [i, v] of venues.entries()) {
  const home = await get(v.website)
  let platforms = detect(home.body)
  const evidence = new Set()

  const base = home.finalUrl || v.website
  const links = home.body ? vipLinks(home.body, base) : []

  // An off-host VIP link is itself the finding — record the platform without
  // spending a request on it.
  const external = links.filter(l => { try { return new URL(l).host !== new URL(base).host } catch { return false } })
  for (const l of external) {
    for (const [name, re] of PLATFORMS) if (re.test(l)) { platforms.push(name); evidence.add(l) }
  }

  // Follow at most three same-host VIP pages: the booking widget is very often
  // on /reservados or /vip and absent from the home page.
  const internal = links.filter(l => !external.includes(l)).slice(0, 3)
  let vipPageText = VIP_TEXT.test(home.body)
  for (const l of internal) {
    await sleep(400)
    const sub = await get(l)
    if (!sub.body) continue
    const found = detect(sub.body)
    if (found.length) { platforms.push(...found); evidence.add(l) }
    if (VIP_TEXT.test(sub.body)) vipPageText = true
  }

  platforms = [...new Set(platforms)]
  const primary = PLATFORMS.map(p => p[0]).find(n => platforms.includes(n)) ?? null

  results.push({
    name: v.name,
    club_id: v.club_id,
    ratings_total: v.ratings_total,
    rating: v.rating,
    website: v.website,
    host: v.host,
    http: home.status,
    platforms,
    primary,
    bookable_engine: platforms.some(p => BOOKABLE.has(p)),
    mentions_vip: vipPageText,
    vip_links: [...evidence].slice(0, 6),
  })

  if ((i + 1) % 25 === 0) { console.log(`  …${i + 1}/${venues.length}`); flush() }
  await sleep(500)                       // be a good citizen
}

function flush() {
  const counts = {}
  for (const r of results) for (const p of r.platforms) counts[p] = (counts[p] || 0) + 1
  const primaryCounts = {}
  for (const r of results) { const k = r.primary ?? '(none)'; primaryCounts[k] = (primaryCounts[k] || 0) + 1 }

  writeFileSync(REPORT, JSON.stringify({
    generated_at: new Date().toISOString(),
    totals: {
      probed:          results.length,
      reachable:       results.filter(r => r.http === 200).length,
      bookable_engine: results.filter(r => r.bookable_engine).length,
      mentions_vip:    results.filter(r => r.mentions_vip).length,
    },
    platform_counts: Object.entries(counts).sort((a, b) => b[1] - a[1]),
    primary_counts:  Object.entries(primaryCounts).sort((a, b) => b[1] - a[1]),
    venues: results.sort((a, b) => (b.ratings_total ?? 0) - (a.ratings_total ?? 0)),
  }, null, 2))
}

flush()
console.log(`\ndone — report: ${REPORT}`)
