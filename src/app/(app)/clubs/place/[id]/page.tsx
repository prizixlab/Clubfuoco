'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import type { ExternalEvent } from '@/lib/tickets'

// Lazy-load Stripe only on HTTPS (live keys require it). On HTTP (local dev) we fall back to platform links.
let stripePromise: Promise<Stripe | null> | null = null
function getStripe() {
  if (typeof window === 'undefined') return null
  if (window.location.protocol !== 'https:') return null
  if (!stripePromise) stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)
  return stripePromise
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
  return '—'
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
    <form onSubmit={handlePay} className="space-y-md">
      <div className="glass-card p-sm rounded-xl space-y-xs">
        <p className="font-body-md font-bold text-on-surface">{event.title}</p>
        <p className="font-body-md text-on-surface-variant/60 text-sm">{event.venue_name}</p>
        <p className="font-body-md text-on-surface-variant/60 text-sm">{fmtDate(event.date)}</p>
        <div className="border-t border-outline-variant/10 pt-xs mt-xs space-y-xs">
          <div className="flex justify-between font-body-md text-sm text-on-surface-variant">
            <span>Ticket</span>
            <span>{fmtPrice(event.base_price, event.currency)}</span>
          </div>
          <div className="flex justify-between font-body-md text-sm text-on-surface-variant">
            <span>Service fee (10%)</span>
            <span>{fmtPrice(markupCents, event.currency)}</span>
          </div>
          <div className="flex justify-between font-h2 text-h2 text-on-surface border-t border-outline-variant/10 pt-xs">
            <span>Total</span>
            <span className="text-primary">{fmtPrice(totalCents, event.currency)}</span>
          </div>
        </div>
      </div>

      <PaymentElement />

      {error && <p className="font-body-md text-error text-sm text-center">{error}</p>}

      <button type="submit" disabled={paying || !stripe}
        className="w-full h-14 bg-primary-container text-on-primary-container font-h2 rounded-xl ignite-glow active:scale-[0.98] disabled:opacity-50">
        {paying ? 'Processing…' : `Pay ${fmtPrice(totalCents, event.currency)}`}
      </button>
      <button type="button" onClick={onCancel}
        className="w-full py-sm font-label-sm text-label-sm text-on-surface-variant/50 uppercase tracking-widest">
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

    // Free events — just record an RSVP, no payment needed
    if (event.base_price === 0) {
      await fetch('/api/tickets', {
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

    const res  = await fetch('/api/tickets', {
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
      await fetch('/api/tickets/confirm', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ order_id: orderId, payment_intent_id: intentId }),
      }).catch(() => {})
    }
    setSuccess(true)
  }

  if (success) {
    return (
      <div className="glass-card p-md rounded-xl text-center space-y-xs">
        <span className="material-symbols-outlined text-[36px] text-green-500" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
        <p className="font-h2 text-h2 text-on-surface">Tickets confirmed!</p>
        <p className="font-body-md text-on-surface-variant/60 text-sm">Check your notifications for details.</p>
      </div>
    )
  }

  if (clientSecret) {
    const sp = getStripe()
    if (!sp) {
      return (
        <div className="glass-card p-md rounded-xl text-center space-y-sm">
          <span className="material-symbols-outlined text-[36px] text-on-surface-variant/40">lock</span>
          <p className="font-h2 text-h2 text-on-surface">Secure connection required</p>
          <p className="font-body-md text-on-surface-variant/60 text-sm">
            Payments are processed over HTTPS. Open the app on your live URL to complete checkout.
          </p>
          <button type="button" onClick={() => { setClientSecret(null); setBuying(false) }}
            className="w-full h-12 bg-surface-container text-on-surface font-label-sm text-label-sm uppercase tracking-widest rounded-xl">
            Go Back
          </button>
        </div>
      )
    }
    return (
      <div className="glass-card p-md rounded-xl">
        <Elements stripe={sp} options={{ clientSecret, appearance: { theme: 'night' } }}>
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
    <div className="glass-card rounded-xl overflow-hidden">
      {event.image && (
        <div className="relative h-32">
          <img src={event.image} alt={event.title} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
          <span className="absolute top-xs left-xs font-label-sm text-[9px] text-white/60 uppercase tracking-widest bg-black/40 rounded-full px-xs py-[2px]">
            {platformBadge[event.platform] ?? event.platform}
          </span>
          {event.sold_out && (
            <span className="absolute top-xs right-xs chip-default text-[9px]">Sold out</span>
          )}
        </div>
      )}
      <div className="p-sm space-y-xs">
        <p className="font-body-md font-bold text-on-surface leading-tight">{event.title}</p>
        <div className="flex items-center gap-sm">
          <div className="flex items-center gap-xs text-on-surface-variant/60">
            <span className="material-symbols-outlined text-[14px]">calendar_today</span>
            <span className="font-body-md text-sm">{fmtDate(event.date)}</span>
          </div>
          {event.start_time && (
            <div className="flex items-center gap-xs text-on-surface-variant/60">
              <span className="material-symbols-outlined text-[14px]">schedule</span>
              <span className="font-body-md text-sm">{event.start_time}</span>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between pt-xs border-t border-outline-variant/10">
          <div>
            <p className="font-label-sm text-[10px] text-on-surface-variant/40 uppercase tracking-widest">
              {event.base_price === 0 ? 'Free event' : 'from'}
            </p>
            {event.base_price > 0 && (
              <p className="font-h2 text-h2 text-primary">{fmtPrice(event.display_price, event.currency)}</p>
            )}
          </div>
          {!event.sold_out && (
            <button
              onClick={startCheckout}
              disabled={buying}
              className="px-md py-sm bg-primary-container text-on-primary-container font-label-sm text-label-sm uppercase tracking-widest rounded-xl ignite-glow active:scale-[0.98] disabled:opacity-50">
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
  const { id }   = useParams<{ id: string }>()
  const router   = useRouter()
  const [place,         setPlace]         = useState<PlaceDetail | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [hoursOpen,     setHoursOpen]     = useState(false)
  const [events,        setEvents]        = useState<ExternalEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [saved,         setSaved]         = useState(false)
  const [savingToggle,  setSavingToggle]  = useState(false)
  const [showCheckout,  setShowCheckout]  = useState(false)

  useEffect(() => {
    fetch(`/api/places/details?id=${id}`)
      .then(r => r.json())
      .then(d => { setPlace(d.data ?? null); setLoading(false) })
    // Check if already saved
    fetch('/api/place-favorites')
      .then(r => r.json())
      .then(d => { if ((d.data ?? []).some((f: any) => f.place_id === id)) setSaved(true) })
  }, [id])

  async function toggleSave() {
    if (!place || savingToggle) return
    setSavingToggle(true)
    if (saved) {
      setSaved(false)
      await fetch('/api/place-favorites', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ place_id: id }),
      })
    } else {
      setSaved(true)
      await fetch('/api/place-favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          place_id:    id,
          name:        place.name,
          address:     place.address,
          cover_photo: place.cover_photo,
          rating:      place.rating,
        }),
      })
    }
    setSavingToggle(false)
  }

  useEffect(() => {
    if (!place) return
    setEventsLoading(true)
    fetch(`/api/events?venue=${encodeURIComponent(place.name)}&lat=${place.lat}&lng=${place.lng}`)
      .then(r => r.json())
      .then(d => {
        const matched = (d.data ?? []).filter((e: { venue_matched: boolean }) => e.venue_matched)
        setEvents(matched)
        setEventsLoading(false)
      })
  }, [place])

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <span className="material-symbols-outlined text-[48px] text-primary animate-pulse">nightlife</span>
    </div>
  )
  if (!place) return (
    <div className="flex flex-col items-center justify-center min-h-screen px-container-padding text-center">
      <span className="material-symbols-outlined text-[48px] text-on-surface-variant/30 mb-md">error</span>
      <p className="font-h2 text-h2 text-on-surface">Club not found</p>
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

  return (
    <div className="min-h-screen bg-surface">
      {/* HERO — full bleed, no padding */}
      <div className="relative h-[55vh] w-full">
        {heroImg
          ? <img src={heroImg} alt={place.name} className="w-full h-full object-cover" />
          : <div className="w-full h-full bg-surface-container-high flex items-center justify-center">
              <span className="material-symbols-outlined text-[64px] text-on-surface-variant/20">nightlife</span>
            </div>
        }
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/70" />

        {/* Topbar overlay */}
        <div
          className="absolute top-0 left-0 right-0 flex items-center justify-between px-md"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 16px)' }}
        >
          <button
            onClick={() => router.back()}
            className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center active:scale-90 transition-transform"
          >
            <span className="material-symbols-outlined text-white text-[20px]">arrow_back</span>
          </button>

          <span className="text-white/80 text-sm font-medium">{place.neighborhood ?? ''}</span>

          <button
            onClick={toggleSave}
            className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center active:scale-90 transition-transform"
          >
            <span
              className="material-symbols-outlined text-[22px] transition-colors"
              style={{
                color: saved ? '#ff4d6d' : 'white',
                fontVariationSettings: saved ? "'FILL' 1" : "'FILL' 0",
              }}
            >favorite</span>
          </button>
        </div>

        {/* Hero bottom text */}
        <div className="absolute bottom-0 left-0 right-0 px-md pb-8">
          <p className="text-[10px] uppercase tracking-[0.2em] text-primary/90 mb-xs">Barcelona · Nightlife</p>
          <h1 className="font-display italic text-[32px] text-white leading-tight mb-xs"><em>{place.name}</em></h1>
          <p className="text-white/60 text-sm">{place.address}</p>
        </div>
      </div>

      {/* SHEET — slides up over hero */}
      <div className="relative z-10 bg-surface rounded-t-3xl -mt-8 px-md pt-lg pb-32">

        {/* Drag handle */}
        <div className="w-10 h-1 bg-outline-variant/30 rounded-full mx-auto mb-lg" />

        {/* Fact strip — 4 cols */}
        <div className="grid grid-cols-4 gap-sm mb-lg">
          {/* Rating */}
          <div className="flex flex-col items-center gap-[3px]">
            <span className="material-symbols-outlined text-yellow-400 text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
            <p className="font-bold text-on-surface text-sm">{place.rating ? place.rating.toFixed(1) : '—'}</p>
            <p className="text-[9px] text-on-surface-variant/50 uppercase tracking-widest">Rating</p>
          </div>
          {/* Reviews */}
          <div className="flex flex-col items-center gap-[3px]">
            <span className="material-symbols-outlined text-primary text-[20px]">reviews</span>
            <p className="font-bold text-on-surface text-sm">
              {place.ratings_total > 999 ? `${(place.ratings_total / 1000).toFixed(1)}k` : place.ratings_total}
            </p>
            <p className="text-[9px] text-on-surface-variant/50 uppercase tracking-widest">Reviews</p>
          </div>
          {/* Price */}
          <div className="flex flex-col items-center gap-[3px]">
            <span className="material-symbols-outlined text-primary text-[20px]">payments</span>
            <p className="font-bold text-on-surface text-sm">
              {place.price_level !== null && place.price_level !== undefined ? PRICE_LABEL[place.price_level] : '—'}
            </p>
            <p className="text-[9px] text-on-surface-variant/50 uppercase tracking-widest">Price</p>
          </div>
          {/* Open status */}
          <div className="flex flex-col items-center gap-[3px]">
            <span className={`material-symbols-outlined text-[20px] ${place.is_open === true ? 'text-green-400' : place.is_open === false ? 'text-red-400' : 'text-on-surface-variant/40'}`}>
              {place.is_open === true ? 'door_open' : 'door_front'}
            </span>
            <p className={`font-bold text-sm ${place.is_open === true ? 'text-green-400' : place.is_open === false ? 'text-red-400' : 'text-on-surface-variant'}`}>
              {place.is_open === true ? 'Open' : place.is_open === false ? 'Closed' : '—'}
            </p>
            <p className="text-[9px] text-on-surface-variant/50 uppercase tracking-widest">Status</p>
          </div>
        </div>

        {/* Music genres / tags */}
        {((place.music_genres?.length ?? 0) > 0 || (place.tags?.length ?? 0) > 0) && (
          <div className="flex flex-wrap gap-xs mb-lg">
            {(place.music_genres ?? []).map(g => (
              <span key={g} className="text-[10px] text-primary bg-primary/10 rounded-full px-xs py-[3px] uppercase tracking-wide">{g}</span>
            ))}
            {(place.tags ?? []).slice(0, 4).map(t => (
              <span key={t} className="text-[10px] text-on-surface-variant/60 bg-surface-container rounded-full px-xs py-[3px]">{t}</span>
            ))}
          </div>
        )}

        {/* About / description */}
        {place.description && (
          <div className="mb-lg">
            <p className="text-[10px] text-on-surface-variant/50 uppercase tracking-widest mb-xs">About</p>
            <p className="text-sm text-on-surface-variant leading-relaxed">{place.description}</p>
          </div>
        )}

        {/* Reviews horizontal scroll */}
        {place.reviews.length > 0 && (
          <div className="mb-lg">
            <p className="text-[10px] text-on-surface-variant/50 uppercase tracking-widest mb-sm">Reviews</p>
            <div className="flex gap-sm overflow-x-auto no-scrollbar pb-xs -mx-md px-md">
              {place.reviews.map((r, i) => (
                <div key={i} className="flex-shrink-0 w-[72vw] max-w-[280px] glass-card p-sm rounded-xl space-y-xs">
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-on-surface text-sm truncate">{r.author}</p>
                    <div className="flex items-center gap-[2px] flex-shrink-0 ml-xs">
                      {[...Array(5)].map((_, s) => (
                        <span key={s} className={`material-symbols-outlined text-[11px] ${s < r.rating ? 'text-yellow-400' : 'text-on-surface-variant/20'}`}
                          style={s < r.rating ? { fontVariationSettings: "'FILL' 1" } : undefined}>star</span>
                      ))}
                    </div>
                  </div>
                  <p className="text-on-surface-variant text-xs leading-relaxed line-clamp-3">{r.text}</p>
                  <p className="text-[9px] text-on-surface-variant/40 uppercase tracking-widest">{r.time}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Photos horizontal scroll */}
        {place.photos.length > 1 && (
          <div className="mb-lg">
            <p className="text-[10px] text-on-surface-variant/50 uppercase tracking-widest mb-sm">Photos</p>
            <div className="flex gap-sm overflow-x-auto no-scrollbar pb-xs -mx-md px-md">
              {place.photos.map((url, i) => (
                <div key={i} className="flex-shrink-0 w-32 h-24 rounded-xl overflow-hidden bg-surface-container-high">
                  <img src={url} alt="" className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Opening hours */}
        {place.weekday_hours.length > 0 && (
          <div className="mb-lg">
            <button
              onClick={() => setHoursOpen(o => !o)}
              className="w-full flex items-center justify-between py-sm"
            >
              <div className="flex items-center gap-sm">
                <span className="material-symbols-outlined text-primary text-[20px]">schedule</span>
                <div className="text-left">
                  <p className="text-[10px] text-on-surface-variant/50 uppercase tracking-widest">Opening Hours</p>
                  <p className="text-sm text-on-surface font-medium">
                    {place.is_open === true ? 'Open now' : place.is_open === false ? 'Closed now' : 'See hours'}
                  </p>
                </div>
              </div>
              <span className="material-symbols-outlined text-on-surface-variant/40 text-[20px]">
                {hoursOpen ? 'expand_less' : 'expand_more'}
              </span>
            </button>
            {hoursOpen && (
              <div className="mt-xs space-y-xs">
                {place.weekday_hours.map((h, i) => (
                  <p key={i} className="text-sm text-on-surface-variant">{h}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Upcoming events + tickets */}
        {(eventsLoading || events.length > 0) && (
          <div className="mb-lg space-y-sm">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-on-surface-variant/50 uppercase tracking-widest">Upcoming Events</p>
              {eventsLoading && (
                <span className="text-[10px] text-on-surface-variant/40 uppercase tracking-widest animate-pulse">Loading…</span>
              )}
            </div>
            {eventsLoading && (
              <>
                <div className="glass-card rounded-xl h-28 animate-pulse" />
                <div className="glass-card rounded-xl h-28 animate-pulse opacity-60" />
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

        {/* Get Directions + Uber buttons */}
        <div className="space-y-sm mb-lg">
          {/* Get Directions */}
          <a
            href={directionsUrl}
            className="group w-full h-[70px] bg-surface-container rounded-2xl flex items-center gap-md px-md border border-white/[0.06] active:scale-[0.98] transition-transform duration-150 relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/[0.08] via-transparent to-transparent pointer-events-none" />
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-400/20 flex items-center justify-center flex-shrink-0">
              <span className="material-symbols-outlined text-blue-400 text-[26px]" style={{ fontVariationSettings: "'FILL' 1" }}>near_me</span>
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="font-semibold text-on-surface text-[15px] leading-tight">Get Directions</p>
              <p className="text-on-surface-variant/50 text-xs mt-0.5">Open in Maps</p>
            </div>
            <span className="material-symbols-outlined text-on-surface-variant/30 text-[20px] flex-shrink-0">chevron_right</span>
          </a>

          {/* Ride with Uber */}
          <a
            href={`https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[latitude]=${place.lat}&dropoff[longitude]=${place.lng}&dropoff[nickname]=${encodeURIComponent(place.name)}&dropoff[formatted_address]=${encodeURIComponent(place.address)}${process.env.NEXT_PUBLIC_UBER_CLIENT_ID ? `&client_id=${process.env.NEXT_PUBLIC_UBER_CLIENT_ID}` : ''}`}
            target="_blank"
            rel="noopener noreferrer"
            className="group w-full h-[70px] rounded-2xl flex items-center gap-md px-md active:scale-[0.98] transition-transform duration-150 relative overflow-hidden"
            style={{ background: 'linear-gradient(145deg, #1c1c1e 0%, #090909 100%)' }}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.04] to-transparent pointer-events-none" />
            <div className="w-12 h-12 rounded-xl bg-white/[0.08] border border-white/[0.1] flex items-center justify-center flex-shrink-0">
              <svg viewBox="0 0 24 24" className="w-[22px] h-[22px] fill-white" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zM8 7h2v6.5c0 1.1.9 2 2 2s2-.9 2-2V7h2v6.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V7z"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="font-semibold text-white text-[15px] leading-tight">Ride with Uber</p>
              <p className="text-white/40 text-xs mt-0.5">Request a pickup</p>
            </div>
            <span className="material-symbols-outlined text-white/30 text-[20px] flex-shrink-0">chevron_right</span>
          </a>
        </div>

        {/* Instagram / WhatsApp links */}
        {(place.instagram_handle || place.whatsapp_link) && (
          <div className="flex gap-sm mb-lg">
            {place.instagram_handle && (
              <a
                href={`https://instagram.com/${place.instagram_handle.replace('@', '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 h-12 bg-surface-container rounded-xl flex items-center justify-center gap-xs text-sm text-on-surface-variant border border-outline-variant/20 active:scale-[0.98] transition-transform"
              >
                <span className="material-symbols-outlined text-[18px]">photo_camera</span>
                Instagram
              </a>
            )}
            {place.whatsapp_link && (
              <a
                href={place.whatsapp_link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 h-12 bg-surface-container rounded-xl flex items-center justify-center gap-xs text-sm text-on-surface-variant border border-outline-variant/20 active:scale-[0.98] transition-transform"
              >
                <span className="material-symbols-outlined text-[18px]">chat</span>
                WhatsApp
              </a>
            )}
          </div>
        )}
      </div>

      {/* Sticky CTA */}
      <div
        className="fixed bottom-0 left-0 right-0 bg-surface/90 backdrop-blur-xl border-t border-outline-variant/20 px-md py-sm"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}
      >
        <div className="flex items-center gap-md">
          <div>
            <p className="font-display text-[22px] text-primary leading-tight">{priceDisplay(place)}</p>
            <p className="text-xs text-on-surface-variant/60">
              {place.ratings_total > 999
                ? `${(place.ratings_total / 1000).toFixed(1)}k reviews`
                : `${place.ratings_total} reviews`}
            </p>
          </div>
          {place.is_partner && activeEvent ? (
            <button
              onClick={() => setShowCheckout(true)}
              className="flex-1 h-12 bg-primary-container text-on-primary-container rounded-xl font-semibold ignite-glow active:scale-[0.98] transition-transform"
            >
              Get Tickets
            </button>
          ) : place.is_partner ? (
            <button className="flex-1 h-12 bg-primary-container text-on-primary-container rounded-xl font-semibold ignite-glow active:scale-[0.98] transition-transform">
              Book a Table
            </button>
          ) : (
            <a
              href={directionsUrl}
              className="flex-1 h-12 bg-surface-container text-on-surface rounded-xl font-semibold flex items-center justify-center gap-xs border border-outline-variant/20 active:scale-[0.98] transition-transform"
            >
              <span className="material-symbols-outlined text-[18px] text-primary">near_me</span>
              Get Directions
            </a>
          )}
        </div>
      </div>

      {/* Inline checkout modal triggered from sticky CTA */}
      {showCheckout && activeEvent && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end">
          <div className="w-full bg-surface rounded-t-3xl p-md pb-safe max-h-[90vh] overflow-y-auto">
            <div className="w-10 h-1 bg-outline-variant/30 rounded-full mx-auto mb-lg" />
            <EventCard
              event={activeEvent}
              placeId={place.place_id}
              placeLat={place.lat}
              placeLng={place.lng}
              placeName={place.name}
            />
            <button
              onClick={() => setShowCheckout(false)}
              className="w-full mt-md py-sm text-on-surface-variant/50 text-sm uppercase tracking-widest"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
