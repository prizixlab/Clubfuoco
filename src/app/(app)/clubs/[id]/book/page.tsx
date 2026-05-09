'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { Club, OrderSummary } from '@/types'
import { PaymentForm } from '@/components/ui/PaymentForm'

type TicketType = 'entry' | 'vip'

const AVAILABLE_DATES = [
  { label: 'Fri, 23 May', value: '2026-05-23' },
  { label: 'Sat, 24 May', value: '2026-05-24' },
  { label: 'Sun, 25 May', value: '2026-05-25' },
  { label: 'Fri, 30 May', value: '2026-05-30' },
  { label: 'Sat, 31 May', value: '2026-05-31' },
]

export default function BookPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [club, setClub] = useState<Club | null>(null)
  const [ticketType, setTicketType] = useState<TicketType>('entry')
  const [dateIdx, setDateIdx] = useState(0)
  const [guests, setGuests] = useState(2)
  const [summary, setSummary] = useState<OrderSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [bookingLoading, setBookingLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/clubs/${id}`).then(r => r.json()).then(d => setClub(d.data))
  }, [id])

  useEffect(() => {
    if (!club) return
    const unitPrice = ticketType === 'entry'
      ? (club.general_entry_price ?? 20)
      : (club.vip_table_min_spend ?? 150)
    const subtotal = unitPrice * guests
    setSummary({
      subtotal,
      discount: 0,
      total: subtotal,
      platformFee: Math.round(subtotal * 12) / 100,
    })
  }, [club, ticketType, guests, id])

  async function handleBook(paymentMethodId: string) {
    setBookingLoading(true)
    setError('')
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          club_id: id,
          booking_type: ticketType === 'entry' ? 'general' : 'vip',
          party_size: guests,
          booking_date: AVAILABLE_DATES[dateIdx].value,
          payment_method_id: paymentMethodId,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Booking failed')
      router.push('/bookings')
    } catch (e: any) {
      setError(e.message)
      setBookingLoading(false)
    }
  }

  const fmt = (euros: number) => `€${euros.toFixed(2)}`

  return (
    <div className="min-h-screen bg-background pb-8">
      {/* Header */}
      <header className="fixed top-0 w-full z-50 bg-surface/80 backdrop-blur-xl border-b border-outline-variant/20 shadow-[0_0_15px_rgba(255,76,47,0.1)] flex items-center justify-between px-container-padding h-16">
        <button onClick={() => router.back()} className="active:scale-95 duration-200">
          <span className="material-symbols-outlined text-primary">arrow_back</span>
        </button>
        <h1 className="font-display text-h2 font-extrabold text-primary tracking-[0.2em] uppercase">CLUB FUOCO</h1>
        <div className="w-8" />
      </header>

      <main className="mt-16 px-container-padding pt-base space-y-md">
        {/* Hero */}
        <div className="relative w-full h-48 rounded-xl overflow-hidden neon-glow">
          {club?.cover_image_url ? (
            <img src={club.cover_image_url} alt={club.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-surface-container-high" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-transparent to-transparent" />
          <div className="absolute bottom-base left-base">
            <span className="chip-live mb-xs inline-block">LIVE EVENT</span>
            <h2 className="font-h1 text-h1 text-on-surface">{club?.name ?? '…'}</h2>
          </div>
        </div>

        {/* Ticket type toggle */}
        <div className="grid grid-cols-2 gap-gutter">
          <button
            onClick={() => setTicketType('entry')}
            className={`flex flex-col items-center justify-center p-md glass-card rounded-xl transition-all ${
              ticketType === 'entry'
                ? 'ring-1 ring-primary-container bg-primary-container/10 border-primary-container/50'
                : 'hover:border-primary-container/30'
            }`}
          >
            <span
              className={`material-symbols-outlined mb-xs ${ticketType === 'entry' ? 'text-primary' : 'text-on-surface-variant'}`}
              style={ticketType === 'entry' ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              confirmation_number
            </span>
            <span className={`font-label-sm text-label-sm uppercase tracking-widest ${ticketType === 'entry' ? 'text-primary' : 'text-on-surface-variant'}`}>
              Entry Ticket
            </span>
          </button>

          <button
            onClick={() => setTicketType('vip')}
            className={`flex flex-col items-center justify-center p-md glass-card rounded-xl transition-all ${
              ticketType === 'vip'
                ? 'ring-1 ring-primary-container bg-primary-container/10 border-primary-container/50'
                : 'hover:border-primary-container/30'
            }`}
          >
            <span
              className={`material-symbols-outlined mb-xs ${ticketType === 'vip' ? 'text-primary' : 'text-on-surface-variant'}`}
              style={ticketType === 'vip' ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              table_bar
            </span>
            <span className={`font-label-sm text-label-sm uppercase tracking-widest ${ticketType === 'vip' ? 'text-primary' : 'text-on-surface-variant'}`}>
              VIP Table
            </span>
          </button>
        </div>

        {/* Config form */}
        <div className="glass-card p-md rounded-xl space-y-gutter">
          {/* Date */}
          <div className="space-y-xs">
            <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">
              Select Date
            </label>
            <div className="flex gap-xs overflow-x-auto no-scrollbar pb-xs">
              {AVAILABLE_DATES.map((d, i) => (
                <button
                  key={d.value}
                  onClick={() => setDateIdx(i)}
                  className={`flex-shrink-0 px-sm py-xs rounded-lg font-label-sm text-label-sm transition-all ${
                    dateIdx === i
                      ? 'bg-primary-container text-on-primary-container'
                      : 'bg-surface-container border border-outline-variant/20 text-on-surface-variant'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* Guest count */}
          <div className="space-y-xs">
            <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">
              Number of Guests
            </label>
            <div className="flex items-center justify-between py-sm">
              <span className="font-h2 text-h2 text-on-surface">
                {String(guests).padStart(2, '0')}
              </span>
              <div className="flex items-center gap-md">
                <button
                  onClick={() => setGuests(g => Math.max(1, g - 1))}
                  className="w-10 h-10 rounded-full border border-outline-variant/30 flex items-center justify-center active:scale-90 transition-all"
                >
                  <span className="material-symbols-outlined">remove</span>
                </button>
                <button
                  onClick={() => setGuests(g => Math.min(20, g + 1))}
                  className="w-10 h-10 rounded-full border border-primary-container flex items-center justify-center bg-primary-container/20 active:scale-90 transition-all"
                >
                  <span className="material-symbols-outlined text-primary">add</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Order summary */}
        {summary && (
          <div className="glass-card p-md rounded-xl space-y-sm">
            <h3 className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest border-b border-outline-variant/10 pb-xs mb-sm">
              Order Summary
            </h3>
            <div className="flex justify-between items-center">
              <span className="font-body-md text-on-surface-variant">
                {ticketType === 'entry' ? 'General Entry' : 'VIP Table'} (x{guests})
              </span>
              <span className="font-body-md text-on-surface">{fmt(summary.subtotal)}</span>
            </div>

            {summary.discount > 0 && (
              <div className="flex justify-between items-center text-primary">
                <div className="flex items-center gap-xs">
                  <span
                    className="material-symbols-outlined text-[18px]"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    workspace_premium
                  </span>
                  <span className="font-body-md">Membership Discount</span>
                </div>
                <span className="font-body-md font-bold">-{fmt(summary.discount)}</span>
              </div>
            )}

            <div className="pt-sm mt-sm border-t border-outline-variant/20 flex justify-between items-center">
              <span className="font-h2 text-h2 text-on-surface">Total</span>
              <span className="font-h2 text-h1 text-primary">{fmt(summary.total)}</span>
            </div>
          </div>
        )}

        {error && (
          <p className="font-body-md text-error text-center">{error}</p>
        )}

        {/* Payment */}
        {summary && (
          <PaymentForm
            totalLabel={`€${summary.total.toFixed(2)}`}
            onPay={handleBook}
            loading={bookingLoading}
          />
        )}
      </main>
    </div>
  )
}
