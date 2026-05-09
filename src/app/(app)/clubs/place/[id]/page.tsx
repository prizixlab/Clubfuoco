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
  place_id:        string
  name:            string
  address:         string
  lat:             number
  lng:             number
  phone:           string | null
  website:         string | null
  rating:          number | null
  ratings_total:   number
  price_level:     number | null
  is_open:         boolean | null
  weekday_hours:   string[]
  reviews:         { author: string; rating: number; text: string; time: string }[]
  photos:          string[]
  cover_photo:     string | null
  is_partner:      boolean
  google_place_id: string | null
  maps_url:        string
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
      // HTTPS required for live Stripe — show in-app message, never redirect externally
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
  const [place,      setPlace]      = useState<PlaceDetail | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [photoIdx,   setPhotoIdx]   = useState(0)
  const [hoursOpen,  setHoursOpen]  = useState(false)
  const [events,     setEvents]     = useState<ExternalEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [saved,      setSaved]      = useState(false)
  const [savingToggle, setSavingToggle] = useState(false)

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
        // Only show events actually at this venue
        const matched = (d.data ?? []).filter((e: { venue_matched: boolean }) => e.venue_matched)
        setEvents(matched)
        setEventsLoading(false)
      })
  }, [place])

  if (loading) return (
    <div className="flex items-center justify-center py-32">
      <span className="material-symbols-outlined text-[48px] text-primary animate-pulse">nightlife</span>
    </div>
  )
  if (!place) return (
    <div className="flex flex-col items-center justify-center py-32 px-container-padding text-center">
      <span className="material-symbols-outlined text-[48px] text-on-surface-variant/30 mb-md">error</span>
      <p className="font-h2 text-h2 text-on-surface">Club not found</p>
    </div>
  )

  return (
    <div className="pb-8">
      {/* Hero image */}
      <div className="relative w-full h-64">
        {place.photos.length > 0 ? (
          <img src={place.photos[photoIdx]} alt={place.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-surface-container-high flex items-center justify-center">
            <span className="material-symbols-outlined text-[64px] text-on-surface-variant/20">nightlife</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/30 to-transparent" />

        <button onClick={() => router.back()}
          className="absolute top-md left-container-padding w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center active:scale-90">
          <span className="material-symbols-outlined text-white text-[20px]">arrow_back</span>
        </button>

        <button onClick={toggleSave}
          className="absolute top-md right-container-padding w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center active:scale-90 transition-transform">
          <span className="material-symbols-outlined text-[22px] transition-colors"
            style={{
              color: saved ? '#ff4d6d' : 'white',
              fontVariationSettings: saved ? "'FILL' 1" : "'FILL' 0",
            }}>
            favorite
          </span>
        </button>

        <div className="absolute top-[52px] right-container-padding">
          {place.is_open === true  && <span className="chip-open">OPEN NOW</span>}
          {place.is_open === false && <span className="chip-default">CLOSED</span>}
        </div>

        {place.photos.length > 1 && (
          <div className="absolute bottom-16 left-0 right-0 flex justify-center gap-xs">
            {place.photos.map((_, i) => (
              <button key={i} onClick={() => setPhotoIdx(i)}
                className={`w-1.5 h-1.5 rounded-full transition-all ${i === photoIdx ? 'bg-white' : 'bg-white/30'}`} />
            ))}
          </div>
        )}

        <div className="absolute bottom-sm left-container-padding right-container-padding">
          <h1 className="font-h1 text-h1 text-white font-bold leading-tight">{place.name}</h1>
          <p className="font-body-md text-white/60">{place.address}</p>
        </div>
      </div>

      {/* Photo strip */}
      {place.photos.length > 1 && (
        <div className="flex gap-xs overflow-x-auto no-scrollbar px-container-padding py-sm">
          {place.photos.map((url, i) => (
            <button key={i} onClick={() => setPhotoIdx(i)}
              className={`flex-shrink-0 w-20 h-14 rounded-lg overflow-hidden border-2 transition-all ${i === photoIdx ? 'border-primary' : 'border-transparent'}`}>
              <img src={url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}

      <div className="px-container-padding space-y-gutter pt-sm">
        {/* Stats row */}
        <div className="flex items-center gap-md">
          {place.rating && (
            <div className="flex items-center gap-xs">
              <span className="material-symbols-outlined text-yellow-400 text-[18px]"
                style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
              <span className="font-h2 text-h2 text-on-surface">{place.rating.toFixed(1)}</span>
              <span className="font-body-md text-on-surface-variant">
                ({place.ratings_total > 999 ? `${(place.ratings_total / 1000).toFixed(1)}k` : place.ratings_total})
              </span>
            </div>
          )}
          {place.price_level !== null && (
            <span className="chip-default">{PRICE_LABEL[place.price_level]}</span>
          )}
        </div>

        {/* Info cards */}
        <div className="glass-card rounded-xl divide-y divide-outline-variant/10">
          <div className="flex items-start gap-sm p-sm">
            <span className="material-symbols-outlined text-primary text-[20px] mt-0.5">location_on</span>
            <p className="font-body-md text-on-surface">{place.address}</p>
          </div>
          {place.weekday_hours.length > 0 && (
            <button onClick={() => setHoursOpen(o => !o)}
              className="w-full flex items-center justify-between p-sm active:bg-surface-container/50">
              <div className="flex items-center gap-sm">
                <span className="material-symbols-outlined text-primary text-[20px]">schedule</span>
                <span className="font-body-md text-on-surface">
                  {place.is_open === true ? 'Open now' : place.is_open === false ? 'Closed now' : 'Hours'}
                </span>
              </div>
              <span className="material-symbols-outlined text-on-surface-variant text-[20px]">
                {hoursOpen ? 'expand_less' : 'expand_more'}
              </span>
            </button>
          )}
          {hoursOpen && place.weekday_hours.map((h, i) => (
            <div key={i} className="px-sm py-xs pl-10">
              <p className="font-body-md text-on-surface-variant text-sm">{h}</p>
            </div>
          ))}
          {place.phone && (
            <div className="flex items-center gap-sm p-sm">
              <span className="material-symbols-outlined text-primary text-[20px]">phone</span>
              <p className="font-body-md text-on-surface">{place.phone}</p>
            </div>
          )}
        </div>

        {/* Upcoming events + tickets — only shown if this venue has events on RA */}
        {(eventsLoading || events.length > 0) && (
          <div className="space-y-sm">
            <div className="flex items-center justify-between">
              <h3 className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">
                Upcoming Events
              </h3>
              {eventsLoading && (
                <span className="font-label-sm text-[10px] text-on-surface-variant/40 uppercase tracking-widest animate-pulse">Loading…</span>
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

        {/* Reviews */}
        {place.reviews.length > 0 && (
          <div className="space-y-sm">
            <h3 className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">Reviews</h3>
            {place.reviews.map((r, i) => (
              <div key={i} className="glass-card p-sm rounded-xl space-y-xs">
                <div className="flex items-center justify-between">
                  <p className="font-body-md text-on-surface font-bold">{r.author}</p>
                  <div className="flex items-center gap-xs">
                    {[...Array(5)].map((_, s) => (
                      <span key={s} className={`material-symbols-outlined text-[12px] ${s < r.rating ? 'text-yellow-400' : 'text-on-surface-variant/20'}`}
                        style={s < r.rating ? { fontVariationSettings: "'FILL' 1" } : undefined}>star</span>
                    ))}
                  </div>
                </div>
                <p className="font-body-md text-on-surface-variant text-sm leading-relaxed line-clamp-3">{r.text}</p>
                <p className="font-label-sm text-label-sm text-on-surface-variant/40 text-[10px] uppercase tracking-widest">{r.time}</p>
              </div>
            ))}
          </div>
        )}

        {/* CTA buttons */}
        <div className="space-y-sm">
          {place.is_partner ? (
            <button className="w-full h-14 bg-primary-container text-on-primary-container font-h2 rounded-xl ignite-glow active:scale-[0.98]">
              Join Guest List
            </button>
          ) : (
            <div className="space-y-sm">
              {/* Get Directions — opens native maps app */}
              <a
                href={(() => {
                  const isIOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent)
                  const dest  = `${place.lat},${place.lng}`
                  return isIOS
                    ? `maps://maps.apple.com/?daddr=${dest}&q=${encodeURIComponent(place.name)}`
                    : `https://www.google.com/maps/dir/?api=1&destination=${dest}&destination_place_id=${place.google_place_id ?? ''}`
                })()}
                className="group w-full h-[70px] bg-surface-container rounded-2xl flex items-center gap-md px-md border border-white/[0.06] active:scale-[0.98] transition-transform duration-150 relative overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/[0.08] via-transparent to-transparent pointer-events-none" />
                <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-400/20 flex items-center justify-center flex-shrink-0">
                  <span
                    className="material-symbols-outlined text-blue-400 text-[26px]"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    near_me
                  </span>
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <p className="font-semibold text-on-surface text-[15px] leading-tight">Get Directions</p>
                  <p className="text-on-surface-variant/50 text-xs mt-0.5">Open in Maps</p>
                </div>
                <span className="material-symbols-outlined text-on-surface-variant/30 text-[20px] flex-shrink-0">chevron_right</span>
              </a>

              {/* Get an Uber */}
              <a
                href={`https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[latitude]=${place.lat}&dropoff[longitude]=${place.lng}&dropoff[nickname]=${encodeURIComponent(place.name)}&dropoff[formatted_address]=${encodeURIComponent(place.address)}${process.env.NEXT_PUBLIC_UBER_CLIENT_ID ? `&client_id=${process.env.NEXT_PUBLIC_UBER_CLIENT_ID}` : ''}`}
                target="_blank"
                rel="noopener noreferrer"
                className="group w-full h-[70px] rounded-2xl flex items-center gap-md px-md active:scale-[0.98] transition-transform duration-150 relative overflow-hidden"
                style={{ background: 'linear-gradient(145deg, #1c1c1e 0%, #090909 100%)' }}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-white/[0.04] to-transparent pointer-events-none" />
                <div className="w-12 h-12 rounded-xl bg-white/[0.08] border border-white/[0.1] flex items-center justify-center flex-shrink-0">
                  {/* Uber U icon */}
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
          )}
        </div>
      </div>
    </div>
  )
}
