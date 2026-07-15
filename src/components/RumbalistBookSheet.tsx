'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { apiFetch } from '@/lib/api'
import { usePlan } from '@/contexts/PlanContext'
import { usePartner } from '@/contexts/PartnerContext'
import { useSupplier, SupplierMark, SupplierMarkKeyframes, hexToRgba } from '@/components/SupplierMark'
import { RumbalistOffer } from '@/lib/rumbalist-offers'

/**
 * Apple Pay booking sheet for a Rumbalist offer.
 *
 * Free offers do a direct Supabase insert (no payment).
 *
 * Paid offers (VIP tables) use real Apple Pay via @capacitor-community/stripe:
 *  1. POST /api/rumbalist/create-vip-intent → server creates an unconfirmed
 *     Stripe PaymentIntent and returns the client_secret.
 *  2. Stripe.createApplePay({ paymentIntentClientSecret, ... }) primes the
 *     native PKPaymentRequest with the merchant ID, currency, and line item.
 *  3. Stripe.presentApplePay() shows the system Apple Pay sheet; the device
 *     handles Face ID + authorisation and confirms the intent with Stripe.
 *  4. POST /api/rumbalist/confirm-vip → server re-checks the intent status
 *     directly with Stripe and writes the booking row. (Never trust the client
 *     to claim success.)
 *
 * Merchant identifier `merchant.com.clubfuoco.app` is declared in
 * ios/App/App/App.entitlements (com.apple.developer.in-app-payments) and must
 * be verified in the Stripe Dashboard's Apple Pay settings.
 */

const MERCHANT_ID = 'merchant.com.clubfuoco.app'

type Step = 'review' | 'authenticating' | 'pass'

export default function RumbalistBookSheet({
  offer, venueName, venueAddress, clubId, onClose,
}: {
  offer:        RumbalistOffer
  venueName:    string
  venueAddress: string
  clubId:       string
  onClose:      () => void
}) {
  const router = useRouter()
  const { plan } = usePlan()
  const isFree = offer.kind === 'free_guestlist'

  const [visible, setVisible] = useState(false)
  const [step,    setStep]    = useState<Step>('review')
  const [error,   setError]   = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [dragY,   setDragY]   = useState(0)
  const [dragging, setDragging] = useState(false)
  // VIP path only — disables the Pay button + relabels while the network
  // round-trip + Apple Pay sheet are in flight. Avoids the misleading
  // "Authenticate to pay" mock step that used to render here.
  const [paying, setPaying] = useState(false)
  // The CF-XXXXXXXX reference returned by the server after a successful
  // booking. Always set before we navigate to the 'pass' step.
  const [serverRef, setServerRef] = useState<string | null>(null)
  // Booking row id (UUID) — used by the "Add to Apple Wallet" button on the
  // confirmation screen to fetch the signed .pkpass from /api/bookings/:id/wallet.
  const [bookingId, setBookingId] = useState<string | null>(null)

  useEffect(() => {
    setMounted(true)
    requestAnimationFrame(() => setVisible(true))

    // Hide the bottom tab bar while the sheet owns the screen — the scrim's
    // touch-action: none blocks scroll on the page below so we don't need to
    // touch overflow anywhere (touching overflow on #app-scroll leaves it
    // permanently locked because overflowY isn't restored by overflow shorthand).
    const navHost = document.querySelector('nav')?.parentElement as HTMLElement | null
    const prevNav = navHost?.style.display ?? ''
    if (navHost) navHost.style.display = 'none'
    return () => {
      if (navHost) navHost.style.display = prevNav
    }
  }, [])

  function close() { setVisible(false); setTimeout(onClose, 280) }

  // Drag-to-dismiss: touching the handle bar at the top and dragging down
  // moves the sheet with the finger; releasing past 100px closes it.
  function onHandleTouchStart(e: React.TouchEvent) {
    const y0 = e.touches[0].clientY
    setDragging(true)
    let last = 0
    function move(ev: TouchEvent) {
      const dy = ev.touches[0].clientY - y0
      if (dy < 0) { last = 0; setDragY(0); return }
      last = dy
      setDragY(dy)
    }
    function end() {
      window.removeEventListener('touchmove', move)
      window.removeEventListener('touchend', end)
      window.removeEventListener('touchcancel', end)
      setDragging(false)
      if (last > 100) { close() }
      else setDragY(0)
    }
    window.addEventListener('touchmove', move, { passive: true })
    window.addEventListener('touchend', end, { passive: true })
    window.addEventListener('touchcancel', end, { passive: true })
  }

  // Paid VIP — real Apple Pay on iOS (native app), with a visible fallback
  // message on web (we don't ship a card-form fallback for VIP here; the
  // paid flow is native-only).
  //
  // We deliberately do NOT switch to the 'authenticating' step here — iOS's
  // own Apple Pay sheet (Face ID + amount + card picker) is the auth UI. A
  // pre-sheet "authenticating" screen would be a misleading mock. Instead we
  // toggle `paying` to disable the Pay button + change its label while the
  // network round-trip happens.
  async function pay() {
    if (!offer.price_eur) {
      setError('No price on this offer.')
      return
    }
    // Apple Pay VIP checkout is native-only — the iOS app sells these flows
    // natively (PassKit + Stripe). On the web we point people at the app.
    setError('Apple Pay is iOS only. Open this offer in the Club Fuoco app.')
    return
  }

    // Free guestlist — server route writes both the `bookings` row and the
  // `rumbalist_purchases` audit row in one transaction.
  async function joinGuestlist() {
    setStep('authenticating')
    setError(null)
    try {
      // Anonymous guests must sign in to put their name on the door — bounce
      // to /login with a return path. The server-side route gives a useful
      // 401 too, but checking client-side avoids a confusing "load failed".
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || user.is_anonymous) {
        close()
        router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`)
        return
      }
      const res = await apiFetch('/api/rumbalist/join-guestlist', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          club_id:      clubId,
          venue_name:   venueName,
          product_name: offer.title,
        }),
      })
      if (res.status === 401) {
        close()
        router.push('/login')
        return
      }
      const data = await res.json().catch(() => null)
      const insertErr = (!res.ok && data?.error) ? { message: data.error as string } : null
      if (insertErr) {
        setError(insertErr.message)
        setStep('review')
        return
      }
      // Server returns the booking row with its persisted reference code.
      const ref = data?.data?.qr_code_token
      const id  = data?.data?.id
      if (typeof ref === 'string') setServerRef(ref)
      if (typeof id === 'string')  setBookingId(id)
      setStep('pass')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not join the guestlist.')
      setStep('review')
    }
  }

  // The night the booking is for — the day the user picked in the planner.
  const date = new Date(`${plan.date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  // Going with friends → create a group for this offer and open the group screen.
  // Free guestlist: everyone joins free. VIP: organizer pays the table by default
  // and can re-split who pays how much on the group screen.
  async function createGroup() {
    setError(null)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || user.is_anonymous) { close(); router.push('/login?next=/explore'); return }

      const body = isFree
        ? { club_id: clubId, booking_type: 'general', booking_date: plan.date, organizer_pays: false, organizer_amount: 0, members: [] }
        : { club_id: clubId, booking_type: 'vip', booking_date: plan.date, organizer_pays: true, organizer_amount: offer.price_eur ?? undefined, members: [] }

      const res = await apiFetch('/api/groups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Could not create group')
      close()
      router.push(`/groups/placeholder?id=${d.data.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create group')
    }
  }

  // Reference code shown on the confirmation receipt. Comes back from the
  // server (which generates it, persists it as the booking's qr_code_token,
  // and guarantees uniqueness on conflict) — kept in state so the value the
  // user sees matches a real row they can be looked up by at the door.
  // Falls back to "CF-PENDING" only if for some reason the server response
  // doesn't include one (it always should).
  const passCode = serverRef ?? 'CF-PENDING'

  if (!mounted) return null

  return createPortal(
    <>
      {/* Supplier wordmark gloss-sweep keyframes (the pre-refactor Rumbalist
          treatment) — shared with the venue-page offer buttons. */}
      <SupplierMarkKeyframes />
      {/* Scrim */}
      <div onClick={step === 'pass' ? close : undefined}
        onTouchMove={e => e.preventDefault()}
        style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)',
          opacity: visible ? 1 : 0, transition: 'opacity 0.28s ease',
          touchAction: 'none',
        }}
      />

      {/* Sheet */}
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9999,
        background: '#0A0A0A',
        borderRadius: '24px 24px 0 0',
        padding: '14px 0 calc(env(safe-area-inset-bottom, 16px) + 22px)',
        transform: visible
          ? `translateY(${dragY}px)`
          : 'translateY(100%)',
        transition: dragging ? 'none' : 'transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)',
        boxShadow: '0 -20px 60px rgba(0,0,0,0.4)',
        maxHeight: '92vh', overflowY: 'auto',
      }}>
        {/* Handle — generous touch target for drag-to-dismiss */}
        <div onTouchStart={onHandleTouchStart}
          style={{ padding: '4px 0 18px', cursor: 'grab', touchAction: 'none' }}>
          <div style={{ width: 40, height: 5, background: 'rgba(255,255,255,0.28)', borderRadius: 3, margin: '0 auto' }} />
        </div>

        {step === 'review' && (
          <ReviewStep
            offer={offer} venueName={venueName} venueAddress={venueAddress}
            error={error}
            paying={paying}
            onConfirm={isFree ? joinGuestlist : pay}
            onGroup={createGroup}
            onClose={close}
          />
        )}
        {step === 'authenticating' && <AuthStep amount={offer.price_eur} isFree={isFree} />}
        {step === 'pass' && (
          <PassStep offer={offer} venueName={venueName} venueAddress={venueAddress} date={date} code={passCode} bookingId={bookingId} onClose={close} />
        )}
      </div>
    </>,
    document.body
  )
}

/* ─── Review ───────────────────────────────────────────────────────────── */
function ReviewStep({ offer, venueName, venueAddress, error, paying, onConfirm, onGroup, onClose }: {
  offer: RumbalistOffer; venueName: string; venueAddress: string;
  error: string | null;
  paying: boolean;
  onConfirm: () => void; onGroup: () => void; onClose: () => void
}) {
  const isFree = offer.kind === 'free_guestlist'
  const total  = offer.price_eur ? `€${offer.price_eur.toFixed(2)}` : 'Free'
  const supplier = useSupplier()
  return (
    <div style={{ padding: '0 22px', color: '#F5F5F7', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        {isFree
          ? <span style={{ fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(245,245,247,0.7)', fontFamily: 'ui-monospace, monospace', display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
              Free Guestlist{supplier && <> · <SupplierMark size={12} /></>}
            </span>
          : <ApplePayLogo />}
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.08)', border: 'none', color: '#fff', borderRadius: 999, width: 30, height: 30, fontSize: 16, cursor: 'pointer' }}>×</button>
      </div>

      {/* Title / amount */}
      {isFree ? (
        <>
          <p style={{ margin: '0 0 4px', fontSize: 13, color: 'rgba(245,245,247,0.55)' }}>Join the guestlist at</p>
          <p style={{ margin: 0, fontFamily: '"Instrument Serif", Georgia, serif', fontSize: 30, fontStyle: 'italic', letterSpacing: '-0.4px', lineHeight: 1.1 }}>
            {venueName}
          </p>
        </>
      ) : (
        <>
          <p style={{ margin: '0 0 4px', fontSize: 13, color: 'rgba(245,245,247,0.55)' }}>Pay Club Fuoco</p>
          <p style={{ margin: 0, fontFamily: '"Instrument Serif", Georgia, serif', fontSize: 32, fontStyle: 'italic', letterSpacing: '-0.4px' }}>
            {total}
          </p>
        </>
      )}

      {/* Items */}
      <div style={{ marginTop: 22, background: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: '14px 16px' }}>
        {isFree ? (
          <Row label="Operator" value={supplier ? <>Club Fuoco · via <SupplierMark size={11} /></> : 'Club Fuoco'} />
        ) : (
          <Row label="Pay to" value={supplier ? <>Club Fuoco · via <SupplierMark size={11} /></> : 'Club Fuoco'} />
        )}
        <Hr />
        <Row label="Venue"   value={venueName} />
        <Row label="Address" value={venueAddress} small />
        <Hr />
        <Row label={offer.title} value={offer.subtitle} small />
        <Row label="Valid"       value={offer.valid_days} small />
        <Row label="Dress code"  value={offer.dress_code} small />
        {!isFree && (
          <>
            <Hr />
            <Row label="Total" value={total} bold />
          </>
        )}
      </div>

      <SupplierCreditLine />

      {error && (
        <p style={{ margin: '12px 0 0', fontSize: 12, color: '#FFB4A2', textAlign: 'center' }}>{error}</p>
      )}

      {/* Confirm button */}
      <button onClick={paying ? undefined : onConfirm} disabled={paying}
        style={{
          marginTop: 22, width: '100%', height: 54,
          background: isFree ? '#F3EEE0' : '#FFFFFF',
          color: '#000',
          border: 'none', borderRadius: 12,
          fontSize: 17, fontWeight: 600,
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          cursor: paying ? 'default' : 'pointer',
          opacity: paying ? 0.55 : 1,
        }}>
        {isFree
          ? <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
              Join Free Guestlist
            </span>
          : paying
            ? <>Opening Apple Pay…</>
            : <><ApplePayGlyph /> &nbsp;Pay</>}
      </button>
      <p style={{ marginTop: 12, fontSize: 11, color: 'rgba(245,245,247,0.45)', textAlign: 'center' }}>
        {isFree
          ? 'You’re added to the door list. Ticket lands on your Tickets tab.'
          : 'Confirm with Face ID. Your booking is saved to your Tickets.'}
      </p>

      {/* Going with friends — create a group for this offer */}
      <button onClick={onGroup}
        style={{
          marginTop: 14, width: '100%', height: 48, background: 'transparent',
          color: '#F5F5F7', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 12,
          fontSize: 15, fontWeight: 500, fontFamily: 'Geist, -apple-system, system-ui, sans-serif',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer',
        }}>
        <span className="material-symbols-outlined" style={{ fontSize: 19 }}>group</span>
        {isFree ? 'Bring your crew' : 'Split with friends'}
      </button>
      <p style={{ marginTop: 8, fontSize: 11, color: 'rgba(245,245,247,0.45)', textAlign: 'center' }}>
        {isFree ? 'Invite friends to the guestlist — everyone’s on the door.' : 'You cover the table by default; choose who chips in.'}
      </p>
    </div>
  )
}

/* ─── Authenticating ───────────────────────────────────────────────────── */
function AuthStep({ amount, isFree }: { amount: number | null; isFree: boolean }) {
  return (
    <div style={{ padding: '32px 22px 22px', color: '#F5F5F7', textAlign: 'center', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
      <div style={{ width: 86, height: 86, borderRadius: 22, margin: '0 auto 24px',
                    border: '2px solid rgba(255,255,255,0.18)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    animation: 'cfPulse 1.4s ease-in-out infinite' }}>
        {isFree ? <ListGlyph /> : <FaceIdGlyph />}
      </div>
      <p style={{ margin: 0, fontSize: 19, fontWeight: 500 }}>
        {isFree ? 'Adding you to the guestlist…' : 'Authenticate to pay'}
      </p>
      <p style={{ margin: '8px 0 0', fontSize: 13, color: 'rgba(245,245,247,0.55)' }}>
        {isFree ? 'Recording your spot on the door list' : (amount ? `€${amount.toFixed(2)} to Club Fuoco` : 'Free guestlist · Club Fuoco')}
      </p>
      <style>{`@keyframes cfPulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.05);opacity:0.7} }`}</style>
    </div>
  )
}

function ListGlyph() {
  return (
    <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#fff' }}>
      <path d="M3 6h18M3 12h18M3 18h12"/>
      <path d="M19 17l1.5 1.5L23 16"/>
    </svg>
  )
}

/* ─── Confirmation receipt ────────────────────────────────────────────── */
// Club Fuoco confirmation. We deliberately stay flat-receipt (no gradient pass
// card, no barcode/QR block) so we don't trip Guideline 4.5.4 (Apple Pay/Wallet
// visual imitation). Accents use Club Fuoco's dark-surface coral.
function PassStep({ offer, venueName, venueAddress, date, code, bookingId, onClose }: {
  offer: RumbalistOffer; venueName: string; venueAddress: string;
  date: string; code: string; bookingId: string | null; onClose: () => void
}) {
  // Accent follows the active supplier (Rumba pink, as before); the soft
  // salmon stays as the no-supplier fallback.
  const supplier  = useSupplier()
  const PINK      = supplier?.color || '#FFB4A2'
  const PINK_DIM  = hexToRgba(PINK, 0.14)
  const PINK_RULE = hexToRgba(PINK, 0.32)

  // Open the signed .pkpass — the browser downloads it / hands it to Wallet.
  async function addToAppleWallet() {
    if (!bookingId) return
    const base = typeof window !== 'undefined' ? window.location.origin : ''
    window.open(`${base}/api/bookings/${bookingId}/wallet`, '_blank')
  }

  return (
    <div style={{ padding: '8px 22px 0', fontFamily: 'Geist, -apple-system, system-ui, sans-serif', color: '#F5F5F7' }}>

      {/* Top accent rule + Club Fuoco lockup */}
      <div style={{ height: 2, background: PINK, margin: '0 -22px 18px' }} />
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <p style={{ margin: '0 0 6px', fontSize: 10, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'rgba(245,245,247,0.55)' }}>
          A booking with
        </p>
        <div style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontStyle: 'italic', fontSize: 26, letterSpacing: '-0.2px', color: '#F5F5F7' }}>
          Club Fuoco
        </div>
        {supplier && (
          <p style={{ margin: '6px 0 0', fontSize: 11, color: 'rgba(245,245,247,0.55)' }}>
            via <SupplierMark size={11} />
          </p>
        )}
      </div>

      {/* Success badge */}
      <div style={{ textAlign: 'center', marginBottom: 22 }}>
        <div style={{
          width: 54, height: 54, borderRadius: 27, margin: '0 auto 14px',
          background: PINK_DIM,
          border: `1px solid ${PINK_RULE}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 26, color: PINK, fontWeight: 600,
        }}>✓</div>
        <p style={{ margin: 0, fontFamily: '"Instrument Serif", Georgia, serif', fontStyle: 'italic', fontSize: 28, lineHeight: 1.2 }}>
          You&rsquo;re on the list at
        </p>
        <p style={{ margin: '4px 0 0', fontFamily: '"Instrument Serif", Georgia, serif', fontStyle: 'italic', fontSize: 28, lineHeight: 1.2, color: PINK }}>
          {venueName}
        </p>
      </div>

      <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '0 -22px' }} />

      {/* Receipt rows */}
      <div style={{ padding: '4px 0' }}>
        <Row label={offer.title} value={<span style={{ color: PINK, fontWeight: 600 }}>Confirmed</span>} />
        <Row label="Date"        value={date} />
        <Row label="Door"        value={offer.subtitle.split(' · ')[0]} small />
        <Row label="Dress"       value={offer.dress_code.split(' — ')[0]} small />
        <Row label="Address"     value={venueAddress} small />
      </div>

      <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px -22px 16px' }} />

      {/* Reference — pink-tinted label, monospace code */}
      <p style={{ margin: 0, fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: PINK, textAlign: 'center' }}>
        Reference
      </p>
      <p style={{ margin: '6px 0 0', fontFamily: 'ui-monospace, monospace', fontSize: 16, letterSpacing: '0.18em', textAlign: 'center', color: '#F5F5F7' }}>
        {code}
      </p>
      <p style={{ margin: '14px 0 0', fontSize: 11, color: 'rgba(245,245,247,0.5)', textAlign: 'center', lineHeight: 1.5 }}>
        Show this on the door, or open it any time from your Tickets.
      </p>

      <SupplierCreditLine />

      {/* Add to Apple Wallet — black pill, native PassKit visual language.
          Only renders once the server-confirmed booking id is in hand. */}
      {bookingId && (
        <button onClick={addToAppleWallet}
          style={{
            marginTop: 22, width: '100%', height: 50,
            background: '#000000', color: '#FFFFFF',
            border: 'none', borderRadius: 12,
            fontSize: 15, fontWeight: 500, cursor: 'pointer',
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>account_balance_wallet</span>
          Add to Apple Wallet
        </button>
      )}

      <button onClick={onClose}
        style={{
          marginTop: 12, width: '100%', height: 50,
          background: PINK, color: '#1A1210',
          border: 'none', borderRadius: 12,
          fontSize: 15, fontWeight: 600, cursor: 'pointer',
          fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
          letterSpacing: '0.01em',
        }}>
        Done
      </button>
    </div>
  )
}

/* ─── Supplier credit ──────────────────────────────────────────────────── */
// Contractual attribution for the active offer supplier ("Guestlist by Rumba").
// Data-driven from /api/partner: renders only when the supplier's contract
// requires it (brand.attribution_required), as a small subordinate line —
// Club Fuoco stays the dominant brand on the sheet. The supplier's logo/color
// live only inside this credit.
function SupplierCreditLine() {
  const { brand } = usePartner()
  if (!brand.attribution_required) return null
  return (
    <p style={{
      margin: '14px 0 0', textAlign: 'center', fontSize: 11,
      color: 'rgba(245,245,247,0.5)', fontFamily: 'Geist, -apple-system, system-ui, sans-serif',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    }}>
      {brand.attribution_label?.trim() || 'Guestlist by'}
      {brand.logo_url
        ? <img src={brand.logo_url} alt={brand.name} style={{ height: 12, maxWidth: 84, objectFit: 'contain', opacity: 0.85 }} />
        : <span style={{ fontWeight: 600, color: 'rgba(245,245,247,0.72)' }}>{brand.name}</span>}
    </p>
  )
}

/* ─── Bits ─────────────────────────────────────────────────────────────── */
function Row({ label, value, bold, small }: { label: string; value: React.ReactNode; bold?: boolean; small?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '7px 0' }}>
      <span style={{ fontSize: 12, color: 'rgba(245,245,247,0.55)' }}>{label}</span>
      <span style={{ fontSize: small ? 12 : 14, fontWeight: bold ? 600 : 400, color: '#F5F5F7', textAlign: 'right', maxWidth: '60%' }}>{value}</span>
    </div>
  )
}

const Hr = () => <div style={{ height: 1, background: 'rgba(255,255,255,0.08)' }} />

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <p style={{ margin: 0, fontSize: 8, letterSpacing: '0.18em', textTransform: 'uppercase', opacity: 0.6 }}>{label}</p>
      <p style={{ margin: '3px 0 0', fontSize: 12.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</p>
    </div>
  )
}

function ApplePayLogo() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#fff' }}>
      <ApplePayGlyph />
      <span style={{ fontWeight: 500, fontSize: 14, fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif' }}>Pay</span>
    </span>
  )
}
function ApplePayGlyph() {
  // Apple symbol only — the "Pay" wordmark is rendered as text alongside it.
  return (
    <svg width="14" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
    </svg>
  )
}
function FaceIdGlyph() {
  return (
    <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#fff' }}>
      <path d="M4 8V6a2 2 0 0 1 2-2h2"/>
      <path d="M16 4h2a2 2 0 0 1 2 2v2"/>
      <path d="M4 16v2a2 2 0 0 0 2 2h2"/>
      <path d="M16 20h2a2 2 0 0 0 2-2v-2"/>
      <path d="M9 10v.5"/>
      <path d="M15 10v.5"/>
      <path d="M12 9v4.5l-1 .5"/>
      <path d="M9 15s1 1 3 1 3-1 3-1"/>
    </svg>
  )
}
