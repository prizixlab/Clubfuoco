'use client'
import {
  getNearbyClubs,
  getPlaceFavorites, savePlaceFavorite, removePlaceFavorite,
  getUserPreferences, getSurveyPreferences, getTasteProfile,
  getEvents, getRumbas,
} from '@/lib/supabase/queries'

import { apiFetch } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import ExploreLoader from '@/components/ExploreLoader'
import { computeOpenNow } from '@/lib/hours'
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
  weekday_hours: string[]
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

// Admin-managed custom shelf (from /api/explore/shelves).
interface CustomShelfRecord {
  id:          string
  title:       string
  subtitle:    string
  mode:        'auto' | 'manual'
  auto_filter: string
  auto_genre:  string | null
  auto_sort:   string
  place_ids:   string[]
  position:    number
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

// A venue counts as open if staff marked it open via live status, OR its
// weekly opening hours say it's open right now.
function placeIsOpen(p: Place): boolean {
  return p.is_open === true || computeOpenNow(p.weekday_hours) === true
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
  const shuffle    = <T,>(arr: T[]): T[] => [...arr].sort(() => Math.random() - 0.5)

  // ── 1. FOR YOU — hero (always first) ─────────────────────────────────────
  const forYou = [...places]
    .sort((a, b) => {
      const open = (b.is_open ? 1 : 0) - (a.is_open ? 1 : 0)
      return open !== 0 ? open : prefScore(b) - prefScore(a)
    })
    .slice(0, 12)
  shelves.push({ id: 'for_you', title: 'Curated Tonight', subtitle: 'Matched to your taste', places: forYou, featured: true })

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
  const openNow = places.filter(placeIsOpen)
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
  candidate('late_night', 'Still Going Strong',       'Open & rated highly right now',    [...places].filter(p => placeIsOpen(p) && (p.rating ?? 0) >= 3.8).sort(byRating))

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

// ── Design tokens ─────────────────────────────────────────────────────────────
// From the "B _ Cinema" design system
const C = {
  bg:        '#F8F5EE',   // page background
  bg2:       '#EFE9DD',   // slightly darker bg
  surface:   '#FFFFFF',   // card surface
  surface2:  '#F4EFE3',   // secondary surface
  ink:       '#221E1A',   // primary text
  ink2:      '#6E6356',   // secondary text
  ink3:      '#9F9486',   // tertiary / muted
  accent:    '#8C2A2A',   // deep red accent
  accent2:   '#4A1313',   // darker red
  accent3:   '#B2843A',   // gold accent
  line:      'rgba(34,30,26,0.08)',
  lineStrong:'rgba(34,30,26,0.16)',
  pillBg:    'rgba(34,30,26,0.05)',
  pillBgActive: '#221E1A',
  pillInkActive: '#F8F5EE',
}

// ── Cinema Card Components ───────────────────────────────────────────────────

function HeroCard({ place, isSaved, onSave }: { place: Place; isSaved: boolean; onSave: (id: string) => void }) {
  const router = useRouter()
  const genre = place.music_genres?.length > 0 ? place.music_genres[0] : 'Featured'
  const meta: string[] = []
  if (place.neighborhood) meta.push(place.neighborhood)
  if (place.price_level !== null && place.price_level !== undefined) meta.push(PRICE_LABEL[place.price_level])

  return (
    <button onClick={() => router.push(`/clubs/place/placeholder?id=${place.place_id}`)} style={{ display: 'block', width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', touchAction: 'manipulation' }}>
      <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', background: C.surface, boxShadow: '0 1px 2px rgba(34,30,26,0.04), 0 8px 24px rgba(34,30,26,0.06)' }}>
        {/* Image */}
        <div style={{ position: 'relative', height: 220, width: '100%', background: C.bg2 }}>
          {place.cover_photo
            ? <img src={place.cover_photo} alt={place.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 48, color: C.ink3, opacity: 0.3, fontVariationSettings: "'FILL' 1" }}>nightlife</span>
              </div>
          }
          {/* Dark gradient overlay */}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, transparent 50%, rgba(0,0,0,0.3) 100%)' }} />

          {/* Genre tag */}
          <div style={{ position: 'absolute', top: 12, left: 12 }}>
            <span style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.85)', background: 'rgba(0,0,0,0.5)', borderRadius: 99, padding: '3px 8px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
              {genre}
            </span>
          </div>

          {/* Save button */}
          <span
            role="button"
            tabIndex={0}
            onClick={e => { e.preventDefault(); e.stopPropagation(); onSave(place.place_id) }}
            style={{ position: 'absolute', top: 10, right: 10, width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 17, color: isSaved ? '#E05252' : 'white', fontVariationSettings: isSaved ? "'FILL' 1" : "'FILL' 0" }}>favorite</span>
          </span>

          {/* Rating badge */}
          {place.rating && (
            <div style={{ position: 'absolute', bottom: 12, right: 12, display: 'flex', alignItems: 'center', gap: 3, background: 'rgba(0,0,0,0.55)', borderRadius: 99, padding: '3px 8px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 12, color: '#F0C040', fontVariationSettings: "'FILL' 1" }}>star</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'white', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{place.rating.toFixed(1)}</span>
            </div>
          )}
        </div>

        {/* Text below image */}
        <div style={{ padding: '16px 20px 18px' }}>
          <p style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.ink3, marginBottom: 6, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
            FEATURED TONIGHT
          </p>
          <h2 style={{ fontSize: 32, fontWeight: 400, fontStyle: 'normal', color: C.ink, margin: '0 0 6px', lineHeight: 1.05, letterSpacing: '-0.01em', fontFamily: "'Instrument Serif', 'Bodoni Moda', Georgia, serif" }}>
            Tonight: <em style={{ fontStyle: 'italic', color: C.accent }}>{place.name}</em>
          </h2>
          {place.address && (
            <p style={{ fontSize: 13, fontStyle: 'italic', color: C.ink2, margin: '0 0 12px', paddingLeft: 10, borderLeft: `2px solid ${C.line}`, lineHeight: 1.5, fontFamily: "'Instrument Serif', 'Bodoni Moda', Georgia, serif" }}>
              {place.address.slice(0, 90)}{place.address.length > 90 ? '…' : ''}
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p style={{ fontSize: 11, color: C.ink3, letterSpacing: '0.04em', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
              {meta.join(' · ')}
            </p>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: C.ink, color: C.pillInkActive, borderRadius: 99, padding: '9px 16px', fontSize: 13, fontWeight: 600, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
              View Club
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3 7h8m-3-3l3 3-3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
          </div>
        </div>
      </div>
    </button>
  )
}

function LandCard({ place, isSaved, onSave }: { place: Place; isSaved: boolean; onSave: (id: string) => void }) {
  const router = useRouter()
  const genre = place.music_genres?.length > 0 ? place.music_genres[0] : null
  return (
    <button onClick={() => router.push(`/clubs/place/placeholder?id=${place.place_id}`)} style={{ display: 'block', flexShrink: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', touchAction: 'manipulation' }}>
      <div style={{ width: 220, borderRadius: 12, overflow: 'hidden', background: C.surface, boxShadow: '0 1px 2px rgba(34,30,26,0.04), 0 4px 16px rgba(34,30,26,0.06)' }}>
        {/* Image */}
        <div style={{ position: 'relative', height: 130, background: C.bg2 }}>
          {place.cover_photo
            ? <img src={place.cover_photo} alt={place.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 32, color: C.ink3, opacity: 0.25 }}>nightlife</span>
              </div>
          }
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 55%)' }} />

          {genre && (
            <div style={{ position: 'absolute', top: 8, left: 8 }}>
              <span style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.8)', background: 'rgba(0,0,0,0.45)', borderRadius: 99, padding: '2px 7px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{genre}</span>
            </div>
          )}

          <span
            role="button"
            tabIndex={0}
            onClick={e => { e.preventDefault(); e.stopPropagation(); onSave(place.place_id) }}
            style={{ position: 'absolute', top: 6, right: 6, width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 15, color: isSaved ? '#E05252' : 'white', fontVariationSettings: isSaved ? "'FILL' 1" : "'FILL' 0" }}>favorite</span>
          </span>

          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '0 10px 8px' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'white', margin: 0, lineHeight: 1.3, fontFamily: 'Geist, -apple-system, system-ui, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{place.name}</p>
            <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', margin: '1px 0 0', fontFamily: 'Geist, -apple-system, system-ui, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {[place.neighborhood, place.price_level !== null && place.price_level !== undefined ? PRICE_LABEL[place.price_level] : null].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
      </div>
    </button>
  )
}

function PosterCard({ place, isSaved, onSave }: { place: Place; isSaved: boolean; onSave: (id: string) => void }) {
  const router = useRouter()
  return (
    <button onClick={() => router.push(`/clubs/place/placeholder?id=${place.place_id}`)} style={{ display: 'block', flexShrink: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', touchAction: 'manipulation' }}>
      <div style={{ width: 150, borderRadius: 12, overflow: 'hidden', background: C.surface, boxShadow: '0 1px 2px rgba(34,30,26,0.04), 0 4px 14px rgba(34,30,26,0.06)' }}>
        {/* Image */}
        <div style={{ position: 'relative', height: 168, background: C.bg2 }}>
          {place.cover_photo
            ? <img src={place.cover_photo} alt={place.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 28, color: C.ink3, opacity: 0.25 }}>nightlife</span>
              </div>
          }
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 50%)' }} />

          {/* Open chip */}
          {place.is_open === true && (
            <div style={{ position: 'absolute', top: 7, left: 7 }}>
              <span style={{ fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'white', background: '#2D7A46', borderRadius: 99, padding: '2px 6px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontWeight: 600 }}>Open</span>
            </div>
          )}
          {place.is_open !== true && place.distance !== undefined && (
            <div style={{ position: 'absolute', top: 7, left: 7 }}>
              <span style={{ fontSize: 8, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.75)', background: 'rgba(0,0,0,0.4)', borderRadius: 99, padding: '2px 6px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{fmtDistance(place.distance)}</span>
            </div>
          )}

          <span
            role="button"
            tabIndex={0}
            onClick={e => { e.preventDefault(); e.stopPropagation(); onSave(place.place_id) }}
            style={{ position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: '50%', background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14, color: isSaved ? '#E05252' : 'white', fontVariationSettings: isSaved ? "'FILL' 1" : "'FILL' 0" }}>favorite</span>
          </span>
        </div>

        {/* Info */}
        <div style={{ padding: '8px 10px 10px' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: C.ink, margin: 0, lineHeight: 1.3, fontFamily: 'Geist, -apple-system, system-ui, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{place.name}</p>
          <p style={{ fontSize: 10, color: C.ink3, margin: '2px 0 0', fontFamily: 'Geist, -apple-system, system-ui, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {place.neighborhood ?? place.address}
          </p>
        </div>
      </div>
    </button>
  )
}

function EventShelfCard({ place }: { place: Place }) {
  const router = useRouter()
  const ev = place.upcoming_event
  return (
    <button onClick={() => router.push(`/clubs/place/placeholder?id=${place.place_id}`)} style={{ display: 'block', flexShrink: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', touchAction: 'manipulation' }}>
      <div style={{ width: 220, borderRadius: 12, overflow: 'hidden', background: C.surface, boxShadow: '0 1px 2px rgba(34,30,26,0.04), 0 4px 16px rgba(34,30,26,0.06)' }}>
        <div style={{ position: 'relative', height: 130, background: C.bg2 }}>
          {place.cover_photo
            ? <img src={place.cover_photo} alt={place.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 32, color: C.ink3, opacity: 0.25 }}>nightlife</span>
              </div>
          }
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.2) 60%, transparent 100%)' }} />

          {/* Ticket badge */}
          <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: 3, background: `${C.accent}ee`, borderRadius: 99, padding: '2px 8px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 9, color: 'white', fontVariationSettings: "'FILL' 1" }}>confirmation_number</span>
            <span style={{ fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'white', fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontWeight: 600 }}>Tickets</span>
          </div>

          {ev?.display_price !== undefined && (
            <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', borderRadius: 99, padding: '2px 7px' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'white', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
                {ev.display_price === 0 ? 'FREE' : `From €${Math.ceil(ev.display_price / 100)}`}
              </span>
            </div>
          )}

          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '0 10px 8px' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'white', margin: 0, lineHeight: 1.3, fontFamily: 'Geist, -apple-system, system-ui, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{place.name}</p>
            {ev && <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', margin: '1px 0 0', fontFamily: 'Geist, -apple-system, system-ui, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.title}</p>}
            {ev && <p style={{ fontSize: 9, color: `${C.accent3}dd`, margin: '2px 0 0', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{fmtEventDate(ev.date)}</p>}
          </div>
        </div>
      </div>
    </button>
  )
}

function RumbaShelfCard({ rumba }: { rumba: Rumba }) {
  const router   = useRouter()
  const spotsLeft = Math.max(0, rumba.capacity - (rumba.signup_count ?? 0))
  const isFull    = spotsLeft === 0
  const d         = new Date(rumba.event_date)
  const dateLabel = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const timeLabel = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return (
    <button onClick={() => router.push(`/rumbas/${rumba.id}`)} style={{ display: 'block', flexShrink: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', touchAction: 'manipulation' }}>
      <div style={{ width: 220, borderRadius: 12, overflow: 'hidden', background: C.surface, boxShadow: '0 1px 2px rgba(34,30,26,0.04), 0 4px 16px rgba(34,30,26,0.06)' }}>
        <div style={{ position: 'relative', height: 130, background: C.bg2 }}>
          {rumba.cover_image
            ? <img src={rumba.cover_image} alt={rumba.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 40, color: C.accent, opacity: 0.3, fontVariationSettings: "'FILL' 1" }}>local_fire_department</span>
              </div>
          }
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.2) 60%, transparent 100%)' }} />

          <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: 3, background: `${C.accent}ee`, borderRadius: 99, padding: '2px 8px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 9, color: 'white', fontVariationSettings: "'FILL' 1" }}>local_fire_department</span>
            <span style={{ fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'white', fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontWeight: 600 }}>Rumba</span>
          </div>

          <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.55)', borderRadius: 99, padding: '2px 7px' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: isFull ? '#E05252' : 'white', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
              {isFull ? 'Full' : `${spotsLeft} left`}
            </span>
          </div>

          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '0 10px 8px' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'white', margin: 0, lineHeight: 1.3, fontFamily: 'Geist, -apple-system, system-ui, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rumba.title}</p>
            <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', margin: '1px 0 0', fontFamily: 'Geist, -apple-system, system-ui, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rumba.venue_name}</p>
            <p style={{ fontSize: 9, color: `${C.accent3}dd`, margin: '2px 0 0', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
              {dateLabel} · {timeLabel}
            </p>
          </div>
        </div>
      </div>
    </button>
  )
}

function ShelfRow({ shelf, saved, onSave, index }: { shelf: Shelf; saved: Set<string>; onSave: (id: string) => void; index: number }) {
  const isEventsShelf = shelf.id === 'events_tonight'
  // Alternate landscape / poster cards for visual rhythm
  const useLandscape = index % 2 !== 0

  // Rumba shelf
  if (shelf.id === 'rumbas' && shelf._rumbas && shelf._rumbas.length > 0) {
    return (
      <section style={{ marginBottom: 32 }}>
        <div style={{ padding: '0 20px', marginBottom: 12 }}>
          <p style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.ink3, margin: '0 0 4px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{shelf.subtitle}</p>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 18, fontWeight: 500, color: C.ink, margin: 0, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{shelf.title}</h2>
            <span style={{ fontSize: 12, color: C.accent, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{shelf._rumbas.length} events →</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingLeft: 20, paddingRight: 12, paddingBottom: 4, scrollbarWidth: 'none' }}>
          {shelf._rumbas.map(r => <RumbaShelfCard key={r.id} rumba={r} />)}
        </div>
      </section>
    )
  }

  if (shelf.featured) {
    return (
      <section style={{ marginBottom: 32 }}>
        <div style={{ padding: '0 20px', marginBottom: 14 }}>
          <p style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.ink3, margin: '0 0 3px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{shelf.subtitle}</p>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 18, fontWeight: 500, color: C.ink, margin: 0, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{shelf.title}</h2>
            <span style={{ fontSize: 12, color: C.accent, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{shelf.places.length} venues →</span>
          </div>
        </div>
        {shelf.places[0] && (
          <div style={{ padding: '0 20px', marginBottom: 14 }}>
            <HeroCard place={shelf.places[0]} isSaved={saved.has(shelf.places[0].place_id)} onSave={onSave} />
          </div>
        )}
        {shelf.places.length > 1 && (
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingLeft: 20, paddingRight: 12, paddingBottom: 4, scrollbarWidth: 'none' }}>
            {shelf.places.slice(1).map(p => (
              <PosterCard key={p.place_id} place={p} isSaved={saved.has(p.place_id)} onSave={onSave} />
            ))}
          </div>
        )}
      </section>
    )
  }

  return (
    <section style={{ marginBottom: 32 }}>
      <div style={{ padding: '0 20px', marginBottom: 12 }}>
        <p style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.ink3, margin: '0 0 3px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{shelf.subtitle}</p>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 16, fontWeight: 500, color: C.ink, margin: 0, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{shelf.title}</h2>
          {isEventsShelf
            ? <span style={{ fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.accent, background: `${C.accent}18`, borderRadius: 99, padding: '2px 8px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>Live</span>
            : <span style={{ fontSize: 12, color: C.accent, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{shelf.places.length} venues →</span>
          }
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingLeft: 20, paddingRight: 12, paddingBottom: 4, scrollbarWidth: 'none' }}>
        {shelf.places.map(p =>
          isEventsShelf
            ? <EventShelfCard key={p.place_id} place={p} />
            : useLandscape
              ? <LandCard key={p.place_id} place={p} isSaved={saved.has(p.place_id)} onSave={onSave} />
              : <PosterCard key={p.place_id} place={p} isSaved={saved.has(p.place_id)} onSave={onSave} />
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
    case 'open':      return places.filter(placeIsOpen)
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

// ── Loader seen flag — persists for the lifetime of the JS session ────────────
// Using a module-level variable means it survives tab switches (no remount)
// AND component remounts (Next.js navigation), but resets on full app restart.
let _loaderShownThisSession = false

// ── Main page ─────────────────────────────────────────────────────────────────

// ── Merge admin-managed custom shelves into the default algorithmic feed ──────
// Default rows are never removed; custom shelves are spliced in at their
// `position` (1 = near the top, after the hero). Auto shelves resolve from a
// rule; manual shelves use an explicit, ordered venue list.
function mergeCustomShelves(base: Shelf[], records: CustomShelfRecord[], places: Place[]): Shelf[] {
  if (!records.length) return base
  const result   = [...base]
  const byRating  = (a: Place, b: Place) => (b.rating ?? 0) - (a.rating ?? 0)
  const byPopular = (a: Place, b: Place) => (b.ratings_total ?? 0) - (a.ratings_total ?? 0)
  const index    = new Map(places.map(p => [p.place_id, p]))

  // Insert in position order so earlier shelves don't shift later targets.
  for (const rec of [...records].sort((a, b) => a.position - b.position)) {
    let picks: Place[] = []

    if (rec.mode === 'manual') {
      picks = rec.place_ids.map(id => index.get(id)).filter(Boolean) as Place[]
    } else {
      let pool = [...places]
      if (rec.auto_filter === 'open')     pool = pool.filter(placeIsOpen)
      if (rec.auto_filter === 'partner')  pool = pool.filter(p => p.is_partner)
      if (rec.auto_filter === 'featured') pool = pool.filter(p => p.is_featured)
      if (rec.auto_filter === 'genre') {
        const g = (rec.auto_genre ?? '').toLowerCase().trim()
        pool = pool.filter(p =>
          (p.music_genres ?? []).some(m => m.toLowerCase().includes(g)) ||
          (p.tags ?? []).some(t => t.toLowerCase().includes(g)) ||
          p.name.toLowerCase().includes(g)
        )
      }
      if (rec.auto_sort === 'rating')       pool.sort(byRating)
      else if (rec.auto_sort === 'popular') pool.sort(byPopular)
      else pool = pool.sort(() => Math.random() - 0.5)
      picks = pool.slice(0, 12)
    }

    // Skip a shelf that has nothing (or too little) to show.
    if (picks.length < (rec.mode === 'manual' ? 1 : 2)) continue

    const shelf: Shelf = { id: `custom_${rec.id}`, title: rec.title, subtitle: rec.subtitle, places: picks }
    const at = Math.min(Math.max(rec.position, 1), result.length)
    result.splice(at, 0, shelf)
  }
  return result
}

export default function ExplorePage() {
  const router = useRouter()
  const { user } = useAuth()
  const [places,       setPlaces]       = useState<Place[]>([])
  const [loading,      setLoading]      = useState(true)
  // Skip the cinematic loader if it already played this session
  const [loaderGone,   setLoaderGone]   = useState(_loaderShownThisSession)
  const [prefs,        setPrefs]        = useState<any>(null)
  const [onboardingDone, setOnboardingDone] = useState(true)
  const [surveyPrefs,  setSurveyPrefs]  = useState<any>(null)
  const [tasteProfile, setTasteProfile] = useState<any>(null)
  const [userPos,      setUserPos]      = useState<{ lat: number; lng: number } | null>(null)
  const [search,       setSearch]       = useState('')
  const [showSearch,   setShowSearch]   = useState(false)
  const [error,        setError]        = useState('')
  const [raEvents,     setRaEvents]     = useState<ExternalEvent[]>([])
  const [rumbas,       setRumbas]       = useState<Rumba[]>([])
  const [activeFilter, setActiveFilter] = useState('all')
  const [customShelves, setCustomShelves] = useState<CustomShelfRecord[]>([])
  const [saved,        setSaved]        = useState<Set<string>>(new Set())
  const [showSaved,    setShowSaved]    = useState(false)

  const BARCELONA = { lat: 41.3851, lng: 2.1734 }

  // Push a history entry when saved view opens so back button closes it
  useEffect(() => {
    if (showSaved) {
      window.history.pushState({ savedView: true }, '')
    }
  }, [showSaved])

  useEffect(() => {
    function onPop(e: PopStateEvent) {
      if (showSaved) {
        setShowSaved(false)
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [showSaved])

  // Load saved clubs from Supabase on mount
  useEffect(() => {
    getPlaceFavorites()
      .then(favs => setSaved(new Set(favs.map((f: any) => f.place_id))))
      .catch(() => {})
  }, [])

  async function handleSave(placeId: string) {
    // Guideline 5.1.1(v): browsing is open, but saving is an account action.
    if (!user) { router.push('/login?next=/explore'); return }

    const isCurrentlySaved = saved.has(placeId)

    // Optimistic update
    setSaved(prev => {
      const next = new Set(prev)
      if (isCurrentlySaved) next.delete(placeId)
      else next.add(placeId)
      return next
    })

    // Persist to Supabase
    try {
      if (isCurrentlySaved) {
        await removePlaceFavorite(placeId)
      } else {
        const place = places.find(p => p.place_id === placeId)
        await savePlaceFavorite({
          place_id:    placeId,
          name:        place?.name        ?? '',
          address:     place?.address     ?? '',
          cover_photo: place?.cover_photo ?? null,
          rating:      place?.rating      ?? null,
        })
      }
    } catch {
      // Revert optimistic update on failure
      setSaved(prev => {
        const next = new Set(prev)
        if (isCurrentlySaved) next.add(placeId)
        else next.delete(placeId)
        return next
      })
    }
  }

  useEffect(() => {
    getUserPreferences()
      .then(d => { setPrefs(d?.preferences ?? null); setOnboardingDone(d?.onboarding_done ?? false) })
      .catch(() => {})
    // Survey-derived preference profile for personalised recommendations
    getSurveyPreferences()
      .then(d => setSurveyPrefs(d ?? null))
      .catch(() => {})
    // Computed taste profile from bookings + surveys + tags
    getTasteProfile()
      .then(d => setTasteProfile(d ?? null))
      .catch(() => {})
    // Fetch all upcoming Barcelona RA events for the events shelf
    const fetchEvents = () =>
      getEvents()
        .then(d => setRaEvents(d))
        .catch(() => {})
    fetchEvents()
    // Auto-refresh events every 5 minutes so tonight's listings stay current
    const eventsTimer = setInterval(fetchEvents, 5 * 60 * 1000)

    // Fetch active rumbas for the rumba shelf
    getRumbas()
      .then(d => setRumbas(d))
      .catch(() => {})

    // Admin-managed custom shelves
    apiFetch('/api/explore/shelves')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (Array.isArray(d?.data)) setCustomShelves(d.data) })
      .catch(() => {})

    return () => clearInterval(eventsTimer)
  }, [])

  useEffect(() => {
    if (!navigator.geolocation) { loadPlaces(BARCELONA); return }

    // Manual safety timeout — the browser's built-in `timeout` option doesn't
    // always fire in Capacitor's WKWebView when location permission is denied
    // or not yet configured. Force a fallback to Barcelona after 3s.
    let settled = false
    const safetyTimer = setTimeout(() => {
      if (settled) return
      settled = true
      loadPlaces(BARCELONA)
    }, 3000)

    navigator.geolocation.getCurrentPosition(
      pos => {
        if (settled) return
        settled = true
        clearTimeout(safetyTimer)
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        // Only use the user's real position if they're within ~50 km of Barcelona.
        // Anyone further away would see an empty feed — show Barcelona content instead.
        const nearBarcelona = haversineKm(coords.lat, coords.lng, BARCELONA.lat, BARCELONA.lng) < 50
        if (nearBarcelona) {
          setUserPos(coords)
          loadPlaces(coords)
        } else {
          loadPlaces(BARCELONA)
        }
      },
      () => {
        if (settled) return
        settled = true
        clearTimeout(safetyTimer)
        loadPlaces(BARCELONA)
      },
      { timeout: 3000, enableHighAccuracy: false }
    )
  }, [])

  async function loadPlaces(coords: { lat: number; lng: number }) {
    setLoading(true)
    try {
      const clubs = await getNearbyClubs(coords.lat, coords.lng, 8000)
      const withDist = clubs.map((p: Place) => ({
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
  const shelves = mergeCustomShelves(
    buildShelves(filteredPlaces, prefs, raEvents, rumbas, surveyPrefs, tasteProfile),
    customShelves,
    filteredPlaces,
  )

  const searchResults = search
    ? places.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.address.toLowerCase().includes(search.toLowerCase())
      )
    : []

  // loading state handled via overlay below (see ExploreLoader)

  return (
    <div style={{ background: C.bg, minHeight: '100vh', paddingBottom: 0 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,wght@0,400;0,700;1,400;1,700&display=swap'); .no-scrollbar::-webkit-scrollbar { display: none; }`}</style>

      {/* ── Cinematic loader overlay — self-removes after exit animation ── */}
      {!loaderGone && (
        <ExploreLoader done={!loading} onGone={() => { _loaderShownThisSession = true; setLoaderGone(true) }} />
      )}

      {/* ── Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: C.bg,
        padding: '16px 20px 12px',
        marginBottom: 8,
        borderBottom: '1px solid rgba(34,30,26,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Wordmark + location */}
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
              <span style={{ fontFamily: "'Instrument Serif', 'Bodoni Moda', Georgia, serif", fontSize: 28, fontStyle: 'italic', fontWeight: 400, color: C.ink, letterSpacing: '-0.01em', lineHeight: 1 }}>fuoco.</span>
            </div>
            <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 10, color: C.ink3, letterSpacing: '0.08em', margin: 0 }}>
              Barcelona · {timeGreeting()}
            </p>
          </div>

          {/* Icons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => { setShowSearch(s => !s); setShowSaved(false) }}
              style={{ width: 36, height: 36, borderRadius: '50%', background: showSearch ? C.ink : C.pillBg, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: showSearch ? C.pillInkActive : C.ink2 }}>{showSearch ? 'close' : 'search'}</span>
            </button>
            <button
              onClick={() => router.push('/fiamme')}
              style={{ height: 36, padding: '0 13px', borderRadius: 99, background: C.pillBg, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', whiteSpace: 'nowrap' }}
              aria-label="Fiamme points"
            >
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', color: C.ink2, fontFamily: 'Geist, -apple-system, system-ui, sans-serif', textTransform: 'uppercase' }}>Points</span>
            </button>
            <button
              onClick={() => { setShowSaved(s => !s); setShowSearch(false); setSearch('') }}
              style={{ width: 36, height: 36, borderRadius: '50%', background: showSaved ? C.ink : C.pillBg, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: showSaved ? C.pillInkActive : C.ink2, fontVariationSettings: showSaved ? "'FILL' 1" : "'FILL' 0" }}>bookmark</span>
            </button>
          </div>
        </div>

        {/* Search bar */}
        {showSearch && (
          <div style={{ position: 'relative', marginTop: 12 }}>
            <span className="material-symbols-outlined" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 17, color: C.ink3 }}>search</span>
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search clubs, neighbourhoods…"
              style={{ width: '100%', background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, paddingLeft: 38, paddingRight: 14, paddingTop: 11, paddingBottom: 11, fontSize: 16, color: C.ink, fontFamily: 'Geist, -apple-system, system-ui, sans-serif', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
        )}
      </header>

      {/* ── "Get to know you" prompt — persists until the survey is completed ── */}
      {!loading && !onboardingDone && (
        <button
          onClick={() => router.push('/onboarding')}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            width: 'calc(100% - 40px)', margin: '0 20px 16px', padding: '14px 16px',
            background: C.ink, border: 'none', borderRadius: 14, cursor: 'pointer', textAlign: 'left',
          }}
        >
          <div>
            <p style={{ margin: '0 0 2px', fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 17, fontStyle: 'italic', color: C.pillInkActive }}>
              Let us get to know you better
            </p>
            <p style={{ margin: 0, fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 11.5, color: 'rgba(255,255,255,0.6)' }}>
              A few quick taps — we’ll tune your nights to your taste.
            </p>
          </div>
          <span className="material-symbols-outlined" style={{ fontSize: 20, color: C.pillInkActive, flexShrink: 0 }}>arrow_forward</span>
        </button>
      )}

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {error && (
        <div style={{ margin: '0 20px 16px', background: C.surface, border: `1px solid rgba(140,42,42,0.2)`, borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: C.accent }}>error</span>
          <p style={{ fontSize: 13, color: C.ink2, margin: 0, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{error}</p>
        </div>
      )}

      {/* ── Search results ─────────────────────────────────────────────────── */}
      {!showSaved && showSearch && search && (
        <div style={{ padding: '0 20px', marginBottom: 24 }}>
          {searchResults.length === 0
            ? <p style={{ textAlign: 'center', padding: '32px 0', color: C.ink3, fontSize: 13, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>No clubs found for "{search}"</p>
            : searchResults.map(p => (
                <button key={p.place_id} onClick={() => router.push(`/clubs/place/placeholder?id=${p.place_id}`)} style={{ display: 'block', width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', touchAction: 'manipulation', textAlign: 'left' }}>
                  <div style={{ background: C.surface, borderRadius: 12, overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 12, padding: 12, marginBottom: 10, boxShadow: '0 1px 2px rgba(34,30,26,0.04), 0 4px 12px rgba(34,30,26,0.05)' }}>
                    <div style={{ width: 52, height: 52, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: C.bg2 }}>
                      {p.cover_photo
                        ? <img src={p.cover_photo} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span className="material-symbols-outlined" style={{ fontSize: 20, color: C.ink3, opacity: 0.3 }}>nightlife</span></div>
                      }
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontWeight: 600, color: C.ink, fontSize: 14, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{p.name}</p>
                      <p style={{ fontSize: 12, color: C.ink3, margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{p.address}</p>
                    </div>
                    {p.is_open === true && (
                      <span style={{ fontSize: 8, letterSpacing: '0.12em', fontWeight: 600, textTransform: 'uppercase', color: 'white', background: '#2D7A46', borderRadius: 99, padding: '2px 7px', flexShrink: 0, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>Open</span>
                    )}
                  </div>
                </button>
              ))
          }
        </div>
      )}

      {/* ── Saved clubs view ──────────────────────────────────────────────── */}
      {showSaved && (() => {
        const savedPlaces = places.filter(p => saved.has(p.place_id))
        return (
          <div style={{ paddingBottom: 0 }}>
            {/* Section title */}
            <div style={{ padding: '4px 20px 20px' }}>
              <h2 style={{
                fontFamily: '"Instrument Serif", Georgia, serif',
                fontSize: 44, fontWeight: 400, fontStyle: 'italic',
                lineHeight: 1.05, letterSpacing: '-0.88px',
                color: C.ink, margin: '0 0 4px',
              }}>
                I miei locali
              </h2>
              <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 13, color: C.ink3, margin: 0 }}>
                {savedPlaces.length === 0
                  ? 'No saved clubs yet'
                  : `${savedPlaces.length} ${savedPlaces.length === 1 ? 'club saved' : 'clubs saved'}`}
              </p>
            </div>

            {/* Empty state */}
            {savedPlaces.length === 0 && (
              <div style={{ textAlign: 'center', padding: '48px 20px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 48, color: C.ink3, opacity: 0.3, display: 'block', marginBottom: 12, fontVariationSettings: "'FILL' 0" }}>bookmark</span>
                <p style={{ fontSize: 14, color: C.ink3, fontFamily: 'Geist, -apple-system, system-ui, sans-serif', margin: '0 0 4px' }}>Nothing saved yet</p>
                <p style={{ fontSize: 12, color: C.ink3, fontFamily: 'Geist, -apple-system, system-ui, sans-serif', margin: 0, opacity: 0.7 }}>Tap the bookmark on any club to save it here</p>
              </div>
            )}

            {/* Saved clubs — full-width magazine cards */}
            {savedPlaces.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '0 20px 24px' }}>
                {savedPlaces.map(p => (
                  <div key={p.place_id} style={{
                    borderRadius: 18, overflow: 'hidden', background: C.surface,
                    boxShadow: '0 1px 2px rgba(34,30,26,0.04), 0 10px 28px rgba(34,30,26,0.08)',
                  }}>
                    <div style={{ position: 'relative', height: 200, background: C.bg2 }}>
                      {p.cover_photo
                        ? <img src={p.cover_photo} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 48, color: C.ink3, opacity: 0.3, fontVariationSettings: "'FILL' 1" }}>nightlife</span>
                          </div>}
                      <span
                        role="button" tabIndex={0}
                        onClick={e => { e.preventDefault(); e.stopPropagation(); handleSave(p.place_id) }}
                        style={{ position: 'absolute', top: 12, right: 12, width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 17, color: '#E05252', fontVariationSettings: "'FILL' 1" }}>favorite</span>
                      </span>
                    </div>
                    <div style={{ padding: '18px 20px 20px' }}>
                      <h3 style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontSize: 30, fontWeight: 400, lineHeight: 1.1, letterSpacing: '-0.5px', color: C.ink, margin: '0 0 6px' }}>
                        {p.name}
                      </h3>
                      <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 13, color: C.ink3, margin: '0 0 16px', lineHeight: 1.4 }}>
                        {p.address}
                      </p>
                      <button
                        onClick={() => router.push(`/clubs/place/placeholder?id=${p.place_id}`)}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', height: 46, borderRadius: 12, border: 'none', cursor: 'pointer', background: C.ink, color: C.pillInkActive, fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 13, fontWeight: 600 }}
                      >
                        View Club
                        <span className="material-symbols-outlined" style={{ fontSize: 17 }}>arrow_forward</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Shelves + filter chips ─────────────────────────────────────────── */}
      {/* ── Skeleton — loader already played but data still loading ────────── */}
      {loading && loaderGone && !showSaved && (!showSearch || !search) && (
        <div style={{ padding: '0 20px' }}>
          {/* Hero card skeleton */}
          <div style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 28 }}>
            <div style={{ height: 220, background: C.surface, borderRadius: 16, animation: 'pulse 1.4s ease-in-out infinite' }} />
            <div style={{ padding: '14px 0 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ height: 14, width: '55%', borderRadius: 6, background: C.surface, animation: 'pulse 1.4s ease-in-out infinite' }} />
              <div style={{ height: 11, width: '35%', borderRadius: 6, background: C.surface, animation: 'pulse 1.4s 0.1s ease-in-out infinite' }} />
            </div>
          </div>
          {/* Shelf rows skeletons */}
          {[0, 1, 2].map(i => (
            <div key={i} style={{ marginBottom: 32 }}>
              <div style={{ height: 13, width: '40%', borderRadius: 6, background: C.surface, marginBottom: 14, animation: `pulse 1.4s ${i * 0.1}s ease-in-out infinite` }} />
              <div style={{ display: 'flex', gap: 12, overflowX: 'hidden' }}>
                {[0, 1, 2].map(j => (
                  <div key={j} style={{ flexShrink: 0, width: 160, borderRadius: 14, overflow: 'hidden', background: C.surface, animation: `pulse 1.4s ${(i + j) * 0.07}s ease-in-out infinite` }}>
                    <div style={{ height: 140, background: C.bg2 }} />
                    <div style={{ padding: '8px 10px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ height: 11, width: '80%', borderRadius: 4, background: C.bg }} />
                      <div style={{ height: 9, width: '55%', borderRadius: 4, background: C.bg }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.45} }`}</style>
        </div>
      )}

      {!showSaved && (!showSearch || !search) && !loading && (
        <>
          {/* Featured hero shelf */}
          {shelves.length > 0 && shelves[0].featured && (
            <ShelfRow key={shelves[0].id} shelf={shelves[0]} saved={saved} onSave={handleSave} index={0} />
          )}

          {/* Filter chips */}
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '0 20px 16px', scrollbarWidth: 'none' }}>
            {FILTER_CHIPS.map(chip => (
              <button
                key={chip.id}
                onClick={() => setActiveFilter(chip.id)}
                style={{
                  flexShrink: 0,
                  padding: '7px 14px',
                  borderRadius: 99,
                  fontSize: 13,
                  fontWeight: activeFilter === chip.id ? 600 : 400,
                  fontFamily: 'Geist, -apple-system, system-ui, sans-serif',
                  border: 'none',
                  cursor: 'pointer',
                  background: activeFilter === chip.id ? C.pillBgActive : C.pillBg,
                  color: activeFilter === chip.id ? C.pillInkActive : C.ink2,
                  letterSpacing: '-0.01em',
                }}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {/* Remaining shelves */}
          {shelves.length === 0
            ? (
              <div style={{ textAlign: 'center', padding: '48px 24px', color: C.ink3 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 44, display: 'block', marginBottom: 12, opacity: 0.4 }}>location_searching</span>
                <p style={{ fontSize: 14, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>No clubs found nearby</p>
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
