'use client'
import { apiFetch } from '@/lib/api'
import { getMyBookings, getPendingSurveys } from '@/lib/supabase/queries'

import { useEffect, useRef, useState } from 'react'
import type { Booking } from '@/types'
import SurveySheet from '@/components/SurveySheet'
import NavSpacer from '@/components/NavSpacer'

/** In Capacitor the WebView origin is capacitor://localhost — not a valid HTTPS URL.
 *  Always point wallet pass URLs at the real Vercel backend. */
function walletBase() {
  if (typeof window !== 'undefined' && window.location.protocol === 'capacitor:') {
    return 'https://clubfuoco.vercel.app'
  }
  return typeof window !== 'undefined' ? window.location.origin : 'https://clubfuoco.vercel.app'
}

/** Open the pass URL in SFSafariViewController — iOS intercepts .pkpass and shows Add to Wallet */
async function addToWallet(apiPath: string) {
  try {
    const { Browser } = await import('@capacitor/browser')
    await Browser.open({ url: walletBase() + apiPath })
  } catch (e: any) {
    console.error('[wallet]', e)
    alert('Could not open Wallet. Please try again.')
  }
}

interface PendingBooking {
  id:           string
  booking_date: string
  clubs:        { id: string; name: string; cover_image_url: string | null } | null
}

interface TicketOrder {
  id:                string
  event_name:        string
  venue_name:        string
  venue_place_id:    string | null
  event_date:        string | null
  quantity:          number
  base_price_cents:  number
  markup_cents:      number
  total_cents:       number
  status:            string
  platform:          string
  platform_event_id: string | null
  created_at:        string
}

interface GuestSignup {
  id:          string
  full_name:   string
  party_size:  number
  status:      string
  tier:        string
  checked_in:  boolean
  created_at:  string
  guest_lists: {
    id:               string
    event_name:       string
    event_date:       string
    cutoff_time:      string
    free_entry_label: string
    clubs: { id: string; name: string; neighborhood: string }
  } | null
}

/** Returns true if it's past 22:59 on the booking date (Madrid time) */
function isCancelDeadlinePassed(bookingDate: string): boolean {
  const [y, m, d] = bookingDate.split('-').map(Number)
  const nowMadrid = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' }))
  const cutoff    = new Date(y, m - 1, d, 22, 59, 0)
  return nowMadrid >= cutoff
}

function isToday(dateStr: string): boolean {
  const today = new Date()
  const [y, m, d] = dateStr.split('-').map(Number)
  return today.getFullYear() === y && today.getMonth() + 1 === m && today.getDate() === d
}

function formatDateFull(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'long',
  })
}

function getTodayMonth(): string {
  return new Date().toLocaleDateString('en-GB', { month: 'long' }).toUpperCase()
}

/** Deterministic placeholder QR pattern — replace with real qr-code lib when ready */
function QRPattern({ size }: { size: number }) {
  const cell = Math.floor(size / 21)
  const s    = cell * 21
  return (
    <svg viewBox={`0 0 ${s} ${s}`} width={size} height={size} xmlns="http://www.w3.org/2000/svg"
      style={{ imageRendering: 'pixelated' }}>
      <rect width={s} height={s} fill="white" />
      {/* Top-left finder */}
      <rect x={0}          y={0}          width={cell*7} height={cell*7} fill="black" />
      <rect x={cell}       y={cell}       width={cell*5} height={cell*5} fill="white" />
      <rect x={cell*2}     y={cell*2}     width={cell*3} height={cell*3} fill="black" />
      {/* Top-right finder */}
      <rect x={cell*14}    y={0}          width={cell*7} height={cell*7} fill="black" />
      <rect x={cell*15}    y={cell}       width={cell*5} height={cell*5} fill="white" />
      <rect x={cell*16}    y={cell*2}     width={cell*3} height={cell*3} fill="black" />
      {/* Bottom-left finder */}
      <rect x={0}          y={cell*14}    width={cell*7} height={cell*7} fill="black" />
      <rect x={cell}       y={cell*15}    width={cell*5} height={cell*5} fill="white" />
      <rect x={cell*2}     y={cell*16}    width={cell*3} height={cell*3} fill="black" />
      {/* Timing strips */}
      {[8,10,12].map(i => <rect key={`h${i}`} x={cell*i} y={cell*6}  width={cell} height={cell} fill="black" />)}
      {[8,10,12].map(i => <rect key={`v${i}`} x={cell*6} y={cell*i}  width={cell} height={cell} fill="black" />)}
      {/* Data modules (decorative) */}
      {[
        [8,8],[9,8],[10,8],[8,9],[10,9],[8,10],[9,10],[10,10],
        [12,8],[13,8],[12,9],[13,9],[12,10],[13,10],
        [8,12],[9,12],[10,12],[11,12],[8,13],[11,13],[8,14],[9,14],[10,14],[11,14],
        [14,12],[15,12],[16,12],[14,13],[16,13],[14,14],[15,14],[16,14],
        [8,16],[9,17],[10,16],[11,17],[12,16],[13,17],
        [14,16],[15,16],[16,16],[14,17],[16,17],[14,18],[15,18],[16,18],
      ].map(([c, r], i) => (
        <rect key={i} x={cell*(c as number)} y={cell*(r as number)} width={cell} height={cell} fill="black" />
      ))}
    </svg>
  )
}

/** Perforation divider between hero and stub */
function Perforation() {
  return (
    <div style={{ position: 'relative', height: 1, margin: '0 10px' }}>
      {/* Left notch */}
      <div style={{
        position: 'absolute', left: -20, top: '50%', transform: 'translateY(-50%)',
        width: 20, height: 20, borderRadius: '50%', background: '#F8F5EE',
      }} />
      {/* Dashed line */}
      <div style={{ borderTop: '2px dashed #E8E2D8', margin: '0 0' }} />
      {/* Right notch */}
      <div style={{
        position: 'absolute', right: -20, top: '50%', transform: 'translateY(-50%)',
        width: 20, height: 20, borderRadius: '50%', background: '#F8F5EE',
      }} />
    </div>
  )
}

export default function BookingsPage() {
  const [bookings,      setBookings]      = useState<Booking[]>([])
  const [guestSignups,  setGuestSignups]  = useState<GuestSignup[]>([])
  const [ticketOrders,  setTicketOrders]  = useState<TicketOrder[]>([])
  const [loading,       setLoading]       = useState(true)
  const [showPast,     setShowPast]     = useState(false)
  const [cancelling,   setCancelling]   = useState<string | null>(null)
  const [seeding,      setSeeding]      = useState(false)
  const [qrFullscreen,   setQrFullscreen]   = useState<{ bookingId: string; clubName: string; dateStr: string; coverImage?: string | null; total?: number; partySize?: number; bookingType?: string } | null>(null)
  const [pendingSurveys, setPendingSurveys] = useState<PendingBooking[]>([])
  const [activeSurvey,   setActiveSurvey]   = useState<PendingBooking | null>(null)
  const [activeTab,      setActiveTab]      = useState<'tickets' | 'reviews'>('tickets')
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  // Keep screen on while QR is fullscreen
  useEffect(() => {
    if (qrFullscreen && 'wakeLock' in navigator) {
      navigator.wakeLock.request('screen')
        .then(lock => { wakeLockRef.current = lock })
        .catch(() => {})
    } else {
      wakeLockRef.current?.release().catch(() => {})
      wakeLockRef.current = null
    }
  }, [qrFullscreen])
  const [confirmId,    setConfirmId]    = useState<string | null>(null)
  const [toast,        setToast]        = useState<{ msg: string; ok: boolean } | null>(null)

  useEffect(() => {
    getMyBookings()
      .then(d => {
        setBookings(d.bookings as any)
        setGuestSignups(d.signups as any)
        setTicketOrders(d.tickets as any)
        setLoading(false)
      })
      .catch(() => setLoading(false))

    // Load pending post-visit surveys
    getPendingSurveys()
      .then(d => setPendingSurveys(d as any))
      .catch(() => {})
  }, [])

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  async function cancelBooking(id: string) {
    setConfirmId(null)
    setCancelling(id)
    try {
      const res  = await apiFetch(`/api/bookings/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error ?? 'Cancel failed', false)
      } else {
        setBookings(prev =>
          prev.map(b => b.id === id ? { ...b, status: 'cancelled' } : b)
        )
        showToast(`Cancelled — €${data.data?.refund_amount ?? '?'} refund on its way`, true)
      }
    } catch {
      showToast('Something went wrong', false)
    } finally {
      setCancelling(null)
    }
  }

  // Separate upcoming vs past
  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)

  const tonightBookings = bookings.filter(b =>
    b.booking_date === todayStr && b.status !== 'cancelled'
  )
  const upcomingBookings = bookings.filter(b => {
    const d = new Date(b.booking_date)
    return d > new Date(now.toDateString()) && b.status !== 'cancelled'
  })
  const pastBookings = bookings.filter(b => {
    const d = new Date(b.booking_date)
    return d < new Date(now.toDateString()) || b.status === 'cancelled'
  })

  const tonightSignups = guestSignups.filter(s => {
    const gl = s.guest_lists
    return gl && gl.event_date === todayStr && !s.checked_in && s.status !== 'cancelled'
  })
  const upcomingSignups = guestSignups.filter(s => {
    const gl = s.guest_lists
    return gl && new Date(gl.event_date) > new Date(now.toDateString()) && !s.checked_in && s.status !== 'cancelled'
  })
  const pastSignups = guestSignups.filter(s => {
    const gl = s.guest_lists
    return !gl || new Date(gl.event_date) < new Date(now.toDateString()) || s.checked_in || s.status === 'cancelled'
  })

  const tonightTickets = ticketOrders.filter(t => {
    if (t.status === 'payment_failed') return false
    return t.event_date === todayStr
  })
  const upcomingTickets = ticketOrders.filter(t => {
    if (t.status === 'payment_failed') return false
    if (!t.event_date) return true
    return new Date(t.event_date) > new Date(now.toDateString())
  })
  const pastTickets = ticketOrders.filter(t => {
    if (t.status === 'payment_failed') return false
    if (!t.event_date) return false
    return new Date(t.event_date) < new Date(now.toDateString())
  })

  const hasTonightItems = tonightBookings.length > 0 || tonightSignups.length > 0 || tonightTickets.length > 0
  const hasUpcoming = upcomingBookings.length > 0 || upcomingSignups.length > 0 || upcomingTickets.length > 0
  const hasPast     = pastBookings.length > 0 || pastSignups.length > 0 || pastTickets.length > 0
  const isEmpty     = bookings.length === 0 && guestSignups.length === 0 && ticketOrders.length === 0

  const totalCount  = bookings.length + guestSignups.length + ticketOrders.length

  // ─── BookingCard ────────────────────────────────────────────────────────────
  function BookingCard({ booking, tonight }: { booking: Booking; tonight?: boolean }) {
    const dateStr   = formatDateFull(booking.booking_date)
    const isPast      = new Date(booking.booking_date) < new Date(now.toDateString())
    const isCancelled = booking.status === 'cancelled'
    const isUsed      = booking.status === 'used'
    const canCancel   = !isPast && !isCancelled && !isUsed &&
                        !isCancelDeadlinePassed(booking.booking_date)
    const deadlineSoon = !isPast && !isCancelled && !isUsed &&
                         isCancelDeadlinePassed(booking.booking_date)

    const clubName  = (booking as any).clubs?.name ?? 'Club'
    const coverImg  = (booking as any).clubs?.cover_image_url as string | null | undefined
    const code      = `FUO·${clubName.slice(0, 3).toUpperCase()}·${booking.id.slice(-4).toUpperCase()}`

    const isLive = tonight && !isCancelled && !isUsed && !isPast

    return (
      <div style={{
        background: '#FFFFFF',
        borderRadius: 16,
        boxShadow: '0 2px 12px rgba(34,30,26,0.08)',
        overflow: 'hidden',
        marginBottom: 16,
        opacity: isCancelled || (isPast && !tonight) ? 0.6 : 1,
        borderLeft: isLive ? '3px solid #8C2A2A' : undefined,
      }}>
        {/* Hero */}
        <div style={{ position: 'relative', height: 140, overflow: 'hidden' }}>
          {coverImg ? (
            <img src={coverImg} alt={clubName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', background: '#2A1F1A' }} />
          )}
          {/* Dark gradient overlay */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.1), rgba(0,0,0,0.65))',
          }} />
          {/* Top line: category crumb + status badge */}
          <div style={{
            position: 'absolute', top: 12, left: 12, right: 12,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ color: 'white', fontSize: 10 }}>Nightlife · Barcelona</span>
            {isLive ? (
              <span style={{
                fontSize: 10, padding: '2px 8px', borderRadius: 99,
                background: 'rgba(34,197,94,0.15)', color: '#16a34a',
                border: '1px solid rgba(34,197,94,0.3)',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <span style={{ fontSize: 8 }}>●</span> Tonight
              </span>
            ) : isCancelled ? (
              <span style={{
                fontSize: 10, padding: '2px 8px', borderRadius: 99,
                background: 'rgba(120,120,120,0.18)', color: '#888',
                border: '1px solid rgba(120,120,120,0.2)',
              }}>Cancelled</span>
            ) : isPast ? (
              <span style={{
                fontSize: 10, padding: '2px 8px', borderRadius: 99,
                background: 'rgba(120,120,120,0.18)', color: '#888',
                border: '1px solid rgba(120,120,120,0.2)',
              }}>Past</span>
            ) : (
              <span style={{
                fontSize: 10, padding: '2px 8px', borderRadius: 99,
                background: 'rgba(140,42,42,0.1)', color: '#8C2A2A',
                border: '1px solid rgba(140,42,42,0.2)',
              }}>Confirmed</span>
            )}
          </div>
          {/* Bottom: event name + venue */}
          <div style={{ position: 'absolute', bottom: 12, left: 12, right: 12 }}>
            <div style={{
              fontFamily: '"Instrument Serif", Georgia, serif',
              fontStyle: 'italic',
              fontSize: 22,
              color: 'white',
              lineHeight: 1.2,
            }}>{clubName}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>
              {dateStr}
            </div>
          </div>
        </div>

        {/* Perforation */}
        <Perforation />

        {/* Stub */}
        <div style={{ padding: 16 }}>
          {/* 2×2 fact grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
            {[
              { label: 'Date', value: new Date(booking.booking_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) },
              { label: 'Doors', value: '23:00' },
              { label: 'Guests', value: String(booking.party_size) },
              { label: 'Ticket', value: booking.booking_type ?? 'General' },
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9F9486', marginBottom: 2 }}>
                  {label}
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#221E1A', textTransform: 'capitalize' }}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          {/* QR row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* QR thumb or placeholder */}
            {booking.status === 'confirmed' ? (
              <button
                onClick={() => setQrFullscreen({
                  bookingId: booking.id,
                  clubName,
                  dateStr,
                  coverImage: coverImg,
                  total: booking.total_amount,
                  partySize: booking.party_size,
                  bookingType: booking.booking_type,
                })}
                style={{ flexShrink: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                <div style={{ width: 48, height: 48, borderRadius: 8, overflow: 'hidden', border: '1px solid #E8E2D8', padding: 2, background: 'white' }}>
                  <QRPattern size={40} />
                </div>
              </button>
            ) : (
              <div style={{ width: 48, height: 48, borderRadius: 8, border: '1px solid #E8E2D8', background: '#F8F5EE', flexShrink: 0 }} />
            )}

            {/* Code + total */}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9F9486' }}>Code</div>
              <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#221E1A', letterSpacing: '0.05em' }}>{code}</div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9F9486' }}>Total paid</div>
              <div style={{
                fontFamily: '"Instrument Serif", Georgia, serif',
                fontStyle: 'italic',
                fontSize: 18,
                fontWeight: 700,
                color: '#221E1A',
              }}>€{(booking.total_amount ?? 0).toFixed(2)}</div>
              {booking.status === 'confirmed' && (
                <button
                  onClick={() => setQrFullscreen({
                    bookingId: booking.id,
                    clubName,
                    dateStr,
                    coverImage: coverImg,
                    total: booking.total_amount,
                    partySize: booking.party_size,
                    bookingType: booking.booking_type,
                  })}
                  style={{ fontSize: 10, color: '#8C2A2A', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                  Tap to expand →
                </button>
              )}
            </div>
          </div>

          {/* Cancel controls */}
          {canCancel && (
            <div style={{ marginTop: 12, borderTop: '1px solid #F0EDE8', paddingTop: 12 }}>
              {confirmId === booking.id ? (
                <div>
                  <p style={{ fontSize: 11, color: '#9F9486', marginBottom: 8 }}>
                    We&apos;ll refund everything except the 10% service fee.
                  </p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => setConfirmId(null)}
                      style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #E8E2D8', background: '#F8F5EE', fontSize: 12, fontWeight: 600, color: '#221E1A', cursor: 'pointer' }}>
                      Keep
                    </button>
                    <button
                      onClick={() => cancelBooking(booking.id)}
                      disabled={cancelling === booking.id}
                      style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: 'none', background: 'rgba(140,42,42,0.12)', fontSize: 12, fontWeight: 600, color: '#8C2A2A', cursor: 'pointer', opacity: cancelling === booking.id ? 0.5 : 1 }}>
                      {cancelling === booking.id ? 'Cancelling…' : 'Confirm cancel'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmId(booking.id)}
                  style={{ fontSize: 11, color: '#8C2A2A', background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 0, 'wght' 300" }}>close</span> Cancel ticket
                </button>
              )}
            </div>
          )}

          {deadlineSoon && !isCancelled && !isUsed && (
            <p style={{ fontSize: 11, color: '#9F9486', marginTop: 8 }}>
              Cancellations closed for tonight
            </p>
          )}
        </div>
      </div>
    )
  }

  // ─── GuestCard ──────────────────────────────────────────────────────────────
  function GuestCard({ signup, tonight }: { signup: GuestSignup; tonight?: boolean }) {
    const gl = signup.guest_lists
    if (!gl) return null
    const dateStr = formatDateFull(gl.event_date)
    const isPast = new Date(gl.event_date) < new Date(now.toDateString())
    const isCancelled = signup.status === 'cancelled'
    const clubName = gl.clubs?.name ?? 'Club'
    const isLive = tonight && !isCancelled && !signup.checked_in && !isPast

    return (
      <div style={{
        background: '#FFFFFF',
        borderRadius: 16,
        boxShadow: '0 2px 12px rgba(34,30,26,0.08)',
        overflow: 'hidden',
        marginBottom: 16,
        opacity: isCancelled || signup.checked_in || isPast ? 0.6 : 1,
        borderLeft: isLive ? '3px solid #8C2A2A' : undefined,
      }}>
        {/* Hero */}
        <div style={{ position: 'relative', height: 140, overflow: 'hidden', background: '#2A1F1A' }}>
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.1), rgba(0,0,0,0.65))',
          }} />
          <div style={{
            position: 'absolute', top: 12, left: 12, right: 12,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ color: 'white', fontSize: 10 }}>Guest list · {gl.clubs?.neighborhood ?? 'Barcelona'}</span>
            {isLive ? (
              <span style={{
                fontSize: 10, padding: '2px 8px', borderRadius: 99,
                background: 'rgba(34,197,94,0.15)', color: '#16a34a',
                border: '1px solid rgba(34,197,94,0.3)',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <span style={{ fontSize: 8 }}>●</span> Tonight
              </span>
            ) : isCancelled ? (
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(120,120,120,0.18)', color: '#888', border: '1px solid rgba(120,120,120,0.2)' }}>Cancelled</span>
            ) : isPast || signup.checked_in ? (
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(120,120,120,0.18)', color: '#888', border: '1px solid rgba(120,120,120,0.2)' }}>{signup.checked_in ? 'Used' : 'Past'}</span>
            ) : (
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(140,42,42,0.1)', color: '#8C2A2A', border: '1px solid rgba(140,42,42,0.2)' }}>Confirmed</span>
            )}
          </div>
          <div style={{ position: 'absolute', bottom: 12, left: 12, right: 12 }}>
            <div style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontStyle: 'italic', fontSize: 22, color: 'white', lineHeight: 1.2 }}>
              {gl.event_name}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>{clubName} · {dateStr}</div>
          </div>
        </div>

        <Perforation />

        <div style={{ padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
            {[
              { label: 'Date', value: new Date(gl.event_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) },
              { label: 'Before', value: gl.cutoff_time?.slice(0, 5) ?? '—' },
              { label: 'Guests', value: String(signup.party_size) },
              { label: 'Tier', value: signup.tier === 'vip' ? 'VIP' : 'Free' },
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9F9486', marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#221E1A', textTransform: 'capitalize' }}>{value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Decorative symbol instead of QR */}
            <div style={{ width: 48, height: 48, borderRadius: 8, border: '1px solid #E8E2D8', background: '#F8F5EE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, color: '#8C2A2A', flexShrink: 0 }}>
              ✦
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9F9486' }}>Entry</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#221E1A' }}>
                {signup.tier === 'vip' ? 'VIP' : gl.free_entry_label ?? 'Free'}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9F9486' }}>Show at door</div>
              <div style={{ fontSize: 12, color: '#9F9486', fontFamily: 'monospace' }}>{signup.id.slice(-6).toUpperCase()}</div>
            </div>
          </div>

          {!isCancelled && !isPast && (
            <button
              onClick={() => addToWallet(`/api/guest-lists/${signup.id}/wallet`)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                marginTop: 14, padding: '10px 0', width: '100%',
                background: '#000000', borderRadius: 10, border: 'none', cursor: 'pointer',
                color: '#FFFFFF',
                fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>wallet</span>
              Add to Apple Wallet
            </button>
          )}
        </div>
      </div>
    )
  }

  // ─── TicketOrderCard ─────────────────────────────────────────────────────────
  function TicketOrderCard({ order, tonight }: { order: TicketOrder; tonight?: boolean }) {
    const dateStr = order.event_date
      ? formatDateFull(order.event_date)
      : 'Date TBC'
    const isPast = order.event_date ? new Date(order.event_date) < new Date(now.toDateString()) : false
    const totalEur = (order.total_cents / 100).toFixed(2)
    const isLive = tonight && order.status === 'paid' && !isPast
    const code = `FUO·${order.event_name.slice(0, 3).toUpperCase()}·${order.id.slice(-4).toUpperCase()}`

    return (
      <div style={{
        background: '#FFFFFF',
        borderRadius: 16,
        boxShadow: '0 2px 12px rgba(34,30,26,0.08)',
        overflow: 'hidden',
        marginBottom: 16,
        opacity: isPast ? 0.6 : 1,
        borderLeft: isLive ? '3px solid #8C2A2A' : undefined,
      }}>
        {/* Hero */}
        <div style={{ position: 'relative', height: 140, overflow: 'hidden', background: '#2A1F1A' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.1), rgba(0,0,0,0.65))' }} />
          <div style={{ position: 'absolute', top: 12, left: 12, right: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'white', fontSize: 10 }}>Event ticket · {order.platform}</span>
            {isLive ? (
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(34,197,94,0.15)', color: '#16a34a', border: '1px solid rgba(34,197,94,0.3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 8 }}>●</span> Tonight
              </span>
            ) : isPast ? (
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(120,120,120,0.18)', color: '#888', border: '1px solid rgba(120,120,120,0.2)' }}>Past</span>
            ) : order.status === 'paid' ? (
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(140,42,42,0.1)', color: '#8C2A2A', border: '1px solid rgba(140,42,42,0.2)' }}>Confirmed</span>
            ) : (
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(120,120,120,0.18)', color: '#888', border: '1px solid rgba(120,120,120,0.2)' }}>Pending</span>
            )}
          </div>
          <div style={{ position: 'absolute', bottom: 12, left: 12, right: 12 }}>
            <div style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontStyle: 'italic', fontSize: 22, color: 'white', lineHeight: 1.2 }}>{order.event_name}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>{order.venue_name} · {dateStr}</div>
          </div>
        </div>

        <Perforation />

        <div style={{ padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
            {[
              { label: 'Date', value: order.event_date ? new Date(order.event_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'TBC' },
              { label: 'Venue', value: order.venue_name.slice(0, 6) },
              { label: 'Qty', value: String(order.quantity) },
              { label: 'Status', value: order.status === 'paid' ? 'Paid' : 'Pending' },
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9F9486', marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#221E1A' }}>{value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 48, height: 48, borderRadius: 8, border: '1px solid #E8E2D8', background: '#F8F5EE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#8C2A2A' }}>confirmation_number</span>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9F9486' }}>Code</div>
              <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#221E1A', letterSpacing: '0.05em' }}>{code}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9F9486' }}>Total paid</div>
              <div style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontStyle: 'italic', fontSize: 18, fontWeight: 700, color: '#221E1A' }}>€{totalEur}</div>
            </div>
          </div>

          {order.status === 'paid' && !isPast && (
            <button
              onClick={() => addToWallet(`/api/tickets/${order.id}/wallet`)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                marginTop: 14, padding: '10px 0', width: '100%',
                background: '#000000', borderRadius: 10, border: 'none', cursor: 'pointer',
                color: '#FFFFFF',
                fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>wallet</span>
              Add to Apple Wallet
            </button>
          )}
        </div>
      </div>
    )
  }

  // ─── Section label ───────────────────────────────────────────────────────────
  function SectionLabel({ index, title, count }: { index: string; title: string; count: number }) {
    return (
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12, marginTop: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#8C2A2A' }}>{index}</span>
        <span style={{ fontSize: 14, color: '#221E1A', flex: 1 }}>{title}</span>
        <span style={{ fontSize: 14, color: '#9F9486' }}>{count} {count === 1 ? 'ticket' : 'tickets'}</span>
      </div>
    )
  }

  async function seedTestBooking() {
    setSeeding(true)
    try {
      const res  = await apiFetch('/api/dev/test-booking', { method: 'POST' })
      const data = await res.json()
      if (res.ok && data.data) {
        setBookings(prev => [data.data, ...prev])
        showToast('Test booking added', true)
      } else {
        showToast(data.error ?? 'Failed', false)
      }
    } catch {
      showToast('Something went wrong', false)
    } finally {
      setSeeding(false)
    }
  }

  const nightsWaiting = upcomingBookings.length + upcomingSignups.length + upcomingTickets.length +
    tonightBookings.length + tonightSignups.length + tonightTickets.length

  return (
    <div style={{ background: '#F8F5EE', minHeight: '100vh', paddingBottom: 32 }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
          zIndex: 50, padding: '10px 20px', borderRadius: 12, fontSize: 14, fontWeight: 600,
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          background: toast.ok ? '#221E1A' : '#8C2A2A', color: 'white',
          whiteSpace: 'nowrap',
        }}>
          {toast.msg}
        </div>
      )}

      {/* Page header */}
      <div style={{ padding: '24px 16px 8px' }}>
        {/* Kicker */}
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.18em', color: '#9F9486', marginBottom: 4 }}>
          N° {String(new Date().getDate()).padStart(2, '0')} · {getTodayMonth()}
        </div>
        {/* H1 */}
        <h1 style={{ fontSize: 32, color: '#221E1A', margin: 0, fontWeight: 400, lineHeight: 1.2, fontFamily: '"Instrument Serif", Georgia, serif', fontStyle: 'italic' }}>
          I tuoi biglietti
        </h1>
        {/* Sub */}
        <div style={{ fontSize: 12, color: '#9F9486', marginTop: 4 }}>
          {nightsWaiting > 0
            ? `${nightsWaiting} ${nightsWaiting === 1 ? 'night' : 'nights'} waiting · Tap to open`
            : 'Book a night out to get started'}
        </div>

        {/* Dev seed button */}
        {process.env.NODE_ENV === 'development' && (
          <button
            onClick={seedTestBooking}
            disabled={seeding}
            style={{
              marginTop: 12, padding: '6px 14px', borderRadius: 8, border: '1px solid #E8E2D8',
              background: '#F0EDE8', fontSize: 12, fontWeight: 600, color: '#221E1A', cursor: 'pointer',
              opacity: seeding ? 0.5 : 1,
            }}>
            {seeding ? 'Adding…' : '+ Test booking'}
          </button>
        )}
      </div>

      {/* Segmented tabs — Tickets / Reviews */}
      <div style={{ padding: '4px 16px 16px' }}>
        <div style={{
          position: 'relative',
          display: 'grid', gridTemplateColumns: '1fr 1fr',
          background: '#EFE9DC', borderRadius: 999, padding: 4,
        }}>
          {/* Sliding pill indicator */}
          <div style={{
            position: 'absolute', top: 4, bottom: 4,
            left: activeTab === 'tickets' ? 4 : '50%',
            width: 'calc(50% - 4px)',
            background: '#FFFFFF', borderRadius: 999,
            boxShadow: '0 1px 4px rgba(34,30,26,0.08)',
            transition: 'left 0.25s cubic-bezier(0.4,0,0.2,1)',
          }} />
          {(['tickets', 'reviews'] as const).map(t => {
            const isActive = activeTab === t
            const label    = t === 'tickets' ? 'Tickets'  : 'Reviews'
            const count    = t === 'tickets' ? totalCount : pendingSurveys.length
            return (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                style={{
                  position: 'relative', zIndex: 1,
                  padding: '10px 0', background: 'none', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  fontSize: 13, fontWeight: 600,
                  color: isActive ? '#221E1A' : '#9F9486',
                  fontFamily: 'Geist, -apple-system, system-ui, sans-serif',
                  transition: 'color 0.2s',
                }}
              >
                {label}
                {count > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, lineHeight: 1,
                    padding: '3px 7px', borderRadius: 99, minWidth: 18, textAlign: 'center',
                    background: isActive ? '#8C2A2A' : '#D8CFB8',
                    color: isActive ? '#FFFFFF' : '#9F9486',
                    transition: 'background 0.2s, color 0.2s',
                  }}>{count}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Main content */}
      <div style={{ padding: '0 16px' }}>

        {/* Loading */}
        {loading && (
          <div>
            {[0, 1].map(i => (
              <div key={i} style={{
                height: 200, borderRadius: 16, background: '#EDE9E0',
                marginBottom: 16, animation: 'pulse 1.5s infinite',
              }} />
            ))}
          </div>
        )}

        {/* ─── REVIEWS TAB ─── */}
        {!loading && activeTab === 'reviews' && (
          pendingSurveys.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px 0', color: '#9F9486' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 40, marginBottom: 12, color: '#9F9486' }}>star</span>
              <div style={{
                fontFamily: '"Instrument Serif", Georgia, serif',
                fontStyle: 'italic', fontSize: 24, color: '#221E1A', marginBottom: 8,
              }}>Nothing to review</div>
              <div style={{ fontSize: 14, color: '#9F9486', textAlign: 'center', maxWidth: 240 }}>
                After a night out we&apos;ll ask how it went
              </div>
            </div>
          ) : (
            <div>
              {pendingSurveys.map((s, idx) => {
                const n = String(idx + 1).padStart(2, '0')
                return (
                  <div key={s.id} style={{
                    position: 'relative',
                    background: '#F4EFE3',
                    borderRadius: 18,
                    padding: '20px 22px 18px',
                    marginBottom: 14,
                    overflow: 'hidden',
                  }}>
                    {/* Halftone dot field over the whole card (very faint) */}
                    <div style={{
                      position: 'absolute', inset: 0, opacity: 0.35, pointerEvents: 'none',
                      backgroundImage: 'radial-gradient(rgba(34,30,26,0.10) 1px, transparent 1.4px)',
                      backgroundSize: '8px 8px',
                    }} />

                    {/* Top row: kicker + time */}
                    <div style={{
                      position: 'relative',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      marginBottom: 14,
                      fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase',
                      color: '#9F9486', fontWeight: 600,
                    }}>
                      <span>N° {n} · Questions</span>
                      <span>2 min</span>
                    </div>

                    {/* Body */}
                    <div style={{ position: 'relative', display: 'flex', gap: 18, alignItems: 'flex-start' }}>
                      {/* Medallion */}
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        <div style={{
                          width: 92, height: 92, borderRadius: '50%',
                          background: 'radial-gradient(circle at 30% 30%, #6E1F1F 0%, #2A0E0E 100%)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          position: 'relative', overflow: 'hidden',
                        }}>
                          {/* Halftone dots on medallion */}
                          <div style={{
                            position: 'absolute', inset: 0, opacity: 0.18,
                            backgroundImage: 'radial-gradient(rgba(255,255,255,1) 1px, transparent 1.4px)',
                            backgroundSize: '5px 5px',
                          }} />
                          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#E8C77A" strokeWidth="1.4" style={{ position: 'relative' }}>
                            <polygon points="12,2 14.9,8.6 22,9.3 16.5,14.2 18.2,21 12,17.3 5.8,21 7.5,14.2 2,9.3 9.1,8.6" strokeLinejoin="round" />
                          </svg>
                        </div>
                        {/* "N° 05" pill on the medallion */}
                        <div style={{
                          position: 'absolute', bottom: -2, right: -4,
                          background: '#FFFFFF', borderRadius: 999,
                          padding: '2px 8px',
                          fontSize: 9, letterSpacing: '0.12em',
                          color: '#B8902C', fontWeight: 700,
                          boxShadow: '0 1px 4px rgba(34,30,26,0.08)',
                        }}>N° {n}</div>
                      </div>

                      {/* Text block */}
                      <div style={{ flex: 1, paddingTop: 2 }}>
                        <div style={{
                          fontSize: 9.5, letterSpacing: '0.18em', textTransform: 'uppercase',
                          color: '#9F9486', fontWeight: 600, marginBottom: 4,
                        }}>Recensione · Last Night</div>

                        <h2 style={{
                          fontFamily: '"Instrument Serif", Georgia, serif',
                          fontStyle: 'italic', fontWeight: 400,
                          fontSize: 28, lineHeight: 1.05,
                          color: '#221E1A', margin: '0 0 10px',
                          letterSpacing: '-0.01em',
                        }}>Com&apos;è andata?</h2>

                        <div style={{
                          fontSize: 9.5, letterSpacing: '0.18em', textTransform: 'uppercase',
                          color: '#9F9486', fontWeight: 600,
                        }}>How was</div>
                        <div style={{ fontSize: 17, fontWeight: 600, color: '#221E1A', marginBottom: 12 }}>
                          {s.clubs?.name ?? 'last night'}
                        </div>

                        {/* Stats row */}
                        <div style={{ display: 'flex', gap: 18, alignItems: 'baseline', flexWrap: 'wrap' }}>
                          {[
                            { num: '5',   label: 'Questions' },
                            { num: "2'",  label: 'Minutes'   },
                            { num: '+10', label: 'Fiamme'    },
                          ].map(({ num, label }) => (
                            <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                              <span style={{
                                fontFamily: '"Instrument Serif", Georgia, serif',
                                fontStyle: 'italic', fontSize: 20, fontWeight: 600, color: '#221E1A',
                              }}>{num}</span>
                              <span style={{
                                fontSize: 9.5, letterSpacing: '0.16em', textTransform: 'uppercase',
                                color: '#9F9486', fontWeight: 600,
                              }}>{label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Footer actions */}
                    <div style={{
                      position: 'relative', marginTop: 20, paddingTop: 14,
                      borderTop: '1px solid rgba(34,30,26,0.08)',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <button
                        onClick={() => setActiveSurvey(s)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                          fontSize: 17, fontWeight: 600, color: '#221E1A',
                        }}>
                        Rate it
                        <span style={{ fontSize: 18, lineHeight: 1 }}>→</span>
                      </button>
                      <button
                        onClick={() => setPendingSurveys(prev => prev.filter(p => p.id !== s.id))}
                        style={{
                          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                          fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase',
                          color: '#9F9486', fontWeight: 600,
                        }}>
                        Later
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}

        {/* ─── TICKETS TAB ─── */}
        {!loading && activeTab === 'tickets' && (
          <>

        {/* Empty state */}
        {isEmpty && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px 0', color: '#9F9486' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 40, marginBottom: 12, color: '#9F9486' }}>confirmation_number</span>
            <div style={{
              fontFamily: '"Instrument Serif", Georgia, serif',
              fontStyle: 'italic',
              fontSize: 24,
              color: '#221E1A',
              marginBottom: 8,
            }}>Nessun biglietto</div>
            <div style={{ fontSize: 14, color: '#9F9486', textAlign: 'center', maxWidth: 240 }}>
              Book a night out and it&apos;ll appear here
            </div>
          </div>
        )}

        {/* Tonight section */}
        {hasTonightItems && (
          <div style={{ marginBottom: 8 }}>
            <SectionLabel
              index="01"
              title="Tonight"
              count={tonightBookings.length + tonightSignups.length + tonightTickets.length}
            />
            {tonightSignups.map(s  => <GuestCard        key={s.id}  signup={s}  tonight />)}
            {tonightBookings.map(b => <BookingCard       key={b.id}  booking={b} tonight />)}
            {tonightTickets.map(t  => <TicketOrderCard   key={t.id}  order={t}   tonight />)}
          </div>
        )}

        {/* Upcoming section */}
        {hasUpcoming && (
          <div style={{ marginBottom: 8 }}>
            <SectionLabel
              index={hasTonightItems ? '02' : '01'}
              title="Upcoming"
              count={upcomingBookings.length + upcomingSignups.length + upcomingTickets.length}
            />
            {upcomingSignups.map(s  => <GuestCard        key={s.id}  signup={s}   />)}
            {upcomingBookings.map(b => <BookingCard       key={b.id}  booking={b}  />)}
            {upcomingTickets.map(t  => <TicketOrderCard   key={t.id}  order={t}    />)}
          </div>
        )}

        {/* Show past & cancelled toggle */}
        {hasPast && (
          <div style={{ marginBottom: 16 }}>
            <button
              onClick={() => setShowPast(p => !p)}
              style={{
                width: '100%', border: '1px solid #E8E2D8', borderRadius: 12,
                padding: '12px 16px', background: 'transparent', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.15em', color: '#9F9486' }}>
                {showPast ? 'Hide' : 'Show'} Past &amp; Cancelled
              </span>
              <span style={{ fontSize: 14, color: '#9F9486' }}>{showPast ? '↑' : '↓'}</span>
            </button>

            {showPast && (
              <div style={{ marginTop: 16 }}>
                <SectionLabel
                  index={hasTonightItems && hasUpcoming ? '03' : hasTonightItems || hasUpcoming ? '02' : '01'}
                  title="Past &amp; Cancelled"
                  count={pastBookings.length + pastSignups.length + pastTickets.length}
                />
                {pastSignups.map(s  => <GuestCard        key={s.id}  signup={s}   />)}
                {pastBookings.map(b => <BookingCard       key={b.id}  booking={b}  />)}
                {pastTickets.map(t  => <TicketOrderCard   key={t.id}  order={t}    />)}
              </div>
            )}
          </div>
        )}
          </>
        )}
      </div>

      {/* Survey sheet */}
      {activeSurvey && (
        <SurveySheet
          booking={activeSurvey}
          onDone={id => {
            setPendingSurveys(prev => prev.filter(s => s.id !== id))
            setActiveSurvey(null)
            showToast('Thanks for the feedback!', true)
          }}
          onSkip={id => {
            setPendingSurveys(prev => prev.filter(s => s.id !== id))
            setActiveSurvey(null)
          }}
        />
      )}

      <NavSpacer />

      {/* Fullscreen QR overlay */}
      {qrFullscreen && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 50,
            background: 'white', display: 'flex', flexDirection: 'column',
            overflowY: 'auto',
            WebkitTapHighlightColor: 'transparent',
          } as React.CSSProperties}>

          {/* Hero section */}
          <div style={{ position: 'relative', height: '45vh', flexShrink: 0, background: '#2A1F1A' }}>
            {qrFullscreen.coverImage && (
              <img src={qrFullscreen.coverImage} alt={qrFullscreen.clubName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            )}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.4), rgba(0,0,0,0.75))' }} />

            {/* Top bar */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 16px',
              paddingTop: 'max(16px, env(safe-area-inset-top))',
            }}>
              <button
                onClick={() => setQrFullscreen(null)}
                style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 999, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'white', fontSize: 16 }}>
                ✕
              </button>
              <span style={{ color: 'white', fontSize: 12, fontFamily: 'monospace', letterSpacing: '0.05em' }}>
                Ticket · FUO·{qrFullscreen.clubName.slice(0, 3).toUpperCase()}·{qrFullscreen.bookingId.slice(-4).toUpperCase()}
              </span>
              <button
                onClick={async () => {
                  try {
                    await navigator.share({ title: qrFullscreen.clubName, text: `My ticket for ${qrFullscreen.clubName}` })
                  } catch {}
                }}
                style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 999, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'white', fontSize: 16 }}>
                ↑
              </button>
            </div>

            {/* Bottom overlay */}
            <div style={{ position: 'absolute', bottom: 20, left: 16, right: 16 }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'rgba(255,255,255,0.7)', marginBottom: 4 }}>
                Barcelona · Nightlife
              </div>
              <div style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontStyle: 'italic', fontSize: 30, color: 'white', lineHeight: 1.2 }}>
                {qrFullscreen.clubName}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>
                {qrFullscreen.dateStr}
              </div>
            </div>
          </div>

          {/* Scrollable white content */}
          <div style={{ flex: 1, padding: 24 }}>
            {/* Show at door header */}
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.18em', color: '#9F9486' }}>
                Show this at the door
              </div>
            </div>

            {/* QR box */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 20 }}>
              <div style={{
                width: 200, height: 200,
                border: '1px solid #E8E2D8',
                borderRadius: 16,
                padding: 16,
                background: 'white',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <QRPattern size={168} />
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: 14, color: '#221E1A', marginTop: 10, letterSpacing: '0.08em' }}>
                FUO·{qrFullscreen.clubName.slice(0, 3).toUpperCase()}·{qrFullscreen.bookingId.slice(-4).toUpperCase()}
              </div>
              <div style={{ fontSize: 10, color: '#9F9486', marginTop: 4 }}>
                Brightness adjusts automatically
              </div>
            </div>

            {/* Fact strip */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr',
              gap: 8, padding: '16px 0', borderTop: '1px solid #E8E2D8', borderBottom: '1px solid #E8E2D8',
              marginBottom: 20,
            }}>
              {[
                { label: 'Date', value: qrFullscreen.dateStr.split(', ')[1] ?? qrFullscreen.dateStr },
                { label: 'Doors', value: '23:00' },
                { label: 'Guests', value: String(qrFullscreen.partySize ?? '—') },
                { label: 'Type', value: qrFullscreen.bookingType ?? 'General' },
              ].map(({ label, value }) => (
                <div key={label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9F9486', marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#221E1A', textTransform: 'capitalize' }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Receipt */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.15em', color: '#9F9486', marginBottom: 12 }}>Receipt</div>
              {[
                { label: `Ticket × ${qrFullscreen.partySize ?? 1}`, value: `€${((qrFullscreen.total ?? 0) * 0.9).toFixed(2)}` },
                { label: 'Service fee (10%)', value: `€${((qrFullscreen.total ?? 0) * 0.1).toFixed(2)}` },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 14, color: '#221E1A' }}>
                  <span>{label}</span>
                  <span>{value}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid #E8E2D8', fontWeight: 600, fontSize: 15, color: '#221E1A' }}>
                <span>Total</span>
                <span style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontStyle: 'italic', fontSize: 18 }}>
                  €{(qrFullscreen.total ?? 0).toFixed(2)}
                </span>
              </div>
            </div>

            {/* Manage section */}
            <div>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.15em', color: '#9F9486', marginBottom: 12 }}>Manage</div>
              {[
                { icon: 'calendar_month', label: 'Add to Calendar', action: () => {} },
                { icon: 'account_balance_wallet', label: 'Add to Wallet', action: () => addToWallet(`/api/bookings/${qrFullscreen.bookingId}/wallet`) },
                { icon: 'ios_share', label: 'Share', action: async () => { try { await navigator.share({ title: qrFullscreen.clubName }) } catch {} } },
              ].map(({ icon, label, action }) => (
                <button key={label} onClick={action} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 0', width: '100%', background: 'none', border: 'none', borderBottom: '1px solid #F0EDE8', cursor: 'pointer', color: '#221E1A' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 22, width: 28, textAlign: 'center', fontVariationSettings: "'FILL' 0, 'wght' 300" }}>{icon}</span>
                  <span style={{ fontSize: 14 }}>{label}</span>
                </button>
              ))}
              {/* Cancel ticket — separated */}
              <button
                onClick={() => {
                  setQrFullscreen(null)
                  setConfirmId(qrFullscreen.bookingId)
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '14px 0', width: '100%',
                  background: 'none', border: 'none',
                  borderTop: '1px solid #E8E2D8',
                  cursor: 'pointer', color: '#8C2A2A',
                  marginTop: 4,
                }}>
                <span className="material-symbols-outlined" style={{ fontSize: 22, width: 28, textAlign: 'center', fontVariationSettings: "'FILL' 0, 'wght' 300" }}>delete</span>
                <span style={{ fontSize: 14, fontWeight: 500 }}>Cancel ticket</span>
              </button>
            </div>
          </div>
          <NavSpacer />
        </div>
      )}
    </div>
  )
}
