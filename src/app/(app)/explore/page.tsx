'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { ExternalEvent } from '@/lib/tickets'
import type { Rumba } from '@/types'

interface Place {
  place_id:     string
  name:         string
  slug:         string
  address:      string
  neighborhood: string | null
  lat:          number
  lng:          number
  rating:       number | null
  ratings_total:number
  price_level:  number | null
  is_open:      boolean | null
  website:      string | null
  maps_url:     string
  cover_photo:  string | null
  photo_refs:   string[]
  // enriched from our DB
  music_genres: string[]
  tags:         string[]
  google_place_id: string | null
  is_featured:  boolean
  is_partner:   boolean
  general_entry_price: number | null
  distance?:    number
  // set when this place has a matched RA event
  upcoming_event?: {
    title:         string
    date:          string
    display_price: number
    base_price:    number
    currency:      string
    platform_url:  string
  }
}

interface Shelf {
  id:       string
  title:    string
  subtitle: string
  places:   Place[]
  featured?: boolean  // first shelf gets hero treatment
  _rumbas?: Rumba[]   // rumba-shelf override
}

// ── Client-side venue matching (mirrors server logic) ─────────────────────────
const VENUE_STOPWORDS = new Set([
  'barcelona','club','bar','the','lounge','hotel','cafe','music',
  'night','live','room','space','house','disco','dance','party',
  'venue','stage','place','sala','local','bcn','spain',
])
function normName(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
}
function venueMatchClient(a: string, b: string): boolean {
  const na = normName(a), nb = normName(b)
  if (na === nb) return true
  const meaningful = (s: string) => s.split(' ').filter(w => w.length > 3 && !VENUE_STOPWORDS.has(w))
  const wa = meaningful(na), wb = new Set(meaningful(nb))
  return wa.length > 0 && wa.some(w => wb.has(w))
}
function fmtEventDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

const PRICE_LABEL = ['Free', '€', '€€', '€€€', '€€€€']

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R    = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function fmtDistance(km: number) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`
}

function budgetToPriceLevel(euros: number): number {
  if (euros >= 999) return 4
  if (euros >= 80)  return 3
  if (euros >= 40)  return 2
  if (euros >= 20)  return 1
  return 0
}

function timeGreeting() {
  const h = new Date().getHours()
  if (h < 17) return 'Planning Tonight?'
  if (h < 21) return 'Good Evening'
  return 'Ready to Ignite?'
}

// --- Algorithmic shelf builder ---
function buildShelves(places: Place[], prefs: any, raEvents: ExternalEvent[] = [], rumbas: Rumba[] = [], surveyPrefs: any = null, tasteProfile: any = null): Shelf[] {
  if (!places.length) return []
  const shelves: Shelf[] = []

  // ── helpers ──────────────────────────────────────────────────────────────
  const nameHas  = (p: Place, kws: string[]) =>
    kws.some(kw => p.name.toLowerCase().includes(kw))
  const addrHas  = (p: Place, kws: string[]) =>
    kws.some(kw => (p.address + ' ' + (p.neighborhood ?? '')).toLowerCase().includes(kw))
  const genreHas = (p: Place, kws: string[]) =>
    kws.some(kw => (p.music_genres ?? []).some(g => g.toLowerCase().includes(kw)))
  const tagHas   = (p: Place, kws: string[]) =>
    kws.some(kw => (p.tags ?? []).some(t => t.toLowerCase().includes(kw)))
  // anyHas checks name, address/neighbourhood, stored music genres, and Gemini tags
  const anyHas   = (p: Place, kws: string[]) =>
    nameHas(p, kws) || addrHas(p, kws) || genreHas(p, kws) || tagHas(p, kws)

  // Normalise a venue name for fuzzy matching
  const normV = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

  // Survey-based boost: returns a score adjustment based on past surveys
  function surveyScore(p: Place): number {
    if (!surveyPrefs) return 0
    let score = 0
    const nameL = p.name.toLowerCase()
    const norm  = normV(p.name)

    // Venues they loved → strong boost for similar (name-matched) venues
    for (const liked of surveyPrefs.likedVenueNames ?? []) {
      if (norm === normV(liked) || nameL.includes(liked.toLowerCase().slice(0, 6))) score += 5
    }
    // Venues they hated → penalise
    for (const avoid of surveyPrefs.avoidPlaceNames ?? []) {
      if (norm === normV(avoid) || nameL.includes(avoid.toLowerCase().slice(0, 6))) score -= 10
    }

    // Drink signal → venue type boost
    if (surveyPrefs.likesCocktails && anyHas(p, ['cocktail', 'mixology', 'speakeasy', 'gin', 'craft'])) score += 3
    if (surveyPrefs.likesBeer      && anyHas(p, ['pub', 'cervecería', 'brew', 'beer', 'craft']))         score += 3
    if (surveyPrefs.likesWine      && anyHas(p, ['wine', 'bodega', 'vinoteca', 'vino']))                 score += 3
    if (surveyPrefs.likesShots     && anyHas(p, ['club', 'disco', 'party', 'night']))                    score += 2

    // Preferred price level
    if (surveyPrefs.preferredPriceLevel !== null && p.price_level !== null) {
      const diff = Math.abs(p.price_level - surveyPrefs.preferredPriceLevel)
      score += Math.max(0, 3 - diff)
    }

    // Vibe signals — positive only: they proved they enjoy this venue type's energy
    if (surveyPrefs.goodVibeAtClub  && anyHas(p, ['club', 'disco', 'rave', 'dance', 'techno', 'house', 'sala'])) score += 2
    if (surveyPrefs.goodVibeAtBar   && anyHas(p, ['bar', 'pub', 'lounge', 'cafe', 'cocktail', 'jazz', 'wine']))  score += 2
    if (surveyPrefs.likesBusyVenues && (p.ratings_total > 200 || (p.rating ?? 0) >= 4.3))                        score += 1

    return score
  }

  // Taste profile boost from stored tag-based signals
  function tasteScore(p: Place): number {
    if (!tasteProfile) return 0
    let score = 0
    const nameL = p.name.toLowerCase()
    const addr  = (p.address ?? '').toLowerCase()

    // Neighbourhood match
    for (const n of tasteProfile.top_neighborhoods ?? []) {
      if (addr.includes(n.toLowerCase()) || nameL.includes(n.toLowerCase())) score += 3
    }

    // Music genre tags → boost venues whose names hint at the genre
    const GENRE_KW: Record<string, string[]> = {
      techno:     ['techno', 'input', 'nitsa', 'bunker', 'sala'],
      house:      ['house', 'pacha', 'bling'],
      latin:      ['latin', 'salsa', 'reggaeton', 'shoko', 'latino'],
      hip_hop:    ['sutton', 'urban', 'hip', 'hop', 'otto'],
      indie:      ['indie', 'apolo', 'razzmatazz', 'razz'],
      electronic: ['electronic', 'moog', 'macarena', 'mondo'],
      jazz:       ['jazz', 'blues', 'acoustic', 'live'],
    }
    for (const genre of tasteProfile.top_genres ?? []) {
      const kws = GENRE_KW[genre] ?? []
      if (kws.some(k => nameL.includes(k))) score += 4
    }

    // Vibe tags
    const VIBE_KW: Record<string, string[]> = {
      upscale:    ['club', 'lounge', 'vip', 'sutton', 'bling', 'pacha'],
      budget:     ['pub', 'bar', 'cervecería', 'brew'],
      rooftop:    ['rooftop', 'terraza', 'sky', 'top'],
      mid_range:  ['cocktail', 'bistro', 'café'],
    }
    for (const vibe of tasteProfile.top_vibes ?? []) {
      const kws = VIBE_KW[vibe] ?? []
      if (kws.some(k => nameL.includes(k))) score += 2
    }

    return score
  }

  function prefScore(p: Place): number {
    let score = surveyScore(p) + tasteScore(p)   // both signal layers
    if (!prefs) return score
    if (prefs.budget && p.price_level !== null) {
      const target = budgetToPriceLevel(prefs.budget)
      score += Math.max(0, 3 - Math.abs(p.price_level - target))
    }
    const nameL = p.name.toLowerCase()
    const vibeKw: Record<string, string[]> = {
      beach:       ['beach', 'mar', 'maritim', 'port'],
      rooftop:     ['rooftop', 'sky', 'terraza', 'top'],
      upscale:     ['club', 'lounge', 'vip', 'suite'],
      underground: ['underground', 'bunker', 'basement', 'techno'],
      live_music:  ['music', 'jazz', 'live', 'concert'],
      wild:        ['club', 'disco', 'party'],
      intimate:    ['bar', 'bistro', 'wine'],
    }
    ;(prefs.vibes ?? []).forEach((v: string) => {
      if (vibeKw[v]?.some(kw => nameL.includes(kw))) score += 2
    })
    if (prefs.crowd === 'lgbtq') {
      if (['arena', 'metro', 'pride', 'gay'].some(kw => nameL.includes(kw))) score += 3
    }
    if (p.rating && p.rating >= 4.2) score += 1
    if (p.rating && p.rating >= 4.5) score += 1
    return score
  }

  const top  = (arr: Place[], n = 12) => arr.slice(0, n)
  const byRating   = (a: Place, b: Place) => (b.rating ?? 0) - (a.rating ?? 0)
  const byPopular  = (a: Place, b: Place) => b.ratings_total - a.ratings_total
  const byDistance = (a: Place, b: Place) => (a.distance ?? 99) - (b.distance ?? 99)
  const shuffle    = <T,>(arr: T[]): T[] => [...arr].sort(() => Math.random() - 0.5)

  // ── 1. FOR YOU — hero (always first) ─────────────────────────────────────
  const forYou = [...places]
    .sort((a, b) => {
      const open = (b.is_open ? 1 : 0) - (a.is_open ? 1 : 0)
      return open !== 0 ? open : prefScore(b) - prefScore(a)
    })
    .slice(0, 12)
  shelves.push({ id: 'for_you', title: 'For You Tonight', subtitle: 'Matched to your taste', places: forYou, featured: true })

  // ── 2. RUMBAS (active guest list events) ─────────────────────────────────
  // Injected as second shelf only when rumbas exist — completely absent otherwise
  // Rumbas don't belong to Place so they get their own shelf type (empty places array used as placeholder)
  if (rumbas.length > 0) {
    shelves.push({ id: 'rumbas', title: "Tonight's Rumbas", subtitle: 'Exclusive guest list events', places: [] as Place[], _rumbas: rumbas } as any)
  }

  // ── 2b. SURVEY-BASED "Based on Your Nights Out" ──────────────────────────
  if (surveyPrefs && surveyPrefs.surveyCount >= 1) {
    // Rank all places by survey score, exclude venues they want to avoid
    const avoidNorms = new Set((surveyPrefs.avoidPlaceNames ?? []).map(normV))
    const surveyed = [...places]
      .filter(p => !avoidNorms.has(normV(p.name)))
      .map(p => ({ p, score: surveyScore(p) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || (b.p.rating ?? 0) - (a.p.rating ?? 0))
      .map(({ p }) => p)
      .slice(0, 12)

    if (surveyed.length >= 2) {
      shelves.push({
        id:       'survey_pick',
        title:    'Based on Your Nights Out',
        subtitle: `Personalised from ${surveyPrefs.surveyCount} ${surveyPrefs.surveyCount === 1 ? 'review' : 'reviews'} you've left`,
        places:   surveyed,
      })
    }
  }

  // ── 3. EVENTS TONIGHT (RA tickets available) ──────────────────────────────
  if (raEvents.length > 0) {
    const eventPlaces: Place[] = []
    for (const place of places) {
      const matched = raEvents.filter(e => venueMatchClient(e.venue_name, place.name))
      if (matched.length === 0) continue
      const next = matched.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0]
      eventPlaces.push({
        ...place,
        upcoming_event: {
          title:         next.title,
          date:          next.date,
          display_price: next.display_price,
          base_price:    next.base_price,
          currency:      next.currency,
          platform_url:  next.platform_url,
        },
      })
    }
    if (eventPlaces.length >= 2)
      shelves.push({ id: 'events_tonight', title: 'Events Tonight', subtitle: 'Tickets available through Club Fuoco', places: eventPlaces.slice(0, 12) })
  }

  // ── 3. OPEN RIGHT NOW ─────────────────────────────────────────────────────
  const openNow = places.filter(p => p.is_open === true)
  if (openNow.length)
    shelves.push({ id: 'open_now', title: 'Open Right Now', subtitle: 'Doors are open — get in', places: top(openNow.sort(byRating)) })

  // ── 3. DRINK SHELVES (preference-based) ───────────────────────────────────
  const drinks: string[] = prefs?.drinks ?? []
  const COCKTAIL_VALS = ['cocktails','Espresso Martini','Aperol Spritz','Mojito','Negroni','Margarita','Gin & Tonic','Long Island Iced Tea','Daiquiri','Cosmopolitan','Paloma','Old Fashioned','Whiskey Sour','Manhattan','Dark & Stormy','Moscow Mule','Piña Colada','Sex on the Beach','Tequila Sunrise','Sidecar','Bramble','French 75','Kir Royale','Bellini','Mimosa','Hugo','Tom Collins','Singapore Sling','Caipirinha','Pisco Sour','Mai Tai','White Russian','Bloody Mary','Cuba Libre','Spicy Margarita','Mezcal Negroni','Jungle Bird','Paper Plane','Last Word','Penicillin','Clover Club','Porn Star Martini','Gimlet',"Bee's Knees"]
  const hasCocktail  = drinks.some(d => COCKTAIL_VALS.includes(d))
  const hasWine      = drinks.some(d => ['wine','Red Wine','White Wine','Rosé','Sangria','Cava','Prosecco','Rioja','Albariño'].includes(d))
  const hasBeer      = drinks.some(d => ['beer','Estrella Damm','Moritz','Heineken','Corona','Craft IPA','Lager','Stout'].includes(d))
  const hasShots     = drinks.some(d => ['shots','Tequila','Vodka','Whiskey','Jägermeister','Sambuca'].includes(d))
  const hasChampagne = drinks.some(d => ['champagne',"Moët & Chandon",'Veuve Clicquot',"Dom Pérignon"].includes(d))
  const heroCocktail = drinks.find(d => !['cocktails','beer','wine','shots','champagne','non_alcoholic'].includes(d)) ?? null

  if (hasCocktail) {
    const spots = places.filter(p => (p.price_level ?? 0) >= 2)
    if (spots.length) shelves.push({ id: 'cocktails', title: heroCocktail ? `Best ${heroCocktail} Bars` : 'Top Cocktail Bars', subtitle: heroCocktail ? `You love a good ${heroCocktail}` : 'Craft cocktails near you', places: top(spots.sort(byRating)) })
  }
  if (hasChampagne) {
    const spots = places.filter(p => (p.price_level ?? 0) >= 3)
    if (spots.length) shelves.push({ id: 'champagne', title: 'Bottles & Champagne', subtitle: 'VIP-worthy nights', places: top(spots.sort(byRating)) })
  }
  if (hasWine) {
    const spots = places.filter(p => anyHas(p, ['wine','bodega','vinoteca','vino']) || (p.price_level ?? 0) === 2)
    if (spots.length) shelves.push({ id: 'wine', title: 'Wine & Good Vibes', subtitle: 'For the wine lover in you', places: top(spots.sort(byRating)) })
  }
  if (hasShots) {
    const spots = places.filter(p => anyHas(p, ['bar','club','disco','shot','party']) || (p.price_level ?? 0) <= 2)
    if (spots.length) shelves.push({ id: 'shots', title: "Shot O'Clock", subtitle: 'High-energy bars near you', places: top(shuffle(spots)) })
  }
  if (hasBeer) {
    const spots = places.filter(p => anyHas(p, ['bar','pub','cervecería','beer','brew','craft']) || (p.price_level ?? 0) <= 2)
    if (spots.length) shelves.push({ id: 'beer', title: 'Cold Beer Near You', subtitle: 'Local bars & pubs', places: top(spots.sort(byRating)) })
  }

  // ── 4. MUSIC (preference-based, looser matching) ──────────────────────────
  const musicKwMap: Record<string, { kws: string[]; label: string; sub: string }> = {
    Techno:        { kws: ['techno','bunker','basement','underground','industrial','raw','fabric'], label: 'Techno & Dark Rooms',  sub: 'Where the bass never stops'    },
    House:         { kws: ['house','groove','disco','soul','funk','dance'],                         label: 'House Music Spots',    sub: 'For the 4/4 faithful'          },
    Latin:         { kws: ['latin','salsa','mambo','cubano','latino','caribe','tropical'],          label: 'Latin Nights',         sub: 'Dance until sunrise'           },
    'Hip-Hop':     { kws: ['hip','hop','urban','trap','rap','street'],                              label: 'Hip-Hop & Urban',      sub: 'The right playlist guaranteed' },
    Reggaeton:     { kws: ['reggaeton','perreo','latino','latin','trap'],                           label: 'Reggaeton Nights',     sub: 'Feel the beat'                 },
    Afrobeats:     { kws: ['afro','africa','beats','naija','amapiano'],                             label: 'Afrobeats Vibes',      sub: 'Good energy guaranteed'        },
    Electronic:    { kws: ['electronic','dj','rave','festival','edm'],                              label: 'Electronic Scene',     sub: 'All-night sets'                },
    'Drum & Bass': { kws: ['dnb','drum','bass','jungle','liquid'],                                  label: 'DnB & Bass',           sub: 'Fast & loud'                   },
    'R&B':         { kws: ['r&b','rnb','soul','neo','motown'],                                      label: 'R&B Nights',           sub: 'Smooth, soulful, sexy'         },
    Commercial:    { kws: ['club','pop','commercial','chart','hits'],                               label: 'Chart Toppers',        sub: 'All the bangers'               },
    Reggaeton2:    { kws: ['club','party','fiesta','night'],                                        label: 'Party Clubs',          sub: 'Pure vibes, no agenda'         },
  }
  ;(prefs?.music ?? []).slice(0, 3).forEach((genre: string) => {
    const cfg = musicKwMap[genre]
    if (!cfg) return
    // looser: if no name matches, fall back to top-rated clubs for that genre
    const matched = places.filter(p => anyHas(p, cfg.kws))
    const pool    = matched.length >= 2 ? matched : [...places].sort(byRating).slice(0, 8)
    shelves.push({ id: `music_${genre}`, title: cfg.label, subtitle: cfg.sub, places: top(pool.sort(byRating)) })
  })

  // ── 5. VIBE (preference-based, looser matching) ───────────────────────────
  const vibeConfig: Record<string, { kws: string[]; label: string; sub: string }> = {
    beach:       { kws: ['beach','mar','maritim','port','sea','playa','barceloneta'], label: 'Beach & Waterfront',  sub: 'Where the sea meets the night' },
    rooftop:     { kws: ['rooftop','sky','terraza','top','roof','terrace'],           label: 'Rooftop Terraces',    sub: 'City lights from above'        },
    upscale:     { kws: ['club','lounge','vip','suite','luxury','elite'],             label: 'Upscale & VIP',       sub: 'The finer side of the night'   },
    underground: { kws: ['underground','bunker','basement','tunnel','raw'],           label: 'Underground Clubs',   sub: 'No-phone, no-rules energy'     },
    live_music:  { kws: ['music','jazz','live','concert','arts','sala'],              label: 'Live Music',          sub: 'Real instruments, real night'  },
    dancing:     { kws: ['club','disco','dance','pista','sala','bailar'],             label: 'Dance All Night',     sub: 'Floor-filling from open to close'},
    wild:        { kws: ['club','party','wild','night','fest'],                       label: 'Party Hard',          sub: 'No filter, full send'          },
    intimate:    { kws: ['bar','bistro','wine','café','lounge','small'],              label: 'Intimate Spots',      sub: 'Cozy bars & low-key lounges'   },
  }
  ;(prefs?.vibes ?? []).slice(0, 3).forEach((vibe: string) => {
    const cfg = vibeConfig[vibe]
    if (!cfg) return
    const matched = places.filter(p => anyHas(p, cfg.kws))
    const pool    = matched.length >= 2 ? matched : [...places].sort(byRating).slice(0, 8)
    shelves.push({ id: `vibe_${vibe}`, title: cfg.label, subtitle: cfg.sub, places: top(pool.sort(byRating)) })
  })

  // ── 6. LGBTQ+ ────────────────────────────────────────────────────────────
  if (prefs?.crowd === 'lgbtq') {
    const spots = places.filter(p => anyHas(p, ['arena','metro','pride','gay','freedom','rainbow','lesbian','eixample']))
    if (spots.length) shelves.push({ id: 'lgbtq', title: 'LGBTQ+ Spaces', subtitle: 'Safe, proud & loud', places: spots })
  }

  // ── 7. ROTATING POOL — built fresh every reload ───────────────────────────
  const pool: Shelf[] = []
  const candidate = (id: string, title: string, subtitle: string, pts: Place[], min = 2) => {
    if (pts.length >= min) pool.push({ id, title, subtitle, places: top(pts) })
  }

  // ── QUALITY ───────────────────────────────────────────────────────────────
  candidate('closest',    'Closest to You',          "Walk, don't drive",                [...places].sort(byDistance))
  candidate('top_rated',  'Highest Rated',            'The crowd has spoken',             [...places].filter(p => p.rating !== null && p.ratings_total > 30).sort(byRating))
  candidate('icons',      'Barcelona Icons',          'Legendary — everyone knows them',  [...places].filter(p => p.ratings_total > 300).sort(byPopular), 3)
  candidate('gems',       'Hidden Gems',              'Under the radar, totally worth it',[...places].filter(p => (p.rating ?? 0) >= 4.0 && p.ratings_total < 300).sort(byRating))
  candidate('value',      'Best Value',               'Great night, small bill',          [...places].filter(p => (p.price_level ?? 2) <= 1 && (p.rating ?? 0) >= 3.5).sort(byRating))
  candidate('luxury',     'Upscale & Exclusive',      'Dress to impress',                 [...places].filter(p => (p.price_level ?? 0) >= 3).sort(byRating))
  candidate('partner',    'Club Fuoco Partners',      'Official partner venues',          [...places].filter(p => p.is_partner).sort(byRating), 1)
  candidate('featured',   'Featured Tonight',         'Hand-picked for you',              [...places].filter(p => p.is_featured).sort(byRating), 1)
  candidate('photos',     'Worth the Photo',          'Visually stunning venues',         [...places].filter(p => p.cover_photo).sort(byRating), 3)
  candidate('new_to_you', 'New to You',               'Places you haven\'t tried yet',    shuffle([...places]).slice(0, 12))
  candidate('most_popular','Most Popular Right Now',  'Everyone\'s talking about these',  [...places].sort(byPopular))
  candidate('local_fav',  'Local Favourites',         'Where Barcelonians actually go',   shuffle([...places].filter(p => (p.rating ?? 0) >= 4.0)).slice(0, 12))
  candidate('wild_card',  'Surprise Me',              'We picked for you — trust us',     shuffle([...places]).slice(0, 12))
  candidate('late_night', 'Still Going Strong',       'Open & rated highly right now',    [...places].filter(p => p.is_open === true && (p.rating ?? 0) >= 3.8).sort(byRating))

  // ── VENUE TYPE ────────────────────────────────────────────────────────────
  candidate('clubs',      'Clubs & Discos',           'Proper dancefloors all night',     [...places].filter(p => anyHas(p, ['club','disco','discoteca','sala','nightclub'])).sort(byRating))
  candidate('bars',       'Bars & Lounges',           'Pre-drinks or the whole night',    [...places].filter(p => anyHas(p, ['bar','lounge','pub','tavern'])).sort(byRating))
  candidate('cocktail',   'Cocktail Bars',            'Craft drinks, serious bartenders', [...places].filter(p => anyHas(p, ['cocktail','mixology','speakeasy','craft','gin'])).sort(byRating))
  candidate('rooftop',    'Rooftop Terraces',         'City lights from above',           [...places].filter(p => anyHas(p, ['rooftop','roof','sky','terraza','terrace','terrat'])).sort(byRating))
  candidate('beach',      'Beach Clubs',              'Sand, sea and bass',               [...places].filter(p => anyHas(p, ['beach','playa','chiringuito','mar','maritim','barceloneta'])).sort(byRating))
  candidate('live_music', 'Live Music Venues',        'Real instruments, real feeling',   [...places].filter(p => anyHas(p, ['live','music','jazz','concert','acoustic','sala'])).sort(byRating))
  candidate('jazz',       'Jazz & Soul Bars',         'Low light, high vibe',             [...places].filter(p => anyHas(p, ['jazz','soul','blues','swing','bossa'])).sort(byRating))
  candidate('karaoke',    'Karaoke Nights',           'Your moment to shine',             [...places].filter(p => anyHas(p, ['karaoke','kara','sing','singing'])).sort(byRating))
  candidate('sports',     'Sports Bars',              'The game + a cold one',            [...places].filter(p => anyHas(p, ['sports','sport','futbol','football','rugby','hockey'])).sort(byRating))
  candidate('speakeasy',  'Hidden & Speakeasy',       'You\'ll know it when you find it', [...places].filter(p => anyHas(p, ['speakeasy','hidden','secret','door','password'])).sort(byRating))
  candidate('wine',       'Wine Bars',                'Natural, biodynamic, delicious',   [...places].filter(p => anyHas(p, ['wine','vino','bodega','vinoteca','cava','enologia'])).sort(byRating))
  candidate('beer',       'Beer & Craft Pubs',        'Cold pint, good company',          [...places].filter(p => anyHas(p, ['beer','pub','brew','cerveza','cervecería','craft','ipa'])).sort(byRating))
  candidate('shots',      "Shot O'Clock",             'High energy from the first round', [...places].filter(p => anyHas(p, ['shot','party','fiesta','tequila','vodka'])).sort(byRating))
  candidate('lgbtq_all',  'LGBTQ+ Friendly',          'Inclusive, welcoming, loud',       [...places].filter(p => anyHas(p, ['gay','lgbtq','pride','rainbow','queer','trans','lesbian','metro','arena'])).sort(byRating))

  // ── MUSIC GENRES ──────────────────────────────────────────────────────────
  candidate('techno',     'Techno & Dark Rooms',      'Where the bass never stops',       [...places].filter(p => anyHas(p, ['techno','industrial','bunker','raw','underground','hard'])).sort(byRating))
  candidate('house',      'House Music',              'For the 4/4 faithful',             [...places].filter(p => anyHas(p, ['house','groove','deep','afro','funky'])).sort(byRating))
  candidate('latin',      'Latin Nights',             'Salsa, merengue, reggaeton',       [...places].filter(p => anyHas(p, ['latin','salsa','mambo','cubano','caribe','tropical','merengue'])).sort(byRating))
  candidate('hiphop',     'Hip-Hop & Urban',          'The right playlist, guaranteed',   [...places].filter(p => anyHas(p, ['hip','hop','urban','trap','rap','street','drill'])).sort(byRating))
  candidate('reggaeton',  'Reggaeton',                'Feel the beat, move your feet',    [...places].filter(p => anyHas(p, ['reggaeton','perreo','dembow','bachata'])).sort(byRating))
  candidate('rnb',        'R&B & Neo Soul',           'Smooth, soulful, sexy',            [...places].filter(p => anyHas(p, ['r&b','rnb','soul','neo','motown','funk'])).sort(byRating))
  candidate('electronic', 'Electronic & EDM',         'All-night DJ sets',                [...places].filter(p => anyHas(p, ['electronic','edm','dj','rave','festival','synth'])).sort(byRating))
  candidate('afrobeats',  'Afrobeats & Amapiano',     'Good energy is guaranteed',        [...places].filter(p => anyHas(p, ['afro','africa','amapiano','naija','afrobeat'])).sort(byRating))
  candidate('dnb',        'Drum & Bass',              'Fast, loud, relentless',           [...places].filter(p => anyHas(p, ['dnb','drum','bass','jungle','liquid','neurofunk'])).sort(byRating))
  candidate('indie',      'Indie & Alternative',      'For those who go their own way',   [...places].filter(p => anyHas(p, ['indie','alternative','rock','punk','grunge'])).sort(byRating))
  candidate('pop',        'Pop & Chart Hits',         'Every banger, back to back',       [...places].filter(p => anyHas(p, ['pop','chart','commercial','hits','top40'])).sort(byRating))
  candidate('retro',      '80s & 90s Throwback',      'When the hits were the hits',      [...places].filter(p => anyHas(p, ['retro','80s','90s','throwback','classic','oldschool'])).sort(byRating))
  candidate('flamenco',   'Flamenco & Spanish',       'Raw passion, Barcelona-style',     [...places].filter(p => anyHas(p, ['flamenco','rumba','española','tablao','cante'])).sort(byRating))
  candidate('reggae',     'Reggae & Dub',             'Irie vibes only',                  [...places].filter(p => anyHas(p, ['reggae','dub','ska','rasta','jamaican'])).sort(byRating))

  // ── NEIGHBOURHOOD ─────────────────────────────────────────────────────────
  candidate('barceloneta','Barceloneta & Seafront',   'Salt air and bass drops',          [...places].filter(p => anyHas(p, ['barceloneta','marítim','maritim','passeig mar','port olímpic','olympic','olimpic'])).sort(byRating))
  candidate('gothic',     'Gothic Quarter',           'Ancient streets, all-night energy',[...places].filter(p => anyHas(p, ['gothic','gòtic','barri','gotic','call','ferran','escudellers'])).sort(byRating))
  candidate('raval',      'El Raval',                 'Raw, creative, unapologetic',      [...places].filter(p => anyHas(p, ['raval','rambla del raval','hospital','robador','joaquin costa'])).sort(byRating))
  candidate('born',       'El Born & Sant Pere',      'Cool bars, cooler crowd',          [...places].filter(p => anyHas(p, ['born','borne','sant pere','princesa','comerç','montcada','brossolí'])).sort(byRating))
  candidate('eixample',   'Eixample',                 'The Gayxample & beyond',           [...places].filter(p => anyHas(p, ['eixample','gran via','gràcia','diagonal','provença','consell de cent','muntaner','enric granados'])).sort(byRating))
  candidate('gracia',     'Gràcia',                   'Neighbourhood bars, big personality',[...places].filter(p => anyHas(p, ['gràcia','gracia','verdi','travessera','fontana','lesseps','torrent'])).sort(byRating))
  candidate('poblenou',   'Poblenou & Rambla Prim',   'Warehouse clubs and art bars',     [...places].filter(p => anyHas(p, ['poblenou','prim','llull','pallars','rambla prim','bogatell','selva mar'])).sort(byRating))
  candidate('montjuic',   'Montjuïc & Poble Sec',     'Outdoor terraces and secret spots',[...places].filter(p => anyHas(p, ['montjuïc','montjuic','poble sec','paral·lel','paralel','avinguda del paral'])).sort(byRating))
  candidate('sarria',     'Sarrià & Zona Alta',       'Upscale neighbourhood nights',     [...places].filter(p => anyHas(p, ['sarrià','sarria','sant gervasi','bonanova','pedralbes','tibidabo','turó'])).sort(byRating))
  candidate('sants',      'Sants & Les Corts',        'Local and unpretentious',          [...places].filter(p => anyHas(p, ['sants','corts','badal','plaça sants','hostafrancs'])).sort(byRating))
  candidate('clot',       'Clot & Sant Martí',        'Off the tourist trail',            [...places].filter(p => anyHas(p, ['clot','sant martí','navas','encants','glòries','glories'])).sort(byRating))

  // ── OCCASION ──────────────────────────────────────────────────────────────
  candidate('date_night', 'Date Night',               'Impress from the first drink',     [...places].filter(p => anyHas(p, ['cocktail','wine','lounge','bistro','speakeasy','jazz','rooftop']) && (p.rating ?? 0) >= 3.8).sort(byRating))
  candidate('group',      'Group Night Out',          'Big enough for your whole crew',   [...places].filter(p => (p.ratings_total > 100)).sort(byPopular))
  candidate('pre_drinks', 'Pre-Drinks Spots',         'Start the night right',            [...places].filter(p => anyHas(p, ['bar','pub','lounge','café']) && (p.price_level ?? 2) <= 2).sort(byRating))
  candidate('birthday',   'Birthday Worthy',          'Make it a night to remember',      [...places].filter(p => (p.ratings_total > 50) && (p.rating ?? 0) >= 4.0).sort(byRating))
  candidate('first_timer','First Time in Barcelona?', 'Start with these',                 [...places].filter(p => p.ratings_total > 200).sort(byPopular))
  candidate('after_work', 'After Work',               'Straight from the office',         [...places].filter(p => anyHas(p, ['bar','lounge','café','wine','beer']) && (p.price_level ?? 2) <= 2).sort(byRating))
  candidate('solo',       'Good Solo',                'Easy to walk in alone',            [...places].filter(p => anyHas(p, ['bar','pub','café','lounge','jazz','live']) && (p.rating ?? 0) >= 3.8).sort(byRating))
  candidate('students',   'Student Nights',           'Big fun, small budget',            [...places].filter(p => (p.price_level ?? 2) <= 1).sort(byPopular))

  // ── SHUFFLE the entire pool and append to fixed shelves ───────────────────
  const rotatingPool = shuffle(pool)

  // Budget fit — personalised, added after shuffle so it stays relevant
  if (prefs?.budget && prefs.budget < 999) {
    const target = budgetToPriceLevel(prefs.budget)
    const fits   = [...places].filter(p => p.price_level !== null && p.price_level <= target).sort(byRating).slice(0, 12)
    if (fits.length >= 2)
      shelves.push({ id: 'budget', title: 'Fits Your Budget', subtitle: `Under €${prefs.budget} per night`, places: fits })
  }

  // Append rotating pool
  for (const s of rotatingPool) shelves.push(s)

  const validShelves = shelves.filter(s => s.places.length > 0 || (s._rumbas && s._rumbas.length > 0))

  // Stagger: ensure each shelf leads with a place not yet seen at the front of a prior shelf
  const usedAsLead = new Set<string>()
  return validShelves.map(shelf => {
    if (shelf.featured) {
      shelf.places.slice(0, 4).forEach(p => usedAsLead.add(p.place_id))
      return shelf
    }
    const fresh    = shelf.places.filter(p => !usedAsLead.has(p.place_id))
    const repeat   = shelf.places.filter(p =>  usedAsLead.has(p.place_id))
    const reordered = [...fresh, ...repeat]
    reordered.slice(0, 3).forEach(p => usedAsLead.add(p.place_id))
    return { ...shelf, places: reordered }
  })
}

// ── Cinema-style Card Components ──────────────────────────────────────────────

function HeroCard({ place, isSaved, onSave }: { place: Place; isSaved: boolean; onSave: (id: string) => void }) {
  const genre = place.music_genres?.length > 0 ? place.music_genres[0] : 'Featured'
  return (
    <Link href={`/clubs/place/${place.place_id}`}>
      <div className="relative w-full rounded-2xl overflow-hidden active:scale-[0.99] transition-transform">
        {/* Image */}
        <div className="relative h-64 w-full">
          {place.cover_photo
            ? <img src={place.cover_photo} alt={place.name} className="w-full h-full object-cover rounded-2xl" />
            : <div className="w-full h-full bg-surface-container-high rounded-2xl flex items-center justify-center">
                <span className="material-symbols-outlined text-[48px] text-on-surface-variant/20">nightlife</span>
              </div>
          }
          {/* Top-to-bottom gradient */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 to-transparent rounded-2xl" />

          {/* Genre tag top-left */}
          <div className="absolute top-sm left-sm">
            <span className="text-[9px] uppercase tracking-widest text-white bg-black/50 backdrop-blur-sm rounded-full px-xs py-[3px]">
              {genre}
            </span>
          </div>

          {/* Rating top-right */}
          {place.rating && (
            <div className="absolute top-sm right-sm flex items-center gap-[3px] bg-black/60 backdrop-blur-sm rounded-full px-xs py-[3px]">
              <span className="material-symbols-outlined text-[12px] text-yellow-400" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
              <span className="text-white text-[11px] font-bold">{place.rating.toFixed(1)}</span>
            </div>
          )}
        </div>

        {/* Below image content */}
        <div className="pt-sm pb-xs">
          <p className="text-[10px] uppercase tracking-[0.2em] text-primary mb-[2px]">FEATURED TONIGHT</p>
          <p className="font-display italic text-[26px] text-on-surface leading-tight"><em>{place.name}</em></p>
          <p className="text-xs text-on-surface-variant/60 mt-xs truncate">{place.address}{place.price_level !== null && place.price_level !== undefined ? ` · ${PRICE_LABEL[place.price_level]}` : ''}</p>
          <p className="text-primary text-sm font-semibold mt-xs">View Club →</p>
        </div>
      </div>
    </Link>
  )
}

function LandCard({ place, isSaved, onSave }: { place: Place; isSaved: boolean; onSave: (id: string) => void }) {
  const genre = place.music_genres?.length > 0 ? place.music_genres[0] : 'Club'
  return (
    <Link href={`/clubs/place/${place.place_id}`}>
      <div className="flex-shrink-0 w-[62vw] max-w-[260px] rounded-xl overflow-hidden relative active:scale-[0.97] transition-transform">
        {/* Image */}
        <div className="relative h-[150px] bg-surface-container-high">
          {place.cover_photo
            ? <img src={place.cover_photo} alt={place.name} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center">
                <span className="material-symbols-outlined text-[32px] text-on-surface-variant/20">nightlife</span>
              </div>
          }
          {/* Bottom-to-top gradient */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />

          {/* Genre tag top-left */}
          <div className="absolute top-xs left-xs">
            <span className="text-[9px] text-white bg-black/50 backdrop-blur-sm rounded-full px-xs py-[2px] uppercase tracking-wide">
              {genre}
            </span>
          </div>

          {/* Save button top-right */}
          <button
            onClick={e => { e.preventDefault(); e.stopPropagation(); onSave(place.place_id) }}
            className="absolute top-xs right-xs w-7 h-7 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center"
          >
            <span
              className="material-symbols-outlined text-[16px] transition-colors"
              style={{
                color: isSaved ? '#ff4d6d' : 'white',
                fontVariationSettings: isSaved ? "'FILL' 1" : "'FILL' 0",
              }}
            >favorite</span>
          </button>

          {/* Bottom overlay text */}
          <div className="absolute bottom-0 left-0 right-0 px-xs pb-xs">
            <p className="font-bold text-white text-sm leading-tight truncate">{place.name}</p>
            <p className="text-white/60 text-[11px] truncate mt-[1px]">
              {place.neighborhood ?? ''}{place.neighborhood && place.price_level !== null ? ' · ' : ''}{place.price_level !== null && place.price_level !== undefined ? PRICE_LABEL[place.price_level] : ''}
            </p>
          </div>
        </div>
      </div>
    </Link>
  )
}

function PosterCard({ place, isSaved, onSave }: { place: Place; isSaved: boolean; onSave: (id: string) => void }) {
  return (
    <Link href={`/clubs/place/${place.place_id}`}>
      <div className="flex-shrink-0 w-[38vw] max-w-[155px] rounded-xl overflow-hidden relative active:scale-[0.97] transition-transform bg-surface-container">
        {/* Image */}
        <div className="relative h-[160px] bg-surface-container-high">
          {place.cover_photo
            ? <img src={place.cover_photo} alt={place.name} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center">
                <span className="material-symbols-outlined text-[32px] text-on-surface-variant/20">nightlife</span>
              </div>
          }

          {/* Open / distance chip top-left */}
          <div className="absolute top-xs left-xs">
            {place.is_open === true
              ? <span className="chip-open text-[9px] px-xs py-[2px]">OPEN</span>
              : place.distance !== undefined
                ? <span className="text-[9px] text-white bg-black/50 backdrop-blur-sm rounded-full px-xs py-[2px]">{fmtDistance(place.distance)}</span>
                : null
            }
          </div>

          {/* Save button top-right */}
          <button
            onClick={e => { e.preventDefault(); e.stopPropagation(); onSave(place.place_id) }}
            className="absolute top-xs right-xs w-7 h-7 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center"
          >
            <span
              className="material-symbols-outlined text-[16px] transition-colors"
              style={{
                color: isSaved ? '#ff4d6d' : 'white',
                fontVariationSettings: isSaved ? "'FILL' 1" : "'FILL' 0",
              }}
            >favorite</span>
          </button>
        </div>

        {/* Info below image */}
        <div className="px-xs py-xs">
          <p className="font-bold text-on-surface text-sm leading-tight truncate">{place.name}</p>
          <p className="text-xs text-on-surface-variant/60 truncate mt-[2px]">{place.neighborhood ?? place.address}</p>
        </div>
      </div>
    </Link>
  )
}

// Special card for "Events Tonight" shelf — shows event details overlay
function EventShelfCard({ place }: { place: Place }) {
  const ev = place.upcoming_event
  return (
    <Link href={`/clubs/place/${place.place_id}`}>
      <div className="flex-shrink-0 w-[62vw] max-w-[260px] rounded-xl overflow-hidden relative active:scale-[0.97] transition-transform">
        <div className="relative h-[140px] bg-surface-container-high">
          {place.cover_photo
            ? <img src={place.cover_photo} alt={place.name} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center">
                <span className="material-symbols-outlined text-[32px] text-on-surface-variant/20">nightlife</span>
              </div>
          }
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
          {/* Ticket badge */}
          <div className="absolute top-xs left-xs bg-primary/90 backdrop-blur-sm rounded-full px-xs py-[2px] flex items-center gap-[3px]">
            <span className="material-symbols-outlined text-[10px] text-on-primary" style={{ fontVariationSettings: "'FILL' 1" }}>confirmation_number</span>
            <span className="font-label-sm text-[9px] text-on-primary uppercase tracking-widest">Tickets</span>
          </div>
          {ev?.display_price !== undefined && (
            <div className="absolute top-xs right-xs bg-black/60 backdrop-blur-sm rounded-full px-xs py-[2px] flex items-center justify-center">
              <span className="font-label-sm text-[10px] text-white font-bold leading-none">
                {ev.display_price === 0 ? 'FREE' : `From €${Math.ceil(ev.display_price / 100)}`}
              </span>
            </div>
          )}
          {/* Bottom info */}
          <div className="absolute bottom-0 left-0 right-0 px-xs pb-xs">
            <p className="font-body-md font-bold text-white text-sm leading-tight truncate">{place.name}</p>
            {ev && (
              <p className="font-label-sm text-[10px] text-white/70 truncate mt-[1px]">{ev.title}</p>
            )}
            {ev && (
              <p className="font-label-sm text-[9px] text-primary/90 uppercase tracking-widest mt-[2px]">
                {fmtEventDate(ev.date)}
              </p>
            )}
          </div>
        </div>
      </div>
    </Link>
  )
}

// Card for the Rumbas shelf
function RumbaShelfCard({ rumba }: { rumba: Rumba }) {
  const spotsLeft = Math.max(0, rumba.capacity - (rumba.signup_count ?? 0))
  const isFull    = spotsLeft === 0
  const d         = new Date(rumba.event_date)
  const dateLabel = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const timeLabel = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return (
    <Link href={`/rumbas/${rumba.id}`}>
      <div className="flex-shrink-0 w-[62vw] max-w-[260px] rounded-xl overflow-hidden relative active:scale-[0.97] transition-transform">
        <div className="relative h-[140px] bg-surface-container-high">
          {rumba.cover_image
            ? <img src={rumba.cover_image} alt={rumba.title} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center">
                <span className="material-symbols-outlined text-[48px] text-primary/30" style={{ fontVariationSettings: "'FILL' 1" }}>local_fire_department</span>
              </div>
          }
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
          {/* Fire badge */}
          <div className="absolute top-xs left-xs bg-primary/90 backdrop-blur-sm rounded-full px-xs py-[2px] flex items-center gap-[3px]">
            <span className="material-symbols-outlined text-[10px] text-white" style={{ fontVariationSettings: "'FILL' 1" }}>local_fire_department</span>
            <span className="font-label-sm text-[9px] text-white uppercase tracking-widest">Rumba</span>
          </div>
          {/* Spots badge */}
          <div className="absolute top-xs right-xs bg-black/60 backdrop-blur-sm rounded-full px-xs py-[2px]">
            <span className={`font-label-sm text-[10px] font-bold ${isFull ? 'text-red-400' : 'text-white'}`}>
              {isFull ? 'Full' : `${spotsLeft} left`}
            </span>
          </div>
          {/* Bottom info */}
          <div className="absolute bottom-0 left-0 right-0 px-xs pb-xs">
            <p className="font-body-md font-bold text-white text-sm leading-tight truncate">{rumba.title}</p>
            <p className="font-label-sm text-[10px] text-white/70 truncate mt-[1px]">{rumba.venue_name}</p>
            <p className="font-label-sm text-[9px] text-primary/90 uppercase tracking-widest mt-[2px]">
              {dateLabel} · {timeLabel}
            </p>
          </div>
        </div>
      </div>
    </Link>
  )
}

function ShelfRow({ shelf, saved, onSave, index }: { shelf: Shelf; saved: Set<string>; onSave: (id: string) => void; index: number }) {
  // Rumba shelf — special rendering
  if (shelf.id === 'rumbas' && shelf._rumbas && shelf._rumbas.length > 0) {
    return (
      <section className="mb-md">
        <div className="px-container-padding mb-sm">
          <p className="text-[10px] text-on-surface-variant/50 uppercase tracking-widest mb-[2px]">{shelf.subtitle}</p>
          <div className="flex items-baseline justify-between">
            <h2 className="font-h1 text-h1 text-on-surface">{shelf.title}</h2>
            <span className="text-xs text-primary">See all →</span>
          </div>
        </div>
        <div className="flex gap-sm overflow-x-auto no-scrollbar pl-container-padding pr-sm pb-xs">
          {shelf._rumbas.map(r => <RumbaShelfCard key={r.id} rumba={r} />)}
        </div>
      </section>
    )
  }

  if (shelf.featured) {
    return (
      <section className="mb-md">
        <div className="px-container-padding mb-sm">
          <p className="text-[10px] text-on-surface-variant/50 uppercase tracking-widest mb-[2px]">{shelf.subtitle}</p>
          <div className="flex items-baseline justify-between">
            <h2 className="font-h1 text-h1 text-on-surface">{shelf.title}</h2>
            <span className="text-xs text-primary">See all →</span>
          </div>
        </div>
        {/* HeroCard for first place */}
        {shelf.places[0] && (
          <div className="px-container-padding mb-sm">
            <HeroCard place={shelf.places[0]} isSaved={saved.has(shelf.places[0].place_id)} onSave={onSave} />
          </div>
        )}
        {/* PosterCards for the rest */}
        {shelf.places.length > 1 && (
          <div className="flex gap-sm overflow-x-auto no-scrollbar pl-container-padding pr-sm pb-xs">
            {shelf.places.slice(1).map(p => (
              <PosterCard key={p.place_id} place={p} isSaved={saved.has(p.place_id)} onSave={onSave} />
            ))}
          </div>
        )}
      </section>
    )
  }

  const isEventsShelf = shelf.id === 'events_tonight'

  // Determine card type for this shelf
  const usePosters = shelf.id.includes('for_you') || index % 2 === 0

  return (
    <section className="mb-md">
      <div className="px-container-padding mb-sm">
        <p className="text-[10px] text-on-surface-variant/50 uppercase tracking-widest mb-[2px]">{shelf.subtitle}</p>
        <div className="flex items-baseline justify-between">
          <h2 className="font-h1 text-h1 text-on-surface">{shelf.title}</h2>
          {isEventsShelf
            ? <span className="text-[9px] text-primary uppercase tracking-widest bg-primary/10 rounded-full px-xs py-[2px]">Live</span>
            : <span className="text-xs text-primary">See all →</span>
          }
        </div>
      </div>
      <div className="flex gap-sm overflow-x-auto no-scrollbar pl-container-padding pr-sm pb-xs">
        {shelf.places.map(p =>
          isEventsShelf
            ? <EventShelfCard key={p.place_id} place={p} />
            : usePosters
              ? <PosterCard key={p.place_id} place={p} isSaved={saved.has(p.place_id)} onSave={onSave} />
              : <LandCard key={p.place_id} place={p} isSaved={saved.has(p.place_id)} onSave={onSave} />
        )}
      </div>
    </section>
  )
}

// ── Filter chips ──────────────────────────────────────────────────────────────

const FILTER_CHIPS = [
  { id: 'all',       label: 'All' },
  { id: 'open',      label: 'Open Now' },
  { id: 'free',      label: 'Free' },
  { id: 'cocktails', label: 'Cocktails' },
  { id: 'live',      label: 'Live Music' },
  { id: 'dancing',   label: 'Dancing' },
  { id: 'rooftop',   label: 'Rooftop' },
  { id: 'techno',    label: 'Techno' },
  { id: 'house',     label: 'House' },
  { id: 'latin',     label: 'Latin' },
]

function filterPlaces(places: Place[], activeFilter: string): Place[] {
  if (activeFilter === 'all') return places
  const nameTagIncludes = (p: Place, kws: string[]) => {
    const combined = (p.name + ' ' + (p.tags ?? []).join(' ')).toLowerCase()
    return kws.some(kw => combined.includes(kw))
  }
  const genreIncludes = (p: Place, kws: string[]) =>
    kws.some(kw => (p.music_genres ?? []).some(g => g.toLowerCase().includes(kw)))

  switch (activeFilter) {
    case 'open':      return places.filter(p => p.is_open === true)
    case 'free':      return places.filter(p => p.price_level === 0 || p.general_entry_price === 0)
    case 'cocktails': return places.filter(p => nameTagIncludes(p, ['cocktail']))
    case 'live':      return places.filter(p => nameTagIncludes(p, ['live','jazz','music','concert']))
    case 'dancing':   return places.filter(p => nameTagIncludes(p, ['danc','disco','club']))
    case 'rooftop':   return places.filter(p => nameTagIncludes(p, ['roof','terraza','terrace']))
    case 'techno':    return places.filter(p => genreIncludes(p, ['techno']) || nameTagIncludes(p, ['techno']))
    case 'house':     return places.filter(p => genreIncludes(p, ['house']) || nameTagIncludes(p, ['house']))
    case 'latin':     return places.filter(p => genreIncludes(p, ['latin','salsa','reggaeton']) || nameTagIncludes(p, ['latin','salsa','reggaeton']))
    default:          return places
  }
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ExplorePage() {
  const [places,       setPlaces]       = useState<Place[]>([])
  const [loading,      setLoading]      = useState(true)
  const [prefs,        setPrefs]        = useState<any>(null)
  const [surveyPrefs,  setSurveyPrefs]  = useState<any>(null)
  const [tasteProfile, setTasteProfile] = useState<any>(null)
  const [userPos,      setUserPos]      = useState<{ lat: number; lng: number } | null>(null)
  const [search,       setSearch]       = useState('')
  const [showSearch,   setShowSearch]   = useState(false)
  const [error,        setError]        = useState('')
  const [raEvents,     setRaEvents]     = useState<ExternalEvent[]>([])
  const [rumbas,       setRumbas]       = useState<Rumba[]>([])
  const [activeFilter, setActiveFilter] = useState('all')
  const [saved,        setSaved]        = useState<Set<string>>(new Set())

  const BARCELONA = { lat: 41.3851, lng: 2.1734 }

  function handleSave(placeId: string) {
    setSaved(prev => {
      const next = new Set(prev)
      if (next.has(placeId)) next.delete(placeId)
      else next.add(placeId)
      return next
    })
  }

  useEffect(() => {
    fetch('/api/preferences')
      .then(r => r.json())
      .then(d => setPrefs(d.data?.preferences ?? null))
    // Survey-derived preference profile for personalised recommendations
    fetch('/api/surveys/preferences')
      .then(r => r.json())
      .then(d => setSurveyPrefs(d.data ?? null))
      .catch(() => {})
    // Computed taste profile from bookings + surveys + tags
    fetch('/api/me/taste-profile')
      .then(r => r.json())
      .then(d => setTasteProfile(d.data ?? null))
      .catch(() => {})
    // Fetch all upcoming Barcelona RA events for the events shelf
    const fetchEvents = () =>
      fetch('/api/events?all=true')
        .then(r => r.json())
        .then(d => setRaEvents(d.data ?? []))
        .catch(() => {})
    fetchEvents()
    // Auto-refresh events every 5 minutes so tonight's listings stay current
    const eventsTimer = setInterval(fetchEvents, 5 * 60 * 1000)

    // Fetch active rumbas for the rumba shelf
    fetch('/api/rumbas')
      .then(r => r.json())
      .then(d => setRumbas(d.data ?? []))
      .catch(() => {})

    return () => clearInterval(eventsTimer)
  }, [])

  useEffect(() => {
    if (!navigator.geolocation) { loadPlaces(BARCELONA); return }
    navigator.geolocation.getCurrentPosition(
      pos => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setUserPos(coords)
        loadPlaces(coords)
      },
      () => loadPlaces(BARCELONA),
      { timeout: 8000, enableHighAccuracy: true }
    )
  }, [])

  async function loadPlaces(coords: { lat: number; lng: number }) {
    setLoading(true)
    try {
      const res  = await fetch(`/api/places/nearby?lat=${coords.lat}&lng=${coords.lng}&radius=3000`)
      const data = await res.json()
      if (data.error) { setError(data.error); setLoading(false); return }
      const withDist = (data.data ?? []).map((p: Place) => ({
        ...p,
        distance: haversineKm(coords.lat, coords.lng, p.lat, p.lng),
      }))
      setPlaces(withDist)
    } catch {
      setError('Could not load nearby clubs')
    }
    setLoading(false)
  }

  const filteredPlaces = filterPlaces(places, activeFilter)
  const shelves = buildShelves(filteredPlaces, prefs, raEvents, rumbas, surveyPrefs, tasteProfile)

  const searchResults = search
    ? places.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.address.toLowerCase().includes(search.toLowerCase())
      )
    : []

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <span className="material-symbols-outlined text-[64px] text-primary block mb-md animate-pulse"
          style={{ fontVariationSettings: "'FILL' 1" }}>location_on</span>
        <p className="font-h2 text-h2 text-on-surface mb-xs">Finding clubs near you</p>
        <p className="font-body-md text-on-surface-variant">Loading tonight's lineup…</p>
      </div>
    )
  }

  return (
    <div className="pt-md pb-8">
      {/* Search bar header */}
      <div className="px-container-padding mb-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-label-sm text-label-sm text-primary uppercase tracking-widest">Barcelona</p>
            <h1 className="font-display text-h1 text-on-surface tracking-[0.12em] uppercase">{timeGreeting()}</h1>
          </div>
          <button onClick={() => setShowSearch(s => !s)}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${showSearch ? 'bg-primary-container text-on-primary-container' : 'bg-surface-container text-on-surface-variant'}`}>
            <span className="material-symbols-outlined text-[20px]">{showSearch ? 'close' : 'search'}</span>
          </button>
        </div>

        {/* Search bar — slide in */}
        {showSearch && (
          <div className="relative mt-sm">
            <span className="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-[18px]">search</span>
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search clubs, neighbourhoods…"
              className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl pl-10 pr-sm py-sm font-body-md text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary-container/60"
            />
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-container-padding glass-card p-sm rounded-xl border border-error/30 flex items-center gap-sm mb-md">
          <span className="material-symbols-outlined text-error text-[20px]">error</span>
          <p className="font-body-md text-on-surface-variant text-sm">{error}</p>
        </div>
      )}

      {/* Search results */}
      {showSearch && search && (
        <div className="px-container-padding space-y-sm mb-xl">
          {searchResults.length === 0
            ? <p className="font-body-md text-on-surface-variant/50 text-center py-lg">No clubs found for "{search}"</p>
            : searchResults.map(p => (
                <Link key={p.place_id} href={`/clubs/place/${p.place_id}`}>
                  <div className="glass-card rounded-xl overflow-hidden flex items-center gap-sm p-sm active:scale-[0.99] transition-transform">
                    <div className="w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 bg-surface-container-high">
                      {p.cover_photo
                        ? <img src={p.cover_photo} alt={p.name} className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center"><span className="material-symbols-outlined text-[20px] text-on-surface-variant/20">nightlife</span></div>
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-body-md font-bold text-on-surface truncate">{p.name}</p>
                      <p className="font-body-md text-on-surface-variant/60 text-sm truncate">{p.address}</p>
                    </div>
                    {p.is_open === true && <span className="chip-open text-[9px]">OPEN</span>}
                  </div>
                </Link>
              ))
          }
        </div>
      )}

      {/* Shelves + filter chips */}
      {(!showSearch || !search) && (
        <>
          {/* Featured hero shelf (first shelf) */}
          {shelves.length > 0 && shelves[0].featured && (
            <ShelfRow key={shelves[0].id} shelf={shelves[0]} saved={saved} onSave={handleSave} index={0} />
          )}

          {/* Filter chips bar — after hero, before remaining shelves */}
          <div className="flex gap-xs overflow-x-auto no-scrollbar px-container-padding py-sm mb-xs">
            {FILTER_CHIPS.map(chip => (
              <button
                key={chip.id}
                onClick={() => setActiveFilter(chip.id)}
                className={`flex-shrink-0 px-sm py-xs rounded-full text-xs font-medium border transition-all ${
                  activeFilter === chip.id
                    ? 'bg-primary-container border-primary/40 text-on-primary-container'
                    : 'bg-surface-container border-transparent text-on-surface-variant/70'
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {/* Remaining shelves */}
          {shelves.length === 0
            ? (
              <div className="text-center py-xl text-on-surface-variant px-container-padding">
                <span className="material-symbols-outlined text-[48px] mb-sm block">location_searching</span>
                <p className="font-body-md">No clubs found nearby</p>
              </div>
            )
            : shelves.slice(shelves[0]?.featured ? 1 : 0).map((shelf, i) => (
                <ShelfRow key={shelf.id} shelf={shelf} saved={saved} onSave={handleSave} index={i + 1} />
              ))
          }
        </>
      )}
    </div>
  )
}
