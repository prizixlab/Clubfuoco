'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { RumbalistOffer } from '@/lib/rumbalist-offers'

/**
 * Apple Pay-styled booking sheet for a Rumbalist offer.
 * Mocks the Apple Pay flow visually for the demo, then shows the Wallet pass.
 *
 * Production roadmap (not in this demo):
 *  - replace `pay()` with a real Stripe PaymentIntent + PKPaymentRequest
 *  - replace the in-app pass card with a signed .pkpass added to Apple Wallet
 */

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
  const isFree = offer.kind === 'free_guestlist'

  const [visible, setVisible] = useState(false)
  const [step,    setStep]    = useState<Step>('review')
  const [error,   setError]   = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [dragY,   setDragY]   = useState(0)
  const [dragging, setDragging] = useState(false)

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

  // Paid VIP — Apple Pay mock + Face ID authentication.
  async function pay() {
    setStep('authenticating')
    await new Promise(r => setTimeout(r, 1400))
    setStep('pass')
  }

  // Free guestlist — no payment. Insert the booking directly via Supabase from
  // the client (this demo branch doesn't ship a backend route). A row in
  // `bookings` is all the Tickets tab needs to render the pass.
  async function joinGuestlist() {
    setStep('authenticating')
    setError(null)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        close()
        router.push('/login')
        return
      }
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10)
      const qrToken = (crypto as Crypto).randomUUID?.()
        ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const { error: insertErr } = await supabase.from('bookings').insert({
        user_id:        user.id,
        club_id:        clubId,
        booking_type:   'general',
        party_size:     1,
        booking_date:   tomorrow,
        status:         'confirmed',
        unit_price:     0,
        total_amount:   0,
        platform_fee:   0,
        qr_code_token:  qrToken,
      })
      if (insertErr) {
        setError(insertErr.message)
        setStep('review')
        return
      }
      setStep('pass')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not join the guestlist.')
      setStep('review')
    }
  }

  // The night the booking is for — next Friday, demo-realistic
  const date = (() => {
    const d = new Date()
    const dow = d.getDay()
    const daysToFri = (5 - dow + 7) % 7 || 7
    d.setDate(d.getDate() + daysToFri)
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  })()

  const passCode = 'CF-' + Math.random().toString(36).slice(2, 10).toUpperCase()

  if (!mounted) return null

  return createPortal(
    <>
      {/* Rumbalist wordmark gloss-sweep keyframes — moves the white band from
          far right through the mask and off the left, then pauses before
          repeating so the wordmark stays mostly pink with periodic shine. */}
      <style>{`@keyframes rumbaGloss {
        0%   { background-position: 100% 0; }
        55%  { background-position: -60% 0; }
        100% { background-position: -60% 0; }
      }`}</style>
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
            onConfirm={isFree ? joinGuestlist : pay}
            onClose={close}
          />
        )}
        {step === 'authenticating' && <AuthStep amount={offer.price_eur} isFree={isFree} />}
        {step === 'pass' && (
          <PassStep offer={offer} venueName={venueName} venueAddress={venueAddress} date={date} code={passCode} onClose={close} />
        )}
      </div>
    </>,
    document.body
  )
}

/* ─── Review ───────────────────────────────────────────────────────────── */
function ReviewStep({ offer, venueName, venueAddress, error, onConfirm, onClose }: {
  offer: RumbalistOffer; venueName: string; venueAddress: string;
  error: string | null;
  onConfirm: () => void; onClose: () => void
}) {
  const isFree = offer.kind === 'free_guestlist'
  const total  = offer.price_eur ? `€${offer.price_eur.toFixed(2)}` : 'Free'
  return (
    <div style={{ padding: '0 22px', color: '#F5F5F7', fontFamily: 'Geist, -apple-system, system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        {isFree
          ? <span style={{ fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(245,245,247,0.7)', fontFamily: 'ui-monospace, monospace', display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
              Free Guestlist · <RumbalistMark size={14} />
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
          <Row label="Operator" value={<>Club Fuoco · via <RumbalistMark /></>} />
        ) : (
          <Row label="Pay to" value={<>Club Fuoco · via <RumbalistMark /></>} />
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

      {error && (
        <p style={{ margin: '12px 0 0', fontSize: 12, color: '#FFB4A2', textAlign: 'center' }}>{error}</p>
      )}

      {/* Confirm button */}
      <button onClick={onConfirm}
        style={{
          marginTop: 22, width: '100%', height: 54,
          background: isFree ? '#F3EEE0' : '#FFFFFF',
          color: '#000',
          border: 'none', borderRadius: 12,
          fontSize: 17, fontWeight: 600,
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          cursor: 'pointer',
        }}>
        {isFree
          ? <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
              Free Guestlist with <RumbalistMark size={18} />
            </span>
          : <><ApplePayGlyph /> &nbsp;Pay</>}
      </button>
      <p style={{ marginTop: 12, fontSize: 11, color: 'rgba(245,245,247,0.45)', textAlign: 'center' }}>
        {isFree
          ? 'You’re added to the door list. Ticket lands on your profile + Apple Wallet.'
          : 'Confirm with Face ID. Booking added to Wallet instantly.'}
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

/* ─── Wallet Pass ──────────────────────────────────────────────────────── */
function PassStep({ offer, venueName, venueAddress, date, code, onClose }: {
  offer: RumbalistOffer; venueName: string; venueAddress: string; date: string; code: string; onClose: () => void
}) {
  return (
    <div style={{ padding: '4px 16px 0', fontFamily: 'Geist, -apple-system, system-ui, sans-serif', color: '#F5F5F7' }}>
      <p style={{ margin: '0 0 14px', textAlign: 'center', fontSize: 13, color: 'rgba(245,245,247,0.65)' }}>
        ✓ Added to Apple Wallet
      </p>

      {/* The pass */}
      <div style={{
        background: offer.kind === 'vip_table'
          ? 'linear-gradient(155deg, #1f1b16 0%, #3a2e1e 60%, #6a4a22 100%)'
          : 'linear-gradient(155deg, #0E1A44 0%, #1A2A5E 60%, #2C4180 100%)',
        borderRadius: 18, padding: '18px 18px 16px', color: 'white',
        boxShadow: '0 14px 40px rgba(0,0,0,0.5)',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position:'absolute', inset:0, backgroundImage: 'radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '12px 12px', pointerEvents: 'none' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
          <span style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontStyle: 'italic', fontSize: 18 }}>fuoco.</span>
          <span style={{ fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', opacity: 0.85, display: 'inline-flex', alignItems: 'baseline', gap: 5 }}>
            via <RumbalistMark size={11} />
          </span>
        </div>

        <p style={{ margin: '20px 0 4px', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', opacity: 0.7, position: 'relative' }}>
          {offer.title}
        </p>
        <p style={{ margin: 0, fontFamily: '"Instrument Serif", Georgia, serif', fontStyle: 'italic', fontSize: 28, lineHeight: 1.1, letterSpacing: '-0.4px', position: 'relative' }}>
          {venueName}
        </p>
        <p style={{ margin: '4px 0 0', fontSize: 12, opacity: 0.75, position: 'relative' }}>
          {venueAddress}
        </p>

        <div style={{ display: 'flex', gap: 16, marginTop: 18, position: 'relative' }}>
          <Field label="Date"       value={date} />
          <Field label="Door"       value={offer.subtitle.split(' · ')[0]} />
          <Field label="Dress"      value={offer.dress_code.split(' — ')[0]} />
        </div>

        {/* QR-ish */}
        <div style={{ marginTop: 18, background: '#fff', borderRadius: 12, padding: 12, display: 'flex', justifyContent: 'center', position: 'relative' }}>
          <div style={{ width: 116, height: 116, background: `
              repeating-linear-gradient(0deg, #000 0 4px, transparent 4px 8px),
              repeating-linear-gradient(90deg, #000 0 4px, transparent 4px 8px)` }} />
        </div>
        <p style={{ margin: '10px 0 0', textAlign: 'center', fontFamily: 'ui-monospace, monospace', fontSize: 10, letterSpacing: '0.2em', opacity: 0.85, position: 'relative' }}>
          {code}
        </p>
      </div>

      <button onClick={onClose}
        style={{
          marginTop: 18, width: '100%', height: 50,
          background: 'rgba(255,255,255,0.08)', color: '#F5F5F7',
          border: 'none', borderRadius: 12,
          fontSize: 15, fontWeight: 500, cursor: 'pointer',
          fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
        }}>
        Done
      </button>
    </div>
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

// The "Rumbalist" wordmark: chunky Bowlby One in Miami pink with a sweeping
// white-gloss highlight — like a glossy badge / Mercedes-AMG style co-brand.
// `color` lets callers override the base pink if it needs to read on a dark sheet.
// The Rumbalist wordmark — uses their actual logo PNG as a CSS mask so the
// shapes are exact, then fills it with a moving pink → white → pink gradient.
// The white band sweeps across every ~3.4s, giving the wet-gloss highlight on
// the Miami-pink mark. The PNG ships from /public, served from the iOS bundle.
function RumbalistMark({ size = 18 }: { size?: number }) {
  const mask = "url(/rumbalist-logo.png) no-repeat left center / contain"
  return (
    <span
      aria-label="Rumbalist"
      style={{
        display: 'inline-block',
        height: size,
        aspectRatio: '1600 / 325',
        verticalAlign: '-0.28em',
        backgroundImage:
          'linear-gradient(105deg, #FF2D92 0%, #FF2D92 38%, #FFFFFF 50%, #FF2D92 62%, #FF2D92 100%)',
        backgroundSize: '260% 100%',
        backgroundPosition: '100% 0',
        WebkitMask: mask,
        mask,
        animation: 'rumbaGloss 3.4s ease-in-out infinite',
      }}
    />
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
  return (
    <svg width="22" height="14" viewBox="0 0 50 31" fill="currentColor" aria-hidden>
      <path d="M9.4 4.05c-.6.71-1.56 1.27-2.52 1.19-.12-.96.35-1.98.9-2.6.6-.73 1.65-1.25 2.5-1.3.1 1 -.3 1.99-.88 2.71zm.86 1.39c-1.39-.08-2.58.79-3.24.79-.67 0-1.69-.75-2.79-.73-1.43.02-2.76.83-3.49 2.12-1.5 2.58-.39 6.4 1.07 8.49.71 1.03 1.57 2.18 2.7 2.14 1.07-.04 1.49-.69 2.78-.69 1.29 0 1.67.69 2.79.67 1.16-.02 1.89-1.04 2.6-2.07.81-1.18 1.15-2.33 1.17-2.4-.02-.01-2.24-.86-2.27-3.42-.02-2.14 1.76-3.17 1.83-3.22-1-1.49-2.57-1.65-3.15-1.68zm9.61-3.49v15.6h2.43V12.2h3.36c3.07 0 5.22-2.1 5.22-5.13s-2.11-5.13-5.14-5.13h-5.87zm2.43 2.05h2.79c2.1 0 3.31 1.13 3.31 3.09s-1.21 3.1-3.32 3.1H22.3V3.99zm11.86 13.66c1.53 0 2.94-.78 3.58-2.01h.05v1.89h2.25V8.59c0-2.27-1.81-3.74-4.6-3.74-2.59 0-4.51 1.49-4.58 3.53h2.19c.18-.97 1.07-1.61 2.32-1.61 1.51 0 2.36.71 2.36 2.01v.88l-3.07.18c-2.86.17-4.41 1.35-4.41 3.39 0 2.07 1.6 3.43 3.92 3.43zm.65-1.85c-1.31 0-2.14-.63-2.14-1.6 0-1 .8-1.59 2.34-1.68l2.74-.17v.9c0 1.49-1.26 2.55-2.94 2.55zm9.13 5.97c2.37 0 3.49-.9 4.46-3.65L52.0 8.41h-2.47l-2.74 8.86h-.05L43.99 8.41h-2.54l3.95 10.94-.21.67c-.36 1.14-.94 1.58-1.98 1.58-.18 0-.55-.02-.69-.04v1.89c.13.04.74.06.92.06z"/>
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
