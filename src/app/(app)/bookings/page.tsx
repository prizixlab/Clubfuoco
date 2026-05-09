'use client'

import { useEffect, useRef, useState } from 'react'
import type { Booking } from '@/types'
import SurveySheet from '@/components/SurveySheet'

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
  // Madrid local time now
  const nowMadrid = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' }))
  const cutoff    = new Date(y, m - 1, d, 22, 59, 0)
  return nowMadrid >= cutoff
}

export default function BookingsPage() {
  const [bookings,      setBookings]      = useState<Booking[]>([])
  const [guestSignups,  setGuestSignups]  = useState<GuestSignup[]>([])
  const [ticketOrders,  setTicketOrders]  = useState<TicketOrder[]>([])
  const [loading,       setLoading]       = useState(true)
  const [showPast,     setShowPast]     = useState(false)
  const [cancelling,   setCancelling]   = useState<string | null>(null)
  const [seeding,      setSeeding]      = useState(false)
  const [qrFullscreen,   setQrFullscreen]   = useState<{ bookingId: string; clubName: string; dateStr: string } | null>(null)
  const [pendingSurveys, setPendingSurveys] = useState<PendingBooking[]>([])
  const [activeSurvey,   setActiveSurvey]   = useState<PendingBooking | null>(null)
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
    fetch('/api/bookings')
      .then(r => r.json())
      .then(d => {
        setBookings(d.data?.bookings ?? d.data ?? [])
        setGuestSignups(d.data?.guest_signups ?? [])
        setTicketOrders(d.data?.ticket_orders ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))

    // Load pending post-visit surveys
    fetch('/api/surveys')
      .then(r => r.json())
      .then(d => setPendingSurveys(d.data ?? []))
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
      const res  = await fetch(`/api/bookings/${id}`, { method: 'DELETE' })
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
  const upcomingBookings = bookings.filter(b => {
    const d = new Date(b.booking_date)
    return d >= new Date(now.toDateString()) && b.status !== 'cancelled'
  })
  const pastBookings = bookings.filter(b => {
    const d = new Date(b.booking_date)
    return d < new Date(now.toDateString()) || b.status === 'cancelled'
  })

  const upcomingSignups = guestSignups.filter(s => {
    const gl = s.guest_lists
    return gl && new Date(gl.event_date) >= new Date(now.toDateString()) && !s.checked_in && s.status !== 'cancelled'
  })
  const pastSignups = guestSignups.filter(s => {
    const gl = s.guest_lists
    return !gl || new Date(gl.event_date) < new Date(now.toDateString()) || s.checked_in || s.status === 'cancelled'
  })

  const upcomingTickets = ticketOrders.filter(t => {
    if (t.status === 'payment_failed') return false
    if (!t.event_date) return true
    return new Date(t.event_date) >= new Date(now.toDateString())
  })
  const pastTickets = ticketOrders.filter(t => {
    if (t.status === 'payment_failed') return false
    if (!t.event_date) return false
    return new Date(t.event_date) < new Date(now.toDateString())
  })

  const hasUpcoming = upcomingBookings.length > 0 || upcomingSignups.length > 0 || upcomingTickets.length > 0
  const hasPast     = pastBookings.length > 0 || pastSignups.length > 0 || pastTickets.length > 0
  const isEmpty     = bookings.length === 0 && guestSignups.length === 0 && ticketOrders.length === 0

  function BookingCard({ booking }: { booking: Booking }) {
    const eventDate = new Date(booking.booking_date)
    const dateStr   = eventDate.toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'long',
    })
    const isPast      = eventDate < new Date(now.toDateString())
    const isCancelled = booking.status === 'cancelled'
    const isUsed      = booking.status === 'used'
    const canCancel   = !isPast && !isCancelled && !isUsed &&
                        !isCancelDeadlinePassed(booking.booking_date)
    const deadlineSoon = !isPast && !isCancelled && !isUsed &&
                         isCancelDeadlinePassed(booking.booking_date)

    return (
      <div className={`glass-card rounded-xl overflow-hidden ${isCancelled || isPast ? 'opacity-60' : 'neon-glow'}`}>
        <div className="p-md">
          <div className="flex justify-between items-start mb-sm">
            <div>
              <h3 className="font-h2 text-h2 text-on-surface">{(booking as any).clubs?.name ?? 'Club'}</h3>
              <p className="font-body-md text-on-surface-variant">{dateStr}</p>
            </div>
            <div className="flex flex-col items-end gap-xs">
              {isCancelled
                ? <span className="chip-vip">CANCELLED</span>
                : isUsed
                ? <span className="chip-default">USED</span>
                : isPast
                ? <span className="chip-default">EXPIRED</span>
                : <span className="chip-live">CONFIRMED</span>
              }
            </div>
          </div>

          <div className="flex gap-md text-on-surface-variant">
            <div className="flex items-center gap-xs">
              <span className="material-symbols-outlined text-[16px] text-primary">group</span>
              <span className="font-body-md">{booking.party_size} guests</span>
            </div>
            <div className="flex items-center gap-xs">
              <span className="material-symbols-outlined text-[16px] text-primary">confirmation_number</span>
              <span className="font-body-md capitalize">{booking.booking_type} ticket</span>
            </div>
          </div>
        </div>

        <div className="relative flex items-center px-md">
          <div className="w-6 h-6 rounded-full bg-background absolute -left-3" />
          <div className="flex-1 border-t-2 border-dashed border-outline-variant/20" />
          <div className="w-6 h-6 rounded-full bg-background absolute -right-3" />
        </div>

        <div className="p-md flex items-center justify-between">
          <div>
            <p className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mb-xs">Total Paid</p>
            <p className="font-h2 text-h2 text-primary">€{(booking.total_amount ?? 0).toFixed(2)}</p>
            {isCancelled && (
              <p className="font-body-md text-[12px] text-on-surface-variant/60 mt-xs">Refund issued (excl. service fee)</p>
            )}
          </div>

          <div className="flex flex-col items-end gap-sm">
            {booking.status === 'confirmed' && !isCancelled && (
              <div className="flex flex-col items-center gap-xs">
                <button
                  onClick={() => setQrFullscreen({
                    bookingId: booking.id,
                    clubName:  (booking as any).clubs?.name ?? 'Club',
                    dateStr,
                  })}
                  className="flex flex-col items-center active:scale-95 transition-transform">
                  <div className="w-20 h-20 bg-on-surface rounded-lg flex items-center justify-center">
                    <QRPattern size={64} />
                  </div>
                  <p className="font-label-sm text-[10px] text-on-surface-variant/50 uppercase tracking-widest mt-xs">
                    Tap to expand
                  </p>
                </button>

                {/* Add to Wallet */}
                <a
                  href={`/api/bookings/${booking.id}/wallet`}
                  className="flex items-center gap-xs bg-black border border-white/20 rounded-lg px-sm py-xs active:scale-95 transition-transform mt-xs">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                    <path d="M19.5 8H18V6c0-2.21-1.79-4-4-4h-8C3.79 2 2 3.79 2 6v13c0 1.66 1.34 3 3 3h14c1.66 0 3-1.34 3-3v-8c0-1.66-1.34-3-3-3zm-7.5 7c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm5.5-7h-9V6c0-1.1.9-2 2-2h5c1.1 0 2 .9 2 2v2z"/>
                  </svg>
                  <span className="text-white text-[11px] font-semibold">Add to Wallet</span>
                </a>
              </div>
            )}

            {/* Cancel button */}
            {canCancel && (
              confirmId === booking.id ? (
                <div className="flex flex-col items-end gap-xs">
                  <p className="text-[11px] text-on-surface-variant/70 text-right max-w-[140px]">
                    We'll refund everything except the 10% service fee.
                  </p>
                  <div className="flex gap-sm">
                    <button
                      onClick={() => setConfirmId(null)}
                      className="px-sm py-xs rounded-lg text-[12px] font-semibold bg-surface-container text-on-surface-variant active:scale-95 transition-transform">
                      Keep
                    </button>
                    <button
                      onClick={() => cancelBooking(booking.id)}
                      disabled={cancelling === booking.id}
                      className="px-sm py-xs rounded-lg text-[12px] font-semibold bg-error/20 text-error active:scale-95 transition-transform disabled:opacity-50">
                      {cancelling === booking.id ? 'Cancelling…' : 'Confirm'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmId(booking.id)}
                  className="flex items-center gap-xs text-error/70 active:scale-95 transition-transform">
                  <span className="material-symbols-outlined text-[18px]">cancel</span>
                  <span className="text-[12px] font-semibold">Cancel</span>
                </button>
              )
            )}

            {deadlineSoon && !isCancelled && !isUsed && (
              <p className="text-[11px] text-on-surface-variant/50 text-right max-w-[120px]">
                Cancellations closed for tonight
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  function GuestCard({ signup }: { signup: GuestSignup }) {
    const gl      = signup.guest_lists
    if (!gl) return null
    const dateStr = new Date(gl.event_date).toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'long',
    })
    const isPast = new Date(gl.event_date) < new Date(now.toDateString())

    return (
      <div className={`glass-card rounded-xl overflow-hidden ${signup.checked_in || isPast ? 'opacity-60' : 'neon-glow'}`}>
        <div className="p-md">
          <div className="flex justify-between items-start mb-sm">
            <div>
              <h3 className="font-h2 text-h2 text-on-surface">{gl.clubs?.name ?? 'Club'}</h3>
              <p className="font-body-md text-on-surface-variant">{gl.event_name}</p>
              <p className="font-body-md text-primary mt-xs">{dateStr}</p>
            </div>
            <div className="flex flex-col items-end gap-xs">
              {signup.checked_in
                ? <span className="chip-default">USED</span>
                : isPast
                ? <span className="chip-default">EXPIRED</span>
                : signup.status === 'cancelled'
                ? <span className="chip-vip">CANCELLED</span>
                : <span className="chip-live">CONFIRMED</span>
              }
              {signup.tier === 'vip' && <span className="chip-live text-[10px]">VIP</span>}
            </div>
          </div>

          <div className="flex gap-md text-on-surface-variant">
            <div className="flex items-center gap-xs">
              <span className="material-symbols-outlined text-[16px] text-primary">group</span>
              <span className="font-body-md">{signup.party_size} {signup.party_size === 1 ? 'guest' : 'guests'}</span>
            </div>
            <div className="flex items-center gap-xs">
              <span className="material-symbols-outlined text-[16px] text-primary">schedule</span>
              <span className="font-body-md">Before {gl.cutoff_time?.slice(0, 5)}</span>
            </div>
          </div>
        </div>

        {!signup.checked_in && !isPast && signup.status !== 'cancelled' && (
          <>
            <div className="relative flex items-center px-md">
              <div className="w-6 h-6 rounded-full bg-background absolute -left-3" />
              <div className="flex-1 border-t-2 border-dashed border-outline-variant/20" />
              <div className="w-6 h-6 rounded-full bg-background absolute -right-3" />
            </div>
            <div className="p-md flex items-center justify-between">
              <div>
                <p className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mb-xs">Entry</p>
                <p className="font-h2 text-h2 text-primary">
                  {signup.tier === 'vip' ? 'VIP' : gl.free_entry_label ?? 'Free'}
                </p>
              </div>
              <div className="flex flex-col items-center">
                <div className="w-20 h-20 bg-primary-container/20 border border-primary-container/40 rounded-lg flex items-center justify-center">
                  <span className="material-symbols-outlined text-primary text-[40px]" style={{ fontVariationSettings: `'FILL' 1` }}>
                    stars
                  </span>
                </div>
                <p className="font-label-sm text-[10px] text-on-surface-variant/50 uppercase tracking-widest mt-xs">
                  Show at door
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    )
  }

  function TicketOrderCard({ order }: { order: TicketOrder }) {
    const dateStr = order.event_date
      ? new Date(order.event_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' })
      : 'Date TBC'
    const isPast = order.event_date ? new Date(order.event_date) < new Date(now.toDateString()) : false
    const totalEur = (order.total_cents / 100).toFixed(2)

    return (
      <div className={`glass-card rounded-xl overflow-hidden ${isPast ? 'opacity-60' : 'neon-glow'}`}>
        <div className="p-md">
          <div className="flex justify-between items-start mb-sm">
            <div className="flex-1 min-w-0 pr-sm">
              <h3 className="font-h2 text-h2 text-on-surface truncate">{order.event_name}</h3>
              <p className="font-body-md text-on-surface-variant truncate">{order.venue_name}</p>
              <p className="font-body-md text-primary mt-xs">{dateStr}</p>
            </div>
            <span className={isPast ? 'chip-default' : order.status === 'paid' ? 'chip-live' : 'chip-vip'}>
              {isPast ? 'PAST' : order.status === 'paid' ? 'CONFIRMED' : 'PENDING'}
            </span>
          </div>

          <div className="flex items-center gap-xs text-on-surface-variant">
            <span className="material-symbols-outlined text-[16px] text-primary">confirmation_number</span>
            <span className="font-body-md">{order.quantity} {order.quantity === 1 ? 'ticket' : 'tickets'}</span>
          </div>
        </div>

        <div className="relative flex items-center px-md">
          <div className="w-6 h-6 rounded-full bg-background absolute -left-3" />
          <div className="flex-1 border-t-2 border-dashed border-outline-variant/20" />
          <div className="w-6 h-6 rounded-full bg-background absolute -right-3" />
        </div>

        <div className="p-md flex items-center justify-between">
          <div>
            <p className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest mb-xs">Total Paid</p>
            <p className="font-h2 text-h2 text-primary">€{totalEur}</p>
          </div>
          <div className="flex flex-col items-center">
            <div className="w-20 h-20 bg-primary/10 border border-primary/20 rounded-lg flex items-center justify-center">
              <span className="material-symbols-outlined text-primary text-[40px]" style={{ fontVariationSettings: `'FILL' 1` }}>
                local_activity
              </span>
            </div>
            <p className="font-label-sm text-[10px] text-on-surface-variant/50 uppercase tracking-widest mt-xs">
              Event ticket
            </p>
          </div>
        </div>
      </div>
    )
  }

  async function seedTestBooking() {
    setSeeding(true)
    try {
      const res  = await fetch('/api/dev/test-booking', { method: 'POST' })
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

  return (
    <div className="px-container-padding pt-base pb-8">
      <div className="flex items-center justify-between mb-md">
        <h2 className="font-h2 text-h2 text-on-surface">My Tickets</h2>
        {process.env.NODE_ENV === 'development' && (
          <button
            onClick={seedTestBooking}
            disabled={seeding}
            className="flex items-center gap-xs px-sm py-xs rounded-lg bg-surface-container text-on-surface-variant text-[12px] font-semibold border border-outline-variant/30 active:scale-95 transition-transform disabled:opacity-50">
            <span className="material-symbols-outlined text-[14px]">add</span>
            {seeding ? 'Adding…' : 'Test booking'}
          </button>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-md py-sm rounded-xl text-sm font-semibold shadow-lg transition-all
          ${toast.ok ? 'bg-primary-container text-on-primary-container' : 'bg-error-container text-on-error-container'}`}>
          {toast.msg}
        </div>
      )}

      {loading && (
        <div className="space-y-md">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="glass-card rounded-xl h-40 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && isEmpty && (
        <div className="flex flex-col items-center justify-center py-xl text-on-surface-variant">
          <span className="material-symbols-outlined text-[64px] mb-md bloom-glow text-primary">
            confirmation_number
          </span>
          <p className="font-h2 text-h2 text-on-surface mb-xs">No tickets yet</p>
          <p className="font-body-md text-on-surface-variant text-center max-w-[240px]">
            Book a night out or join a guest list and it'll appear here.
          </p>
        </div>
      )}

      {/* Post-visit survey prompts */}
      {!loading && pendingSurveys.length > 0 && (
        <div className="mb-lg space-y-sm">
          {pendingSurveys.map(s => (
            <div key={s.id}
              className="glass-card rounded-xl p-md flex items-center gap-md neon-glow border border-primary/20">
              <span className="material-symbols-outlined text-primary text-[32px] flex-shrink-0"
                style={{ fontVariationSettings: "'FILL' 1" }}>
                rate_review
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-h2 text-on-surface text-[15px]">
                  How was {s.clubs?.name ?? 'last night'}?
                </p>
                <p className="font-body-md text-on-surface-variant text-sm">
                  Quick 5-question survey
                </p>
              </div>
              <button
                onClick={() => setActiveSurvey(s)}
                className="flex-shrink-0 px-sm py-xs bg-primary-container text-on-primary-container text-[12px] font-semibold rounded-lg active:scale-95 transition-transform">
                Rate it
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Upcoming */}
      {!loading && hasUpcoming && (
        <div className="space-y-md mb-lg">
          {upcomingSignups.map(s  => <GuestCard        key={s.id}  signup={s}   />)}
          {upcomingBookings.map(b => <BookingCard       key={b.id}  booking={b}  />)}
          {upcomingTickets.map(t  => <TicketOrderCard   key={t.id}  order={t}    />)}
        </div>
      )}

      {/* Past / History toggle */}
      {!loading && hasPast && (
        <div>
          <button
            onClick={() => setShowPast(p => !p)}
            className="flex items-center gap-xs text-on-surface-variant/60 mb-sm active:opacity-70">
            <span className="font-label-sm text-label-sm uppercase tracking-widest">
              {showPast ? 'Hide' : 'Show'} Past &amp; Cancelled
            </span>
            <span className="material-symbols-outlined text-[16px]">
              {showPast ? 'expand_less' : 'expand_more'}
            </span>
          </button>

          {showPast && (
            <div className="space-y-md">
              {pastSignups.map(s  => <GuestCard        key={s.id}  signup={s}   />)}
              {pastBookings.map(b => <BookingCard       key={b.id}  booking={b}  />)}
              {pastTickets.map(t  => <TicketOrderCard   key={t.id}  order={t}    />)}
            </div>
          )}
        </div>
      )}

      {/* Survey sheet */}
      {activeSurvey && (
        <SurveySheet
          booking={activeSurvey}
          onDone={id => {
            setPendingSurveys(prev => prev.filter(s => s.id !== id))
            setActiveSurvey(null)
            showToast('Thanks for the feedback! 🔥', true)
          }}
          onSkip={id => {
            setPendingSurveys(prev => prev.filter(s => s.id !== id))
            setActiveSurvey(null)
          }}
        />
      )}

      {/* Fullscreen QR overlay */}
      {qrFullscreen && (
        <div
          onClick={() => setQrFullscreen(null)}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white"
          style={{ WebkitTapHighlightColor: 'transparent' }}>

          {/* Club name + date */}
          <p className="text-black font-bold text-xl mb-1 tracking-tight">{qrFullscreen.clubName}</p>
          <p className="text-black/50 text-sm mb-8">{qrFullscreen.dateStr}</p>

          {/* Big QR */}
          <div className="flex items-center justify-center" style={{ width: '72vw', height: '72vw', maxWidth: 320, maxHeight: 320 }}>
            <QRPattern size={Math.min(320, Math.round(window.innerWidth * 0.72))} />
          </div>

          <p className="text-black/30 text-xs mt-8 uppercase tracking-widest">Tap anywhere to close</p>
        </div>
      )}
    </div>
  )
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
        <rect key={i} x={cell*c} y={cell*r} width={cell} height={cell} fill="black" />
      ))}
    </svg>
  )
}
