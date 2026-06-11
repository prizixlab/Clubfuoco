'use client'
import { apiFetch } from '@/lib/api'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { Club, OrderSummary, FriendUser } from '@/types'
import { PaymentForm } from '@/components/ui/PaymentForm'
import { DrumPicker } from '@/components/ui/DrumPicker'
import { usePlan } from '@/contexts/PlanContext'
import { useLocale } from '@/contexts/LocaleContext'
import { buildDayOptions, formatPlan } from '@/lib/plan'

type TicketType = 'entry' | 'vip'

export default function BookPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { plan, setDate } = usePlan()
  const { locale, t } = useLocale()

  const days = buildDayOptions(locale)

  const [club, setClub] = useState<Club | null>(null)
  const [ticketType, setTicketType] = useState<TicketType>('entry')
  const [guests, setGuests] = useState(2)
  const [summary, setSummary] = useState<OrderSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [bookingLoading, setBookingLoading] = useState(false)
  const [error, setError] = useState('')

  // ── Group mode ──
  const [mode, setMode] = useState<'solo' | 'group'>('solo')
  const [friends, setFriends] = useState<FriendUser[]>([])
  const [picks, setPicks] = useState<Record<string, 'pays' | 'guest'>>({})
  const [organizerPays, setOrganizerPays] = useState(true)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetch(`/api/clubs/${id}`).then(r => r.json()).then(d => setClub(d.data))
  }, [id])

  useEffect(() => {
    apiFetch('/api/friends')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.data) setFriends(d.data.friends ?? []) })
      .catch(() => {})
  }, [])

  function togglePick(userId: string) {
    setPicks(prev => {
      const next = { ...prev }
      if (next[userId]) delete next[userId]
      else next[userId] = 'pays'
      return next
    })
  }

  async function createGroup() {
    setCreating(true)
    setError('')
    try {
      const members = Object.entries(picks).map(([user_id, kind]) => ({ user_id, payment_required: kind === 'pays' }))
      const res = await apiFetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          club_id: id,
          booking_type: ticketType === 'entry' ? 'general' : 'vip',
          booking_date: plan.date,
          organizer_pays: organizerPays,
          members,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not create group')
      router.push(`/groups/placeholder?id=${data.data.id}`)
    } catch (e: any) {
      setError(e.message)
      setCreating(false)
    }
  }

  const selectedCount = Object.keys(picks).length

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
      const res = await apiFetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          club_id: id,
          booking_type: ticketType === 'entry' ? 'general' : 'vip',
          party_size: guests,
          booking_date: plan.date,
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

        {/* Solo / Group toggle */}
        <div className="flex p-xs glass-card rounded-xl gap-xs">
          {([['solo', 'Just me', 'person'], ['group', 'With friends', 'group']] as const).map(([m, label, icon]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 flex items-center justify-center gap-xs py-sm rounded-lg transition-all ${
                mode === m ? 'bg-primary-container/20 ring-1 ring-primary-container' : ''
              }`}
            >
              <span className={`material-symbols-outlined text-[18px] ${mode === m ? 'text-primary' : 'text-on-surface-variant'}`}>{icon}</span>
              <span className={`font-label-sm text-label-sm uppercase tracking-widest ${mode === m ? 'text-primary' : 'text-on-surface-variant'}`}>{label}</span>
            </button>
          ))}
        </div>

        {/* Config form */}
        <div className="glass-card p-md rounded-xl space-y-gutter">
          {/* Date */}
          <div className="space-y-xs">
            <div className="flex items-center justify-between">
              <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">
                {t('plan.selectDate')}
              </label>
              <span className="font-body-md text-primary">{formatPlan(plan, locale)}</span>
            </div>
            <DrumPicker
              theme="dark"
              label={t('plan.day')}
              values={days.map(d => d.value)}
              labels={days.map(d => d.label)}
              selected={plan.date}
              onSelect={setDate}
            />
          </div>

          {/* Guest count — solo only */}
          {mode === 'solo' && (
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
          )}
        </div>

        {/* Order summary — solo only */}
        {mode === 'solo' && summary && (
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

        {/* Payment — solo only */}
        {mode === 'solo' && summary && (
          <PaymentForm
            totalLabel={`€${summary.total.toFixed(2)}`}
            onPay={handleBook}
            loading={bookingLoading}
          />
        )}

        {/* ── Group: pick friends + who pays ── */}
        {mode === 'group' && (
          <>
            <div className="glass-card p-md rounded-xl space-y-sm">
              <h3 className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">
                Invite friends
              </h3>

              {friends.length === 0 ? (
                <p className="font-body-md text-on-surface-variant py-sm">
                  No friends yet. Add people from the <span className="text-primary">You → Friends</span> tab,
                  then invite them here. You can still create the group and share the invite link.
                </p>
              ) : (
                <div className="space-y-xs">
                  {friends.map(f => {
                    const picked = picks[f.id]
                    return (
                      <div key={f.id} className="flex items-center gap-sm py-xs">
                        <button onClick={() => togglePick(f.id)} className="flex items-center gap-sm flex-1 min-w-0">
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center border ${picked ? 'bg-primary-container border-primary-container' : 'border-outline-variant/40'}`}>
                            {picked && <span className="material-symbols-outlined text-[15px] text-on-primary-container">check</span>}
                          </span>
                          <span className="w-9 h-9 rounded-full bg-primary-container/15 flex items-center justify-center flex-shrink-0">
                            <span className="font-body-sm text-primary">{(f.full_name ?? '?').slice(0, 1).toUpperCase()}</span>
                          </span>
                          <span className="font-body-md text-on-surface truncate text-left">{f.full_name ?? 'Member'}</span>
                        </button>
                        {picked && (
                          <button
                            onClick={() => setPicks(p => ({ ...p, [f.id]: p[f.id] === 'pays' ? 'guest' : 'pays' }))}
                            className={`flex-shrink-0 px-sm py-xs rounded-full font-label-sm text-label-sm uppercase tracking-wider ${
                              picked === 'pays' ? 'bg-primary-container/20 text-primary border border-primary-container/50' : 'bg-surface-container text-on-surface-variant border border-outline-variant/20'
                            }`}
                          >
                            {picked === 'pays' ? 'Pays' : 'Guest'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Organizer pays toggle */}
            <button
              onClick={() => setOrganizerPays(v => !v)}
              className="glass-card p-md rounded-xl flex items-center justify-between w-full"
            >
              <div className="text-left">
                <p className="font-body-md text-on-surface">I&rsquo;ll pay for my own entry</p>
                <p className="font-label-sm text-label-sm text-on-surface-variant/60">Turn off if you&rsquo;re on someone&rsquo;s list</p>
              </div>
              <span className={`w-12 h-7 rounded-full flex items-center px-xs transition-all ${organizerPays ? 'bg-primary-container/40 justify-end' : 'bg-surface-container justify-start'}`}>
                <span className={`w-5 h-5 rounded-full ${organizerPays ? 'bg-primary' : 'bg-on-surface-variant'}`} />
              </span>
            </button>

            <p className="font-label-sm text-label-sm text-on-surface-variant/60 text-center px-sm">
              {selectedCount > 0
                ? `Inviting ${selectedCount} friend${selectedCount > 1 ? 's' : ''} · everyone pays their own marked share when they join`
                : 'Create the group, then invite friends in-app or share the link'}
            </p>

            <button
              onClick={createGroup}
              disabled={creating}
              className="w-full py-md rounded-xl bg-primary text-on-primary font-label-md uppercase tracking-widest flex items-center justify-center gap-xs active:scale-[0.99] transition-all disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create group & continue'}
              {!creating && <span className="material-symbols-outlined text-[20px]">arrow_forward</span>}
            </button>
          </>
        )}
      </main>
    </div>
  )
}
