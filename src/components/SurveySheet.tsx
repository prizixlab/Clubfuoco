'use client'

import { useState, useRef } from 'react'

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

// ─── Drink categories ─────────────────────────────────────────────────────────

const DRINK_OPTIONS = [
  { id: 'beer',       label: 'Beer',              icon: '🍺' },
  { id: 'wine',       label: 'Wine',              icon: '🍷' },
  { id: 'cocktails',  label: 'Cocktails',         icon: '🍸' },
  { id: 'spirits',    label: 'Spirits',           icon: '🥃' },
  { id: 'shots',      label: 'Shots',             icon: '🥂' },
  { id: 'champagne',  label: 'Champagne / Prosecco', icon: '🍾' },
  { id: 'soft',       label: 'Soft Drinks',       icon: '🥤' },
  { id: 'water',      label: 'Water',             icon: '💧' },
  { id: 'other',      label: 'Other',             icon: '✏️' },
]

const DRINK_KINDS: Record<string, string[]> = {
  beer: [
    'Lager', 'Pilsner', 'IPA', 'Pale Ale', 'Craft', 'Stout',
    'Wheat Beer', 'Corona', 'Heineken', 'Peroni', 'Moretti',
  ],
  wine: [
    'Red', 'White', 'Rosé', 'Sparkling', 'Pinot Noir', 'Cabernet',
    'Merlot', 'Prosecco', 'Chardonnay', 'Sauvignon Blanc',
  ],
  cocktails: [
    'Negroni', 'Aperol Spritz', 'Gin & Tonic', 'Mojito', 'Margarita',
    'Vodka Soda', 'Cosmopolitan', 'Old Fashioned', 'Espresso Martini',
    'Moscow Mule', 'Daiquiri', 'Whiskey Sour', 'Long Island Iced Tea',
    'Americano', 'Bellini', 'Hugo', 'Frozen', 'Signature',
  ],
  spirits: [
    'Gin', 'Vodka', 'Rum', 'Whiskey', 'Tequila', 'Mezcal',
    'Brandy', 'Cognac', 'Amaretto', 'Baileys', 'Limoncello',
  ],
  shots: [
    'Tequila', 'Vodka', 'Sambuca', 'Jägermeister', 'Whiskey',
    'Rum', 'Limoncello', 'Baby Guinness', 'Fireball', 'Grappa',
  ],
  champagne: [
    'Champagne', 'Prosecco', 'Cava', 'Franciacorta', 'Rosé Champagne',
  ],
  soft: [
    'Coke', 'Diet Coke', 'Sprite', 'Juice', 'Energy Drink',
    'Tonic Water', 'Soda Water', 'Lemonade', 'Iced Tea', 'Ginger Beer',
  ],
  water: ['Still', 'Sparkling'],
  other: [], // free-text input
}

// ─── Return options ───────────────────────────────────────────────────────────

const RETURN_OPTIONS = [
  { id: 'yes',   label: '100%'        },
  { id: 'maybe', label: 'Maybe'       },
  { id: 'no',    label: 'Never again' },
]

// ─── Stars ────────────────────────────────────────────────────────────────────

function Stars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-sm">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} onClick={() => onChange(n)}
          className="active:scale-90 transition-transform leading-none">
          <span className="material-symbols-outlined" style={{
            fontSize: 32,
            color: n <= value ? '#8C2A2A' : '#C8BFB2',
            fontVariationSettings: n <= value ? "'FILL' 1" : "'FILL' 0",
          }}>star</span>
        </button>
      ))}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SurveySheet({ booking, onDone, onSkip }: Props) {
  const [step,         setStep]        = useState(0)
  const [rating,       setRating]      = useState(0)
  const [drinks,       setDrinks]      = useState<string[]>([])
  const [drinkKinds,   setDrinkKinds]  = useState<Record<string, string[]>>({})
  const [focusedDrink, setFocusedDrink] = useState<string | null>(null)
  const [otherText,    setOtherText]   = useState('')
  const [vibeRating,   setVibeRating]  = useState(0)
  const [crowdRating,  setCrowdRating] = useState(0)
  const [wouldReturn,  setWouldReturn] = useState<'yes' | 'maybe' | 'no' | null>(null)
  const [submitting,   setSubmitting]  = useState(false)
  const otherInputRef = useRef<HTMLInputElement>(null)

  const clubName = booking.clubs?.name ?? 'the venue'

  function toggleDrink(id: string) {
    setDrinks(prev => {
      if (prev.includes(id)) {
        setDrinkKinds(k => { const n = { ...k }; delete n[id]; return n })
        if (id === 'other') setOtherText('')
        setFocusedDrink(f => f === id ? null : f)
        return prev.filter(d => d !== id)
      }
      // Expanding: focus this drink's sub-kinds (or Other input)
      if (id === 'other') {
        setFocusedDrink('other')
        setTimeout(() => otherInputRef.current?.focus(), 80)
      } else if (DRINK_KINDS[id]?.length) {
        setFocusedDrink(id)
      }
      return [...prev, id]
    })
  }

  function toggleKind(drinkId: string, kind: string) {
    setDrinkKinds(prev => {
      const cur = prev[drinkId] ?? []
      return {
        ...prev,
        [drinkId]: cur.includes(kind) ? cur.filter(k => k !== kind) : [...cur, kind],
      }
    })
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
        drink_kinds:  drinkKinds,
        other_drinks: otherText.trim(),
        vibe_rating:  vibeRating,
        crowd_rating: crowdRating,
        would_return: wouldReturn,
      }),
    })
    setSubmitting(false)
    onDone(booking.id)
  }

  const questions = [
    // ── Q1: Overall rating ────────────────────────────────────────────────────
    <div key="q1" className="flex flex-col items-center text-center gap-lg">
      <span className="material-symbols-outlined" style={{ fontSize: 56, color: '#8C2A2A', fontVariationSettings: "'FILL' 1" }}>star</span>
      <div>
        <p className="font-h2 text-h2 text-on-surface mb-xs">How was {clubName}?</p>
        <p className="font-body-md text-on-surface-variant text-sm">Overall rating</p>
      </div>
      <Stars value={rating} onChange={setRating} />
      <div className="flex justify-between w-full px-xs text-[11px] text-on-surface-variant/50 uppercase tracking-widest">
        <span>Terrible</span><span>Amazing</span>
      </div>
    </div>,

    // ── Q2: Drinks ────────────────────────────────────────────────────────────
    <div key="q2" className="flex flex-col items-start gap-md w-full">
      <div className="w-full text-center">
        <span className="material-symbols-outlined" style={{ fontSize: 48, color: '#8C2A2A' }}>local_bar</span>
        <p className="font-h2 text-h2 text-on-surface mt-xs mb-[2px]">What were you drinking?</p>
        <p className="font-body-md text-on-surface-variant text-sm">Pick all that apply</p>
      </div>

      {/* Category grid */}
      <div className="grid grid-cols-3 gap-xs w-full">
        {DRINK_OPTIONS.map(d => {
          const selected = drinks.includes(d.id)
          const isFocused = focusedDrink === d.id
          return (
            <button key={d.id}
              onClick={() => toggleDrink(d.id)}
              className={`flex flex-col items-center justify-center gap-[3px] py-sm px-xs rounded-xl text-[11px] font-semibold border transition-all active:scale-95
                ${selected
                  ? 'bg-primary-container border-primary-container text-on-primary-container'
                  : 'bg-surface-container border-outline-variant/30 text-on-surface-variant'
                }
                ${isFocused ? 'ring-1 ring-primary/50' : ''}
              `}
              style={{ minHeight: 56 }}
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>{d.icon}</span>
              <span style={{ fontSize: 10, letterSpacing: '0.3px', textAlign: 'center', lineHeight: 1.2 }}>{d.label}</span>
            </button>
          )
        })}
      </div>

      {/* Sub-kind picker — shown when a category with options is focused */}
      {focusedDrink && focusedDrink !== 'other' && DRINK_KINDS[focusedDrink]?.length > 0 && drinks.includes(focusedDrink) && (
        <div className="w-full">
          <p className="text-[10px] text-on-surface-variant/50 uppercase tracking-widest mb-[6px]">
            What kind of {DRINK_OPTIONS.find(d => d.id === focusedDrink)?.label.toLowerCase()}?
          </p>
          <div className="flex flex-wrap gap-xs">
            {DRINK_KINDS[focusedDrink].map(kind => {
              const selected = (drinkKinds[focusedDrink] ?? []).includes(kind)
              return (
                <button key={kind}
                  onClick={() => toggleKind(focusedDrink, kind)}
                  className={`px-sm py-[5px] rounded-full text-[11px] border transition-all active:scale-95
                    ${selected
                      ? 'bg-primary-container border-primary-container text-on-primary-container font-semibold'
                      : 'bg-surface-container border-outline-variant/30 text-on-surface-variant'
                    }`}>
                  {kind}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Other — free-text input */}
      {drinks.includes('other') && (
        <div className="w-full">
          <p className="text-[10px] text-on-surface-variant/50 uppercase tracking-widest mb-[6px]">
            What did you have?
          </p>
          <input
            ref={otherInputRef}
            type="text"
            value={otherText}
            onChange={e => setOtherText(e.target.value)}
            placeholder="e.g. Aperol Spritz, house wine…"
            className="w-full bg-surface-container border border-outline-variant/30 rounded-xl px-md py-sm text-sm text-on-surface placeholder:text-on-surface-variant/40 outline-none focus:border-primary/50"
          />
        </div>
      )}

      {/* Tap another to see its kinds */}
      {drinks.length > 0 && focusedDrink && focusedDrink !== 'other' && (
        <div className="flex flex-wrap gap-xs w-full">
          {drinks.filter(d => d !== 'other' && DRINK_KINDS[d]?.length > 0 && d !== focusedDrink).map(d => (
            <button key={d}
              onClick={() => setFocusedDrink(d)}
              className="px-sm py-[5px] rounded-full text-[11px] border border-outline-variant/30 bg-surface-container text-on-surface-variant active:scale-95">
              {DRINK_OPTIONS.find(o => o.id === d)?.label} →
            </button>
          ))}
        </div>
      )}
    </div>,

    // ── Q3: Music / vibe ──────────────────────────────────────────────────────
    <div key="q3" className="flex flex-col items-center text-center gap-lg">
      <span className="material-symbols-outlined" style={{ fontSize: 56, color: '#8C2A2A' }}>music_note</span>
      <div>
        <p className="font-h2 text-h2 text-on-surface mb-xs">How was the music?</p>
        <p className="font-body-md text-on-surface-variant text-sm">Vibe &amp; energy</p>
      </div>
      <Stars value={vibeRating} onChange={setVibeRating} />
      <div className="flex justify-between w-full px-xs text-[11px] text-on-surface-variant/50 uppercase tracking-widest">
        <span>Dead</span><span>Electric</span>
      </div>
    </div>,

    // ── Q4: Crowd ─────────────────────────────────────────────────────────────
    <div key="q4" className="flex flex-col items-center text-center gap-lg">
      <span className="material-symbols-outlined" style={{ fontSize: 56, color: '#8C2A2A' }}>group</span>
      <div>
        <p className="font-h2 text-h2 text-on-surface mb-xs">How was the crowd?</p>
        <p className="font-body-md text-on-surface-variant text-sm">People &amp; atmosphere</p>
      </div>
      <Stars value={crowdRating} onChange={setCrowdRating} />
      <div className="flex justify-between w-full px-xs text-[11px] text-on-surface-variant/50 uppercase tracking-widest">
        <span>Empty / bad</span><span>Packed &amp; great</span>
      </div>
    </div>,

    // ── Q5: Would return ──────────────────────────────────────────────────────
    <div key="q5" className="flex flex-col items-center text-center gap-lg">
      <span className="material-symbols-outlined" style={{ fontSize: 56, color: '#8C2A2A' }}>replay</span>
      <div>
        <p className="font-h2 text-h2 text-on-surface mb-xs">Would you go back?</p>
        <p className="font-body-md text-on-surface-variant text-sm">Be honest</p>
      </div>
      <div className="flex flex-col gap-sm w-full">
        {RETURN_OPTIONS.map(opt => (
          <button key={opt.id}
            onClick={() => setWouldReturn(opt.id as 'yes' | 'maybe' | 'no')}
            className={`py-md rounded-xl font-semibold text-base border transition-all active:scale-95
              ${wouldReturn === opt.id
                ? 'bg-primary-container border-primary-container text-on-primary-container'
                : 'bg-surface-container border-outline-variant/30 text-on-surface-variant'
              }`}>
            {opt.label}
          </button>
        ))}
      </div>
    </div>,
  ]

  const isLast = step === questions.length - 1

  return (
    <div className="fixed inset-0 z-[60] flex flex-col" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}>
      {/* Sheet panel — flex column, never itself scrolls */}
      <div className="mt-auto bg-surface-container-low rounded-t-3xl flex flex-col"
        style={{ maxHeight: '92dvh' }}>

        {/* Header — progress dots + skip (never scrolls) */}
        <div className="flex items-center justify-between px-lg pt-lg pb-sm flex-shrink-0">
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

        {/* Question — only this area scrolls when content overflows */}
        <div className="flex-1 overflow-y-auto px-lg py-sm">
          {questions[step]}
        </div>

        {/* Next / Submit — always visible at bottom of sheet */}
        <div className="px-lg pb-[calc(env(safe-area-inset-bottom,0px)+16px)] pt-sm flex-shrink-0">
          <button
            onClick={isLast ? submit : () => setStep(s => s + 1)}
            disabled={!canNext || submitting}
            className="w-full py-md bg-primary-container text-on-primary-container font-h2 rounded-xl ignite-glow active:scale-95 transition-transform disabled:opacity-40">
            {submitting ? 'Sending…' : isLast ? 'Submit' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
