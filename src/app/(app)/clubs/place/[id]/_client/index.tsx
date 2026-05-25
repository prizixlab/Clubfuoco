'use client'
import { apiFetch } from '@/lib/api'
import { getClubById, getPlaceFavorites, savePlaceFavorite, removePlaceFavorite } from '@/lib/supabase/queries'
import { useAuth } from '@/contexts/AuthContext'
import { getRumbalistOffers, type RumbalistOffer } from '@/lib/rumbalist-offers'
import { rumbaScore } from '@/lib/rumba-score'
import RumbalistBookSheet, { RumbalistMark } from '@/components/RumbalistBookSheet'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import type { ExternalEvent } from '@/lib/tickets'

// Lazy-load Stripe only on HTTPS (live keys require it). On HTTP (local dev) we fall back to platform links.
let stripePromise: Promise<Stripe | null> | null = null
function getStripe() {
  if (typeof window === 'undefined') return null
  // Stripe.js works over https: (Vercel) and capacitor: (iOS shell). The WKWebView
  // inside Capacitor is a secure context — only the local dev http: case is rejected.
  const proto = window.location.protocol
  if (proto !== 'https:' && proto !== 'capacitor:') return null
  if (!stripePromise) stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)
  return stripePromise
}

// "2026-05-15T20:00:00.000" → "20:00"
function fmtStart(s: string | null | undefined) {
  if (!s) return ''
  const m = s.match(/T(\d{2}:\d{2})/)
  return m ? m[1] : s
}

// Parses "5:00 PM" / "3:00 AM" → minutes from midnight (0..1439). Returns -1 on miss.
function parseClock(s: string): number {
  const m = s.trim().match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM)$/i)
  if (!m) return -1
  let h = parseInt(m[1], 10)
  const min = m[2] ? parseInt(m[2], 10) : 0
  const ap = m[3].toUpperCase()
  if (ap === 'PM' && h !== 12) h += 12
  if (ap === 'AM' && h === 12) h = 0
  return h * 60 + min
}

/**
 * Computes whether the club is open right now from its weekday_hours array.
 * Handles cross-midnight ranges (e.g. 5:00 PM – 3:00 AM closes next day).
 * Returns true/false, or null if it can't be determined.
 */
function computeOpenNow(rows: string[]): boolean | null {
  if (!rows || rows.length < 7) return null
  const now = new Date()
  const nowMin   = now.getHours() * 60 + now.getMinutes()
  const todayIdx = (now.getDay() + 6) % 7   // Mon=0 … Sun=6
  const yIdx     = (todayIdx + 6) % 7

  const parseRow = (row: string | undefined): [number, number] | null => {
    if (!row) return null
    const colon = row.indexOf(':')
    const hrs = colon > -1 ? row.slice(colon + 1).trim() : row
    if (/closed/i.test(hrs)) return null
    // Split on en-dash, em-dash, hyphen, or " to "
    const parts = hrs.split(/\s*[–—\-]\s*|\s+to\s+/i)
    if (parts.length !== 2) return null
    const o = parseClock(parts[0])
    const c = parseClock(parts[1])
    if (o < 0 || c < 0) return null
    return [o, c]
  }

  // Today's range
  const today = parseRow(rows[todayIdx])
  if (today) {
    const [open, close] = today
    if (close >= open) {
      if (nowMin >= open && nowMin < close) return true
    } else {
      // Cross-midnight: open until close on the NEXT day. If nowMin >= open we're inside.
      if (nowMin >= open) return true
    }
  }

  // Yesterday's range that wraps past midnight into today
  const y = parseRow(rows[yIdx])
  if (y) {
    const [yOpen, yClose] = y
    if (yClose < yOpen && nowMin < yClose) return true
  }

  return false
}

/**
 * If the club is currently open, returns minutes remaining until close.
 * Returns null when the club is closed, or hours can't be parsed.
 */
function minutesUntilClose(rows: string[]): number | null {
  if (!rows || rows.length < 7) return null
  const now = new Date()
  const nowMin   = now.getHours() * 60 + now.getMinutes()
  const todayIdx = (now.getDay() + 6) % 7
  const yIdx     = (todayIdx + 6) % 7

  const parseRow = (row: string | undefined): [number, number] | null => {
    if (!row) return null
    const colon = row.indexOf(':')
    const hrs = colon > -1 ? row.slice(colon + 1).trim() : row
    if (/closed/i.test(hrs)) return null
    const parts = hrs.split(/\s*[–—\-]\s*|\s+to\s+/i)
    if (parts.length !== 2) return null
    const o = parseClock(parts[0])
    const c = parseClock(parts[1])
    if (o < 0 || c < 0) return null
    return [o, c]
  }

  const today = parseRow(rows[todayIdx])
  if (today) {
    const [open, close] = today
    if (close >= open) {
      if (nowMin >= open && nowMin < close) return close - nowMin
    } else {
      // Cross-midnight: close is tomorrow → (1440 - nowMin) + close
      if (nowMin >= open) return (1440 - nowMin) + close
    }
  }

  const y = parseRow(rows[yIdx])
  if (y) {
    const [yOpen, yClose] = y
    if (yClose < yOpen && nowMin < yClose) return yClose - nowMin
  }

  return null
}

function formatCloseCountdown(mins: number): string {
  if (mins < 60) return `Closing in ${mins} min`
  const hours = Math.floor(mins / 60)
  const rem   = mins % 60
  if (rem === 0) return `Closing in ${hours} hr`
  return `Closing in ${hours} hr ${rem} min`
}

/**
 * When the club is currently closed, returns minutes until its next opening.
 * Scans today + next 6 days. Returns null if no opening can be parsed.
 */
function minutesUntilOpen(rows: string[]): number | null {
  if (!rows || rows.length < 7) return null
  const now = new Date()
  const nowMin   = now.getHours() * 60 + now.getMinutes()
  const todayIdx = (now.getDay() + 6) % 7

  const parseRow = (row: string | undefined): [number, number] | null => {
    if (!row) return null
    const colon = row.indexOf(':')
    const hrs = colon > -1 ? row.slice(colon + 1).trim() : row
    if (/closed/i.test(hrs)) return null
    const parts = hrs.split(/\s*[–—\-]\s*|\s+to\s+/i)
    if (parts.length !== 2) return null
    const o = parseClock(parts[0])
    const c = parseClock(parts[1])
    if (o < 0 || c < 0) return null
    return [o, c]
  }

  for (let i = 0; i < 7; i++) {
    const r = parseRow(rows[(todayIdx + i) % 7])
    if (!r) continue
    const [open] = r
    if (i === 0) {
      if (open > nowMin) return open - nowMin
    } else {
      return (1440 - nowMin) + (i - 1) * 1440 + open
    }
  }
  return null
}

function formatOpenCountdown(mins: number): string {
  if (mins < 60) return `Opens in ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) {
    const rem = mins % 60
    if (rem === 0) return `Opens in ${hours} hr`
    return `Opens in ${hours} hr ${rem} min`
  }
  const days = Math.round(hours / 24)
  return `Opens in ${days} day${days === 1 ? '' : 's'}`
}

interface PlaceDetail {
  place_id:            string
  name:                string
  address:             string
  neighborhood?:       string | null
  lat:                 number
  lng:                 number
  phone:               string | null
  website:             string | null
  rating:              number | null
  ratings_total:       number
  price_level:         number | null
  is_open:             boolean | null
  weekday_hours:       string[]
  reviews:             { author: string; rating: number; text: string; time: string }[]
  photos:              string[]
  cover_photo:         string | null
  is_partner:          boolean
  google_place_id:     string | null
  maps_url:            string
  // enriched fields
  description?:        string | null
  instagram_handle?:   string | null
  whatsapp_link?:      string | null
  music_genres?:       string[]
  tags?:               string[]
  live_status?:        string | null
  general_entry_price?: number | null
  vip_table_min_spend?: number | null
}

// ── Design tokens (Cinema system) ────────────────────────────────────────────
const C = {
  bg:        '#F8F5EE',
  bg2:       '#EFE9DD',
  surface:   '#FFFFFF',
  surface2:  '#F4EFE3',
  ink:       '#221E1A',
  ink2:      '#6E6356',
  ink3:      '#9F9486',
  accent:    '#8C2A2A',
  accent2:   '#4A1313',
  accent3:   '#B2843A',
  line:      'rgba(34,30,26,0.08)',
  lineStrong:'rgba(34,30,26,0.16)',
}

const PRICE_LABEL = ['Free', '€', '€€', '€€€', '€€€€']

function fmtPrice(cents: number, currency = 'EUR') {
  if (cents === 0) return 'Free'
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(cents / 100)
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

function priceDisplay(place: PlaceDetail): string {
  if (place.general_entry_price === 0) return 'Free entry'
  if (place.general_entry_price && place.general_entry_price > 0) return `€${place.general_entry_price} entry`
  if (place.price_level !== null && place.price_level !== undefined) return PRICE_LABEL[place.price_level]
  return '? entry'
}

// ── Stripe checkout form ──────────────────────────────────────────────────────
function CheckoutForm({
  event,
  clientSecret,
  totalCents,
  markupCents,
  onSuccess,
  onCancel,
}: {
  event:        ExternalEvent
  clientSecret: string
  totalCents:   number
  markupCents:  number
  onSuccess:    () => void
  onCancel:     () => void
}) {
  const stripe   = useStripe()
  const elements = useElements()
  const [paying, setPaying] = useState(false)
  const [error,  setError]  = useState('')

  async function handlePay(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setPaying(true)
    setError('')
    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    })
    if (stripeError) {
      setError(stripeError.message ?? 'Payment failed')
      setPaying(false)
    } else {
      onSuccess()
    }
  }

  return (
    <form onSubmit={handlePay} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Order summary */}
      <div style={{ background: C.bg, borderRadius: 12, padding: 14 }}>
        <p style={{ fontWeight: 600, color: C.ink, fontSize: 14, margin: '0 0 4px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{event.title}</p>
        <p style={{ fontSize: 13, color: C.ink3, margin: '0 0 2px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{event.venue_name}</p>
        <p style={{ fontSize: 13, color: C.ink3, margin: 0, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{fmtDate(event.date)}</p>
        <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 10, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: C.ink2, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
            <span>Ticket</span><span>{fmtPrice(event.base_price, event.currency)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: C.ink2, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
            <span>Service fee (10%)</span><span>{fmtPrice(markupCents, event.currency)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 700, color: C.ink, borderTop: `1px solid ${C.line}`, paddingTop: 8, marginTop: 2, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
            <span>Total</span><span style={{ color: C.accent }}>{fmtPrice(totalCents, event.currency)}</span>
          </div>
        </div>
      </div>

      <PaymentElement />

      {error && <p style={{ fontSize: 13, color: C.accent, textAlign: 'center', margin: 0, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{error}</p>}

      <button type="submit" disabled={paying || !stripe}
        style={{ width: '100%', height: 52, background: C.accent, color: 'white', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 600, fontFamily: 'Geist, -apple-system, system-ui, sans-serif', cursor: paying ? 'not-allowed' : 'pointer', opacity: paying || !stripe ? 0.6 : 1 }}>
        {paying ? 'Processing…' : `Pay ${fmtPrice(totalCents, event.currency)}`}
      </button>
      <button type="button" onClick={onCancel}
        style={{ width: '100%', padding: '12px 0', background: 'none', border: 'none', fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.ink3, cursor: 'pointer', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
        Cancel
      </button>
    </form>
  )
}

// ── Event card ────────────────────────────────────────────────────────────────
function EventCard({ event, placeId, placeLat, placeLng, placeName }: {
  event:     ExternalEvent
  placeId:   string
  placeLat:  number
  placeLng:  number
  placeName: string
}) {
  const [buying,       setBuying]       = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [orderId,      setOrderId]      = useState<string | null>(null)
  const [intentId,     setIntentId]     = useState<string | null>(null)
  const [totalCents,   setTotalCents]   = useState(0)
  const [markupCents,  setMarkupCents]  = useState(0)
  const [success,      setSuccess]      = useState(false)

  async function startCheckout() {
    setBuying(true)

    // Fire-and-forget click telemetry (for partner-program traffic numbers).
    // Never await — must not slow down checkout, must not fail it.
    apiFetch('/api/ticket-clicks', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        event_id:       event.id,
        platform:       event.platform,
        event_title:    event.title,
        venue_name:     event.venue_name,
        venue_place_id: placeId,
        event_date:     event.date,
        display_price:  event.display_price,
        currency:       event.currency,
      }),
    }).catch(() => {})

    // Free events — just record an RSVP, no payment needed
    if (event.base_price === 0) {
      await apiFetch('/api/tickets', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          platform: event.platform, platform_event_id: event.id,
          event_name: event.title, venue_name: event.venue_name,
          venue_place_id: placeId, event_date: event.date,
          quantity: 1, base_price_cents: 0, currency: event.currency,
        }),
      })
      setSuccess(true)
      return
    }

    const res  = await apiFetch('/api/tickets', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        platform:          event.platform,
        platform_event_id: event.id,
        event_name:        event.title,
        venue_name:        event.venue_name,
        venue_place_id:    placeId,
        event_date:        event.date,
        quantity:          1,
        base_price_cents:  event.base_price,
        currency:          event.currency,
        lat:               placeLat,
        lng:               placeLng,
      }),
    })
    const data = await res.json()
    if (data.data?.client_secret) {
      setClientSecret(data.data.client_secret)
      setOrderId(data.data.order_id)
      setIntentId(data.data.client_secret.split('_secret_')[0])
      setTotalCents(data.data.total_cents)
      setMarkupCents(data.data.markup_cents)
    } else {
      setBuying(false)
    }
  }

  async function handleSuccess() {
    // Confirm server-side so the order shows up in bookings immediately
    if (orderId && intentId) {
      await apiFetch('/api/tickets/confirm', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ order_id: orderId, payment_intent_id: intentId }),
      }).catch(() => {})
    }
    setSuccess(true)
  }

  if (success) {
    return (
      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 20, textAlign: 'center' }}>
        <span className="material-symbols-outlined" style={{ fontSize: 36, color: '#2D7A46', display: 'block', marginBottom: 10, fontVariationSettings: "'FILL' 1" }}>check_circle</span>
        <p style={{ fontSize: 17, fontWeight: 600, color: C.ink, margin: '0 0 6px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>Tickets confirmed!</p>
        <p style={{ fontSize: 13, color: C.ink3, margin: 0, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>Check your notifications for details.</p>
      </div>
    )
  }

  if (clientSecret) {
    const sp = getStripe()
    if (!sp) {
      return (
        <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 20, textAlign: 'center' }}>
          <span className="material-symbols-outlined" style={{ fontSize: 36, color: C.ink3, opacity: 0.4, display: 'block', marginBottom: 10 }}>lock</span>
          <p style={{ fontSize: 15, fontWeight: 600, color: C.ink, margin: '0 0 8px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>Secure connection required</p>
          <p style={{ fontSize: 13, color: C.ink3, margin: '0 0 16px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
            Payments are processed over HTTPS. Open the app on your live URL to complete checkout.
          </p>
          <button type="button" onClick={() => { setClientSecret(null); setBuying(false) }}
            style={{ width: '100%', height: 46, background: C.bg, color: C.ink, border: 'none', borderRadius: 10, fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
            Go Back
          </button>
        </div>
      )
    }
    return (
      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16 }}>
        <Elements stripe={sp} options={{ clientSecret, appearance: { theme: 'stripe' } }}>
          <CheckoutForm
            event={event}
            clientSecret={clientSecret}
            totalCents={totalCents}
            markupCents={markupCents}
            onSuccess={handleSuccess}
            onCancel={() => { setClientSecret(null); setBuying(false) }}
          />
        </Elements>
      </div>
    )
  }

  const platformBadge: Record<string, string> = {
    ra:          'Resident Advisor',
    eventbrite:  'Eventbrite',
    dice:        'Dice',
  }

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden' }}>
      {event.image && (
        <div style={{ position: 'relative', height: 120 }}>
          <img src={event.image} alt={event.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 60%)' }} />
          <span style={{ position: 'absolute', top: 8, left: 8, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.65)', background: 'rgba(0,0,0,0.4)', borderRadius: 99, padding: '2px 7px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
            {platformBadge[event.platform] ?? event.platform}
          </span>
          {event.sold_out && (
            <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'white', background: 'rgba(140,42,42,0.9)', borderRadius: 99, padding: '2px 7px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontWeight: 600 }}>Sold out</span>
          )}
        </div>
      )}
      <div style={{ padding: 14 }}>
        <p style={{ fontWeight: 600, color: C.ink, fontSize: 14, margin: '0 0 8px', lineHeight: 1.35, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{event.title}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: C.ink3 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>calendar_today</span>
            <span style={{ fontSize: 13, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{fmtDate(event.date)}</span>
          </div>
          {event.start_time && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: C.ink3 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>schedule</span>
              <span style={{ fontSize: 13, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{fmtStart(event.start_time)}</span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
          <div>
            <p style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.ink3, margin: '0 0 2px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
              {event.base_price === 0 ? 'Free event' : 'from'}
            </p>
            {event.base_price > 0 && (
              <p style={{ fontSize: 18, fontWeight: 700, color: C.accent, margin: 0, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{fmtPrice(event.display_price, event.currency)}</p>
            )}
          </div>
          {!event.sold_out && (
            <button
              onClick={startCheckout}
              disabled={buying}
              style={{ padding: '10px 18px', background: C.ink, color: '#F8F5EE', border: 'none', borderRadius: 99, fontSize: 13, fontWeight: 600, fontFamily: 'Geist, -apple-system, system-ui, sans-serif', cursor: buying ? 'not-allowed' : 'pointer', opacity: buying ? 0.6 : 1 }}>
              {buying ? '…' : event.base_price === 0 ? 'Reserve' : 'Get Tickets'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PlaceDetailPage() {
  const params       = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  // In Capacitor static export we navigate to /clubs/place/placeholder?id=REAL_ID
  // because only the placeholder RSC payload is pre-built. Fall back to the route
  // param when accessed directly (e.g. from web).
  const id = searchParams.get('id') ?? params.id
  const router   = useRouter()
  const { user } = useAuth()
  const [activeOffer,   setActiveOffer]   = useState<RumbalistOffer | null>(null)
  const [place,         setPlace]         = useState<PlaceDetail | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [hoursOpen,     setHoursOpen]     = useState(false)
  const [events,        setEvents]        = useState<ExternalEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [saved,         setSaved]         = useState(false)
  const [savingToggle,  setSavingToggle]  = useState(false)
  const [showCheckout,  setShowCheckout]  = useState(false)

  useEffect(() => {
    getClubById(id as string)
      .then(d => { setPlace(d as any); setLoading(false) })
      .catch(() => setLoading(false))
    // Check if already saved
    getPlaceFavorites()
      .then(favs => { if (favs.some((f: any) => f.place_id === id)) setSaved(true) })
      .catch(() => {})
  }, [id])

  async function toggleSave() {
    if (!place || savingToggle) return
    // Guideline 5.1.1(v): saving a venue is an account action.
    if (!user) { router.push(`/login?next=${encodeURIComponent('/clubs/place/' + id)}`); return }
    setSavingToggle(true)
    if (saved) {
      setSaved(false)
      await removePlaceFavorite(id as string).catch(() => {})
    } else {
      setSaved(true)
      await savePlaceFavorite({
        place_id:    id as string,
        name:        place.name,
        address:     place.address,
        cover_photo: place.cover_photo,
        rating:      place.rating,
      }).catch(() => {})
    }
    setSavingToggle(false)
  }

  useEffect(() => {
    if (!place) return
    setEventsLoading(true)
    apiFetch(`/api/events?venue=${encodeURIComponent(place.name)}&lat=${place.lat}&lng=${place.lng}`)
      .then(r => r.json())
      .then(d => {
        const matched = (d.data ?? []).filter((e: { venue_matched: boolean }) => e.venue_matched)
        setEvents(matched)
      })
      .catch(() => setEvents([]))
      .finally(() => setEventsLoading(false))
  }, [place])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: C.bg }}>
      <span className="material-symbols-outlined" style={{ fontSize: 48, color: C.accent, fontVariationSettings: "'FILL' 1" }}>nightlife</span>
    </div>
  )

  if (!place) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '0 24px', textAlign: 'center', background: C.bg }}>
      <span className="material-symbols-outlined" style={{ fontSize: 48, color: C.ink3, opacity: 0.3, display: 'block', marginBottom: 16 }}>error</span>
      <p style={{ fontSize: 20, fontWeight: 600, color: C.ink, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>Club not found</p>
    </div>
  )

  const heroImg = place.cover_photo ?? place.photos?.[0] ?? null
  const activeEvent = events[0] ?? null

  // Directions URL
  const directionsUrl = (() => {
    if (typeof navigator === 'undefined') return place.maps_url
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
    const dest  = `${place.lat},${place.lng}`
    return isIOS
      ? `maps://maps.apple.com/?daddr=${dest}&q=${encodeURIComponent(place.name)}`
      : `https://www.google.com/maps/dir/?api=1&destination=${dest}&destination_place_id=${place.google_place_id ?? ''}`
  })()

  // Log a venue-presence intent signal (the user is heading here).
  function logVenueSignal(kind: 'maps_click' | 'uber_click') {
    apiFetch('/api/signals', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ club_id: id, kind }),
    }).catch(() => {})
  }

  const genre = (place.music_genres ?? [])[0] ?? null
  const allTags = [...(place.music_genres ?? []), ...(place.tags ?? []).slice(0, 4)]
  const rumbalistOffers = getRumbalistOffers(id as string)
  const { value: ratingValue, boosted: ratingBoosted } = rumbaScore(id as string, place.rating)
  // Rumbalist partner venues only show 4★+ reviews — protects the listing's
  // perceived quality the same way the Rumba Score does for the headline rating.
  const visibleReviews = rumbalistOffers.length > 0
    ? place.reviews.filter(r => r.rating >= 4)
    : place.reviews

  return (
    <div style={{ minHeight: '100vh', background: C.bg }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,wght@0,400;0,700;1,400;1,700&display=swap');`}</style>

      {/* ── HERO — full bleed, ~60vh ───────────────────────────────────────── */}
      <div style={{ position: 'relative', height: '62vh', width: '100%' }}>
        {heroImg
          ? <img src={heroImg} alt={place.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <div style={{ width: '100%', height: '100%', background: C.bg2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 64, color: C.ink3, opacity: 0.2 }}>nightlife</span>
            </div>
        }

        {/* Multi-stop gradient: transparent top → dark bottom, with slight top darken for topbar */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.48) 0%, rgba(0,0,0,0) 35%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.65) 100%)' }} />

        {/* ── Topbar: back + neighbourhood + bookmark ── */}
        <div
          style={{ position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}
          // Safe area inset handled via paddingTop calculation:
          // We just use a generous fixed padding that works for most devices
        >
          <div style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => router.back()}
              style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20, color: 'white' }}>arrow_back</span>
            </button>
            {place.neighborhood && (
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', fontFamily: 'Geist, -apple-system, system-ui, sans-serif', letterSpacing: '0.04em' }}>
                {place.neighborhood}
              </span>
            )}
          </div>
          <div style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
            <button
              onClick={toggleSave}
              style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 21, color: saved ? '#E05252' : 'white', fontVariationSettings: saved ? "'FILL' 1" : "'FILL' 0" }}>favorite</span>
            </button>
          </div>
        </div>

        {/* ── Hero bottom overlay: category + name + meta ── */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '0 20px 28px' }}>
          {genre && (
            <p style={{ fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.65)', margin: '0 0 6px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
              {genre?.replace(/_/g, ' ')} · Barcelona
            </p>
          )}
          {!genre && (
            <p style={{ fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.65)', margin: '0 0 6px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
              Barcelona · Nightlife
            </p>
          )}
          <h1 style={{ fontFamily: "'Instrument Serif', 'Bodoni Moda', Georgia, serif", fontSize: 36, fontStyle: 'italic', fontWeight: 400, color: 'white', margin: '0 0 6px', lineHeight: 1.05, letterSpacing: '-0.01em' }}>
            {place.name}
          </h1>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', margin: 0, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{place.address}</p>
        </div>
      </div>

      {/* ── WHITE SHEET — slides up over hero ─────────────────────────────── */}
      <div style={{ position: 'relative', zIndex: 10, background: C.surface, borderRadius: '24px 24px 0 0', marginTop: -32, paddingBottom: 140 }}>

        {/* Drag handle */}
        <div style={{ width: 36, height: 4, background: C.line, borderRadius: 99, margin: '14px auto 0' }} />

        {/* ── Fact strip: 4 columns ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, padding: '20px 20px 0' }}>
          {/* DOOR / price */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 4px', background: C.bg, borderRadius: 12 }}>
            <p style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.ink3, margin: '0 0 4px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>Door</p>
            <p style={{ fontSize: 15, fontWeight: 700, color: C.ink, margin: 0, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
              {place.general_entry_price === 0 ? 'Free'
                : place.general_entry_price ? `€${place.general_entry_price}`
                : place.price_level !== null && place.price_level !== undefined ? PRICE_LABEL[place.price_level]
                : '?'}
            </p>
          </div>

          {/* REVIEWS — total Google review count (real data, honestly labelled) */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 4px', background: C.bg, borderRadius: 12 }}>
            <p style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.ink3, margin: '0 0 4px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>Reviews</p>
            <p style={{ fontSize: 15, fontWeight: 700, color: C.ink, margin: 0, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
              {place.ratings_total > 999 ? `${(place.ratings_total / 1000).toFixed(1)}k` : (place.ratings_total || '—')}
            </p>
            <p style={{ fontSize: 9, color: C.ink3, margin: '2px 0 0', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>on Google</p>
          </div>

          {/* STATUS / open-closed */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 4px', background: C.bg, borderRadius: 12 }}>
            <p style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.ink3, margin: '0 0 4px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>Status</p>
            {(() => {
              const live = place.is_open
              const status = live === true || live === false ? live : computeOpenNow(place.weekday_hours)
              return (
                <p style={{ fontSize: 13, fontWeight: 700, color: status === true ? '#2D7A46' : status === false ? C.accent : C.ink3, margin: 0, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
                  {status === true ? 'Open' : status === false ? 'Closed' : '—'}
                </p>
              )
            })()}
          </div>

          {/* RATING */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 4px', background: C.bg, borderRadius: 12 }}>
            <p style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.ink3, margin: '0 0 4px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>Rating</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#D4A017', fontVariationSettings: "'FILL' 1" }}>star</span>
              <p style={{ fontSize: 15, fontWeight: 700, color: C.ink, margin: 0, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{ratingValue ? ratingValue.toFixed(1) : '—'}</p>
            </div>
            {ratingBoosted && (
              <p style={{ fontSize: 9, color: '#D4A017', margin: '2px 0 0', fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontWeight: 600 }}>Rumba Score</p>
            )}
          </div>
        </div>

        {/* ── THE PITCH section ── */}
        {place.description && (
          <div style={{ padding: '24px 20px 0' }}>
            <p style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.ink3, margin: '0 0 10px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>The Pitch</p>
            <p style={{ fontFamily: "'Instrument Serif', 'Bodoni Moda', Georgia, serif", fontSize: 18, fontStyle: 'italic', color: C.ink2, margin: '0 0 4px', lineHeight: 1.5, paddingLeft: 14, borderLeft: `2px solid ${C.lineStrong}` }}>
              "{place.description}"
            </p>
            <p style={{ fontSize: 10, color: C.ink3, margin: '6px 0 0', paddingLeft: 14, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
              — {place.name}
            </p>
          </div>
        )}

        {/* ── Genre / vibe chips ── */}
        {allTags.length > 0 && (
          <div style={{ padding: '20px 20px 0', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {(place.music_genres ?? []).map(g => (
              <span key={g} style={{ fontSize: 11, color: C.accent, background: `${C.accent}14`, borderRadius: 99, padding: '4px 12px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif', letterSpacing: '0.04em' }}>{g.replace(/_/g, ' ')}</span>
            ))}
            {(place.tags ?? []).slice(0, 4).map(t => (
              <span key={t} style={{ fontSize: 11, color: C.ink3, background: C.bg, borderRadius: 99, padding: '4px 12px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{t.replace(/_/g, ' ')}</span>
            ))}
          </div>
        )}

        {/* ── Reviews horizontal scroll ── */}
        {visibleReviews.length > 0 && (
          <div style={{ paddingTop: 28 }}>
            <p style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.ink3, margin: '0 0 12px', padding: '0 20px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>Reviews</p>
            <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingLeft: 20, paddingRight: 12, paddingBottom: 4, scrollbarWidth: 'none' }}>
              {visibleReviews.map((r, i) => (
                <div key={i} style={{ flexShrink: 0, width: 260, background: C.bg, borderRadius: 14, padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <p style={{ fontWeight: 600, color: C.ink, fontSize: 13, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{r.author}</p>
                    <div style={{ display: 'flex', gap: 2, flexShrink: 0, marginLeft: 8 }}>
                      {[...Array(5)].map((_, s) => (
                        <span key={s} className="material-symbols-outlined" style={{ fontSize: 11, color: s < r.rating ? '#D4A017' : C.line, fontVariationSettings: s < r.rating ? "'FILL' 1" : undefined }}>star</span>
                      ))}
                    </div>
                  </div>
                  <p style={{ fontSize: 12, color: C.ink2, margin: '0 0 8px', lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{r.text}</p>
                  <p style={{ fontSize: 9, color: C.ink3, margin: 0, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{r.time}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Photos horizontal scroll ── */}
        {place.photos.length > 1 && (
          <div style={{ paddingTop: 24 }}>
            <p style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.ink3, margin: '0 0 12px', padding: '0 20px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>Photos</p>
            <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingLeft: 20, paddingRight: 12, paddingBottom: 4, scrollbarWidth: 'none' }}>
              {place.photos.map((url, i) => (
                <div key={i} style={{ flexShrink: 0, width: 140, height: 100, borderRadius: 12, overflow: 'hidden', background: C.bg2 }}>
                  <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Opening hours ── */}
        {place.weekday_hours.length > 0 && (
          <div style={{ padding: '24px 20px 0' }}>
            <button
              onClick={() => setHoursOpen(o => !o)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', padding: '12px 0', cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18, color: C.accent }}>schedule</span>
                <div style={{ textAlign: 'left' }}>
                  <p style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.ink3, margin: '0 0 2px', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>Opening Hours</p>
                  {(() => {
                    const live      = place.is_open
                    const computed  = computeOpenNow(place.weekday_hours)
                    const isOpen    = live === true  ? true  : live === false ? false : computed
                    const closeMins = isOpen === true  ? minutesUntilClose(place.weekday_hours) : null
                    const openMins  = isOpen === false ? minutesUntilOpen(place.weekday_hours)  : null
                    const label     = isOpen === true ? 'Open now' : isOpen === false ? 'Closed now' : 'See hours'
                    const color     = isOpen === true ? '#1F8F4A' : isOpen === false ? C.ink2 : C.ink
                    return (
                      <>
                        <p style={{ fontSize: 13, color, margin: 0, fontWeight: 500, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
                          {label}
                        </p>
                        {closeMins !== null && closeMins <= 120 && (
                          <p style={{ fontSize: 11, color: closeMins <= 30 ? C.accent : C.ink3, margin: '2px 0 0', fontWeight: 500, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
                            {formatCloseCountdown(closeMins)}
                          </p>
                        )}
                        {openMins !== null && openMins <= 24 * 60 && (
                          <p style={{ fontSize: 11, color: openMins <= 60 ? '#1F8F4A' : C.ink3, margin: '2px 0 0', fontWeight: 500, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
                            {formatOpenCountdown(openMins)}
                          </p>
                        )}
                      </>
                    )
                  })()}
                </div>
              </div>
              <span className="material-symbols-outlined" style={{ fontSize: 20, color: C.ink3 }}>{hoursOpen ? 'expand_less' : 'expand_more'}</span>
            </button>
            {hoursOpen && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 0, borderRadius: 12, overflow: 'hidden', background: C.bg }}>
                {place.weekday_hours.map((h, i) => {
                  const colon  = h.indexOf(':')
                  const day    = colon > -1 ? h.slice(0, colon).trim() : h
                  const hours  = colon > -1 ? h.slice(colon + 1).trim() : ''
                  const todayIdx = (new Date().getDay() + 6) % 7   // Mon=0 … Sun=6
                  const isToday  = i === todayIdx
                  const closed   = hours.toLowerCase() === 'closed'
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 14px',
                      background: isToday ? `${C.accent}18` : 'transparent',
                      borderBottom: i < place.weekday_hours.length - 1 ? `1px solid ${C.line}` : 'none',
                    }}>
                      <p style={{ fontSize: 13, color: isToday ? C.accent : C.ink2, fontWeight: isToday ? 600 : 400, margin: 0, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>{day}</p>
                      <p style={{ fontSize: 13, color: closed ? C.ink3 : isToday ? C.ink : C.ink2, fontWeight: isToday ? 500 : 400, margin: 0, fontFamily: 'Geist, -apple-system, system-ui, sans-serif', textAlign: 'right', whiteSpace: 'nowrap' }}>{hours || h}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Upcoming events + tickets ── */}
        {(eventsLoading || events.length > 0) && (
          <div style={{ padding: '24px 20px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.ink3, margin: 0, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>Upcoming Events</p>
              {eventsLoading && (
                <span style={{ fontSize: 9, color: C.ink3, letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'Geist, -apple-system, system-ui, sans-serif', opacity: 0.6 }}>Loading…</span>
              )}
            </div>
            {eventsLoading && (
              <>
                <div style={{ height: 110, borderRadius: 14, background: C.bg, opacity: 0.6 }} />
                <div style={{ height: 110, borderRadius: 14, background: C.bg, opacity: 0.35 }} />
              </>
            )}
            {events.map(ev => (
              <EventCard
                key={ev.id}
                event={ev}
                placeId={place.place_id}
                placeLat={place.lat}
                placeLng={place.lng}
                placeName={place.name}
              />
            ))}
          </div>
        )}

        {/* ── Rumbalist offers (demo) ───────────────────────────────── */}
        {rumbalistOffers.length > 0 && (
          <div style={{ padding: '24px 20px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <p style={{ margin: 0, fontFamily: 'Geist, -apple-system, system-ui, sans-serif',
                            fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase',
                            color: C.ink3 }}>Book this venue</p>
                <h3 style={{ margin: '4px 0 0', fontFamily: "'Instrument Serif', Georgia, serif",
                             fontStyle: 'italic', fontSize: 22, color: C.ink, letterSpacing: '-0.3px' }}>
                  Tonight&apos;s options
                </h3>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {rumbalistOffers.map((o, i) => {
                const isVip = o.kind === 'vip_table'
                return (
                  <button key={i} onClick={() => setActiveOffer(o)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
                      background: isVip
                        ? 'linear-gradient(135deg, rgb(247,233,200) 0%, rgb(235,208,146) 40%, rgb(216,176,106) 100%)'
                        : 'rgb(248,245,238)',
                      borderRadius: 16, textAlign: 'left', cursor: 'pointer', border: 'none', width: '100%',
                    }}>
                    <div style={{
                      width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                      background: isVip ? 'rgba(42,27,8,0.18)' : 'rgba(34,30,26,0.06)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <span className="material-symbols-outlined" style={{
                        fontSize: 22, color: isVip ? 'rgb(42,27,8)' : C.ink,
                        fontVariationSettings: "'FILL' 1",
                      }}>{isVip ? 'liquor' : 'list_alt'}</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontFamily: 'Geist, -apple-system, system-ui, sans-serif',
                                  fontSize: 14, fontWeight: 600,
                                  color: isVip ? 'rgb(42,27,8)' : C.ink,
                                  display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                        {o.title} <span style={{ fontWeight: 400, fontSize: 12, opacity: 0.75 }}>with</span> <RumbalistMark size={13} />
                      </p>
                      <p style={{ margin: '2px 0 0', fontSize: 12,
                                  color: isVip ? 'rgba(42,27,8,0.7)' : C.ink3 }}>
                        {o.subtitle}
                      </p>
                    </div>
                    <span style={{
                      flexShrink: 0, fontFamily: 'Geist, -apple-system, system-ui, sans-serif',
                      fontSize: 11, fontWeight: 600,
                      color: isVip ? 'rgb(42,27,8)' : C.ink, opacity: 0.9,
                    }}>
                      {isVip ? 'Book →' : 'Join →'}
                    </span>
                  </button>
                )
              })}
            </div>
            <p style={{ margin: '10px 4px 0', fontSize: 10, color: C.ink3, letterSpacing: '0.02em' }}>
              Confirmation added straight to your Apple Wallet.
            </p>
          </div>
        )}

        {/* ── Directions + Uber ── */}
        <div style={{ padding: '24px 20px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Get Directions */}
          <a
            href={directionsUrl}
            onClick={() => logVenueSignal('maps_click')}
            style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: C.bg, borderRadius: 16, textDecoration: 'none' }}
          >
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 22, color: '#3B82F6', fontVariationSettings: "'FILL' 1" }}>near_me</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontWeight: 600, color: C.ink, fontSize: 14, margin: 0, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>Get Directions</p>
              <p style={{ fontSize: 12, color: C.ink3, margin: '2px 0 0', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>Open in Maps</p>
            </div>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: C.ink3, flexShrink: 0 }}>chevron_right</span>
          </a>

          {/* Ride with Uber */}
          <a
            href={`https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[latitude]=${place.lat}&dropoff[longitude]=${place.lng}&dropoff[nickname]=${encodeURIComponent(place.name)}&dropoff[formatted_address]=${encodeURIComponent(place.address)}${process.env.NEXT_PUBLIC_UBER_CLIENT_ID ? `&client_id=${process.env.NEXT_PUBLIC_UBER_CLIENT_ID}` : ''}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => logVenueSignal('uber_click')}
            style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: '#0A0A0A', borderRadius: 16, textDecoration: 'none' }}
          >
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg viewBox="0 0 24 24" style={{ width: 22, height: 22, fill: 'white' }}><path d="M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zM8 7h2v6.5c0 1.1.9 2 2 2s2-.9 2-2V7h2v6.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V7z"/></svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontWeight: 600, color: 'white', fontSize: 14, margin: 0, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>Ride with Uber</p>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', margin: '2px 0 0', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>Request a pickup</p>
            </div>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>chevron_right</span>
          </a>

          {/* Ride with Free Now — only renders when affiliate env vars are set */}
          {process.env.NEXT_PUBLIC_FREENOW_AWIN_MID && process.env.NEXT_PUBLIC_FREENOW_AWIN_AFFID && (() => {
            // Awin deep-link wrap: tracks the click then forwards to Free Now's
            // pickup deep link. clickref lets us attribute back to a venue in the
            // Awin dashboard.
            const target = `https://www.free-now.com/?pickup=my_location&dropoff_lat=${place.lat}&dropoff_lng=${place.lng}&dropoff_name=${encodeURIComponent(place.name)}`
            const awin   = `https://www.awin1.com/cread.php?awinmid=${process.env.NEXT_PUBLIC_FREENOW_AWIN_MID}&awinaffid=${process.env.NEXT_PUBLIC_FREENOW_AWIN_AFFID}&clickref=${encodeURIComponent(`venue_${place.place_id}`)}&ued=${encodeURIComponent(target)}`
            return (
              <a
                href={awin}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  apiFetch('/api/ticket-clicks', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({
                      event_id:       `ride_${place.place_id}`,
                      platform:       'freenow',
                      venue_name:     place.name,
                      venue_place_id: place.place_id,
                    }),
                  }).catch(() => {})
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: '#00D38C', borderRadius: 16, textDecoration: 'none' }}
              >
                <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 22, color: 'white', fontVariationSettings: "'FILL' 1" }}>local_taxi</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 600, color: 'white', fontSize: 14, margin: 0, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>Ride with Free Now</p>
                  <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', margin: '2px 0 0', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>Taxi or rideshare in Europe</p>
                </div>
                <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'rgba(255,255,255,0.55)', flexShrink: 0 }}>chevron_right</span>
              </a>
            )
          })()}
        </div>

        {/* ── Instagram / WhatsApp links ── */}
        {(place.instagram_handle || place.whatsapp_link) && (
          <div style={{ padding: '16px 20px 0', display: 'flex', gap: 10 }}>
            {place.instagram_handle && (
              <a
                href={`https://instagram.com/${place.instagram_handle.replace('@', '')}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ flex: 1, height: 46, background: C.bg, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13, color: C.ink2, textDecoration: 'none', border: `1px solid ${C.line}`, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>photo_camera</span>
                Instagram
              </a>
            )}
            {place.whatsapp_link && (
              <a
                href={place.whatsapp_link}
                target="_blank"
                rel="noopener noreferrer"
                style={{ flex: 1, height: 46, background: C.bg, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13, color: C.ink2, textDecoration: 'none', border: `1px solid ${C.line}`, fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>chat</span>
                WhatsApp
              </a>
            )}
          </div>
        )}
      </div>

      {/* ── Sticky CTA bar ───────────────────────────────────────────────────
          Hidden on Rumbalist partner venues — the Rumbalist offer cards above
          replace this bar with cleaner, dedicated Book buttons. */}
      {rumbalistOffers.length === 0 && (
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'rgba(248,245,238,0.92)',
          backdropFilter: 'blur(20px)',
          borderTop: `1px solid ${C.line}`,
          padding: '14px 20px',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div>
            <p style={{ fontFamily: "'Instrument Serif', 'Bodoni Moda', Georgia, serif", fontSize: 22, color: C.accent, fontStyle: 'italic', margin: 0, lineHeight: 1.1 }}>{priceDisplay(place)}</p>
            <p style={{ fontSize: 11, color: C.ink3, margin: '3px 0 0', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
              {place.ratings_total > 999
                ? `${(place.ratings_total / 1000).toFixed(1)}k reviews`
                : `${place.ratings_total} reviews`}
            </p>
          </div>
          {place.is_partner && activeEvent ? (
            <button
              onClick={() => setShowCheckout(true)}
              style={{ flex: 1, height: 50, background: C.accent, color: 'white', border: 'none', borderRadius: 14, fontSize: 15, fontWeight: 600, fontFamily: 'Geist, -apple-system, system-ui, sans-serif', cursor: 'pointer' }}
            >
              Get Tickets
            </button>
          ) : place.is_partner ? (
            <button style={{ flex: 1, height: 50, background: C.accent, color: 'white', border: 'none', borderRadius: 14, fontSize: 15, fontWeight: 600, fontFamily: 'Geist, -apple-system, system-ui, sans-serif', cursor: 'pointer' }}>
              Book a Table
            </button>
          ) : (
            <a
              href={directionsUrl}
              onClick={() => logVenueSignal('maps_click')}
              style={{ flex: 1, height: 50, background: C.bg2, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 14, fontSize: 15, fontWeight: 600, fontFamily: 'Geist, -apple-system, system-ui, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, textDecoration: 'none' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: C.accent }}>near_me</span>
              Get Directions
            </a>
          )}
        </div>
      </div>
      )}

      {/* ── Inline checkout modal ─────────────────────────────────────────── */}
      {showCheckout && activeEvent && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ width: '100%', background: C.surface, borderRadius: '24px 24px 0 0', padding: 20, paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ width: 36, height: 4, background: C.line, borderRadius: 99, margin: '0 auto 20px' }} />
            <EventCard
              event={activeEvent}
              placeId={place.place_id}
              placeLat={place.lat}
              placeLng={place.lng}
              placeName={place.name}
            />
            <button
              onClick={() => setShowCheckout(false)}
              style={{ width: '100%', marginTop: 16, padding: '12px 0', background: 'none', border: 'none', fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.ink3, cursor: 'pointer', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Rumbalist booking sheet — Apple Pay flow → Wallet pass */}
      {activeOffer && (
        <RumbalistBookSheet
          offer={activeOffer}
          venueName={place.name}
          venueAddress={place.address}
          clubId={id as string}
          onClose={() => setActiveOffer(null)}
        />
      )}
    </div>
  )
}
