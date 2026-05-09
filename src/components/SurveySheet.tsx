'use client'

import { useState } from 'react'

interface PendingBooking {
  id:          string
  booking_date: string
  clubs:       { id: string; name: string; cover_image_url: string | null } | null
}

interface Props {
  booking:  PendingBooking
  onDone:   (bookingId: string) => void
  onSkip:   (bookingId: string) => void
}

const DRINK_OPTIONS = [
  { id: 'beer',      label: '🍺 Beer'       },
  { id: 'wine',      label: '🍷 Wine'       },
  { id: 'cocktails', label: '🍹 Cocktails'  },
  { id: 'shots',     label: '🥃 Shots'      },
  { id: 'soft',      label: '🥤 Soft drinks'},
  { id: 'water',     label: '💧 Water only' },
]

const RETURN_OPTIONS = [
  { id: 'yes',   label: '100%',        emoji: '🔥' },
  { id: 'maybe', label: 'Maybe',       emoji: '🤔' },
  { id: 'no',    label: 'Never again', emoji: '💀' },
]

function Stars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-sm">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} onClick={() => onChange(n)}
          className="text-[32px] active:scale-90 transition-transform leading-none">
          {n <= value ? '⭐' : '☆'}
        </button>
      ))}
    </div>
  )
}

export default function SurveySheet({ booking, onDone, onSkip }: Props) {
  const [step,        setStep]        = useState(0)
  const [rating,      setRating]      = useState(0)
  const [drinks,      setDrinks]      = useState<string[]>([])
  const [vibeRating,  setVibeRating]  = useState(0)
  const [crowdRating, setCrowdRating] = useState(0)
  const [wouldReturn, setWouldReturn] = useState<'yes' | 'maybe' | 'no' | null>(null)
  const [submitting,  setSubmitting]  = useState(false)

  const clubName = booking.clubs?.name ?? 'the venue'

  function toggleDrink(id: string) {
    setDrinks(prev =>
      prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]
    )
  }

  const canNext = [
    rating > 0,
    drinks.length > 0,
    vibeRating > 0,
    crowdRating > 0,
    wouldReturn !== null,
  ][step]

  async function submit() {
    setSubmitting(true)
    await fetch('/api/surveys', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id:   booking.id,
        rating,
        drinks,
        vibe_rating:  vibeRating,
        crowd_rating: crowdRating,
        would_return: wouldReturn,
      }),
    })
    setSubmitting(false)
    onDone(booking.id)
  }

  const questions = [
    // Q1 — overall rating
    <div key="q1" className="flex flex-col items-center text-center gap-lg">
      <span className="text-[56px]">⭐</span>
      <div>
        <p className="font-h2 text-h2 text-on-surface mb-xs">How was {clubName}?</p>
        <p className="font-body-md text-on-surface-variant text-sm">Overall rating</p>
      </div>
      <Stars value={rating} onChange={setRating} />
      <div className="flex justify-between w-full px-xs text-[11px] text-on-surface-variant/50 uppercase tracking-widest">
        <span>Terrible</span><span>Amazing</span>
      </div>
    </div>,

    // Q2 — drinks
    <div key="q2" className="flex flex-col items-center text-center gap-lg">
      <span className="text-[56px]">🍹</span>
      <div>
        <p className="font-h2 text-h2 text-on-surface mb-xs">What were you drinking?</p>
        <p className="font-body-md text-on-surface-variant text-sm">Pick all that apply</p>
      </div>
      <div className="grid grid-cols-2 gap-sm w-full">
        {DRINK_OPTIONS.map(d => (
          <button key={d.id}
            onClick={() => toggleDrink(d.id)}
            className={`py-sm px-md rounded-xl text-sm font-semibold border transition-all active:scale-95
              ${drinks.includes(d.id)
                ? 'bg-primary-container border-primary-container text-on-primary-container'
                : 'bg-surface-container border-outline-variant/30 text-on-surface-variant'
              }`}>
            {d.label}
          </button>
        ))}
      </div>
    </div>,

    // Q3 — vibe / music
    <div key="q3" className="flex flex-col items-center text-center gap-lg">
      <span className="text-[56px]">🎵</span>
      <div>
        <p className="font-h2 text-h2 text-on-surface mb-xs">How was the music?</p>
        <p className="font-body-md text-on-surface-variant text-sm">Vibe &amp; energy</p>
      </div>
      <Stars value={vibeRating} onChange={setVibeRating} />
      <div className="flex justify-between w-full px-xs text-[11px] text-on-surface-variant/50 uppercase tracking-widest">
        <span>Dead</span><span>Electric</span>
      </div>
    </div>,

    // Q4 — crowd
    <div key="q4" className="flex flex-col items-center text-center gap-lg">
      <span className="text-[56px]">👥</span>
      <div>
        <p className="font-h2 text-h2 text-on-surface mb-xs">How was the crowd?</p>
        <p className="font-body-md text-on-surface-variant text-sm">People &amp; atmosphere</p>
      </div>
      <Stars value={crowdRating} onChange={setCrowdRating} />
      <div className="flex justify-between w-full px-xs text-[11px] text-on-surface-variant/50 uppercase tracking-widest">
        <span>Empty / bad</span><span>Packed &amp; great</span>
      </div>
    </div>,

    // Q5 — would return
    <div key="q5" className="flex flex-col items-center text-center gap-lg">
      <span className="text-[56px]">🔄</span>
      <div>
        <p className="font-h2 text-h2 text-on-surface mb-xs">Would you go back?</p>
        <p className="font-body-md text-on-surface-variant text-sm">Be honest</p>
      </div>
      <div className="flex flex-col gap-sm w-full">
        {RETURN_OPTIONS.map(opt => (
          <button key={opt.id}
            onClick={() => setWouldReturn(opt.id as any)}
            className={`py-md rounded-xl font-semibold text-base border transition-all active:scale-95 flex items-center justify-center gap-sm
              ${wouldReturn === opt.id
                ? 'bg-primary-container border-primary-container text-on-primary-container'
                : 'bg-surface-container border-outline-variant/30 text-on-surface-variant'
              }`}>
            <span>{opt.emoji}</span>
            <span>{opt.label}</span>
          </button>
        ))}
      </div>
    </div>,
  ]

  const isLast = step === questions.length - 1

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}>
      <div className="mt-auto bg-surface-container-low rounded-t-3xl px-lg pt-lg pb-8 flex flex-col gap-lg"
        style={{ maxHeight: '92dvh', overflowY: 'auto' }}>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex gap-xs">
            {questions.map((_, i) => (
              <div key={i} className={`h-1 rounded-full transition-all ${i <= step ? 'bg-primary w-6' : 'bg-outline-variant/30 w-3'}`} />
            ))}
          </div>
          <button onClick={() => onSkip(booking.id)}
            className="text-on-surface-variant/50 font-body-md text-sm active:opacity-70">
            Skip
          </button>
        </div>

        {/* Question */}
        <div className="min-h-[280px] flex items-center justify-center">
          {questions[step]}
        </div>

        {/* Nav */}
        <button
          onClick={isLast ? submit : () => setStep(s => s + 1)}
          disabled={!canNext || submitting}
          className="w-full py-md bg-primary-container text-on-primary-container font-h2 rounded-xl ignite-glow active:scale-95 transition-transform disabled:opacity-40">
          {submitting ? 'Sending…' : isLast ? 'Submit ✓' : 'Next →'}
        </button>
      </div>
    </div>
  )
}
