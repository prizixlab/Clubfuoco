'use client'

import { useState, useRef, useEffect } from 'react'
import { apiFetch } from '@/lib/api'
import { DRINK_CATEGORIES } from '@/lib/preferences'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PendingBooking {
  id:           string
  booking_date: string
  clubs:        { id: string; name: string; cover_image_url: string | null } | null
}

interface Props {
  booking: PendingBooking
  onDone:  (bookingId: string) => void
  onSkip:  (bookingId: string) => void
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const BG   = 'rgb(248, 245, 238)'
const RED  = 'rgb(140, 42, 42)'
const INK  = 'rgb(34, 30, 26)'
const INK2 = 'rgb(100, 90, 80)'
const BORDER = 'rgba(34,30,26,0.14)'

// ─── Drink data ───────────────────────────────────────────────────────────────

// Italian display labels for each shared category (keyed to preferences.ts).
const DRINK_LABELS: Record<string, { label: string; sub: string }> = {
  beer:          { label: 'Birra',      sub: 'BEER'          },
  wine:          { label: 'Vino',       sub: 'WINE'          },
  cocktails:     { label: 'Cocktail',   sub: 'COCKTAILS'     },
  shots:         { label: 'Spirits',    sub: 'SHOTS & SPIRITS' },
  champagne:     { label: 'Champagne',  sub: 'CHAMPAGNE'     },
  non_alcoholic: { label: 'Analcolico', sub: 'NON-ALCOHOLIC' },
  other:         { label: 'Altro',      sub: 'OTHER'         },
}

// Built from the single shared source of truth so the survey shelves always
// match the drink options in Settings.
const DRINK_ROWS = DRINK_CATEGORIES.map(c => ({
  id:    c.key,
  label: DRINK_LABELS[c.key]?.label ?? c.label,
  sub:   DRINK_LABELS[c.key]?.sub   ?? c.label.toUpperCase(),
}))

const DRINK_KINDS: Record<string, string[]> = Object.fromEntries(
  DRINK_CATEGORIES.map(c => [c.key, c.items]),
)

// ─── Music genres ─────────────────────────────────────────────────────────────

const GENRES = [
  'House', 'Techno', 'Italo Disco', 'Hip-Hop',
  'R&B', 'Reggaeton', 'Live Band', 'Jazz',
  'Afro', 'Pop', 'Indie', 'Other',
]

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepIcon({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      width: 52, height: 52, borderRadius: '50%',
      border: `1.5px solid ${RED}`,
      background: 'rgba(140,42,42,0.07)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      {children}
    </div>
  )
}

function Stars({
  value, onChange, labels,
}: {
  value: number; onChange: (v: number) => void; labels: [string, string]
}) {
  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            onClick={() => onChange(n)}
            style={{ flex: 1, background: 'none', border: 'none', padding: '8px 0', cursor: 'pointer', touchAction: 'manipulation', display: 'flex', justifyContent: 'center' }}
          >
            <svg width="34" height="34" viewBox="0 0 24 24"
              fill={n <= value ? RED : 'none'}
              stroke={n <= value ? RED : 'rgb(200,191,178)'}
              strokeWidth="1.4"
            >
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', paddingInline: 4 }}>
        <span style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: INK2 }}>{labels[0]}</span>
        <span style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: INK2 }}>{labels[1]}</span>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function SurveySheet({ booking, onDone, onSkip }: Props) {
  const [step,         setStep]        = useState(0)
  const [rating,       setRating]      = useState(0)
  // drinks: expanded category id | null; picks: category → Set of chosen items; customs: category → free text
  const [drinkOpen,    setDrinkOpen]   = useState<string | null>(null)
  const [drinkPicks,   setDrinkPicks]  = useState<Record<string, Set<string>>>({})
  const [drinkCustom,  setDrinkCustom] = useState<Record<string, string>>({})
  const [drinkRatings, setDrinkRatings] = useState<Record<string, number>>({})
  const [musicRating,  setMusicRating] = useState(0)
  const [musicGenres,  setMusicGenres] = useState<string[]>([])
  const [crowdRating,  setCrowdRating] = useState(0)
  const [wouldReturn,  setWouldReturn] = useState<'yes' | 'maybe' | 'no' | null>(null)
  const [submitting,   setSubmitting]  = useState(false)

  function toggleDrinkPick(catId: string, item: string) {
    setDrinkPicks(prev => {
      const next = { ...prev }
      const s = new Set(next[catId] ?? [])
      s.has(item) ? s.delete(item) : s.add(item)
      next[catId] = s
      return next
    })
  }

  const anyDrinkSelected = Object.values(drinkPicks).some(s => s.size > 0) ||
    Object.values(drinkCustom).some(v => v.trim().length > 0)

  // Lock body scroll while survey is open — prevents iOS rubber-band on short pages
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const TOTAL = 6

  // Collect all individual drinks selected (chips + custom text)
  const allDrinkItems: string[] = [
    ...Object.entries(drinkPicks).flatMap(([, s]) => [...s]),
    ...Object.values(drinkCustom).map(v => v.trim()).filter(Boolean),
  ]
  const allDrinkRated = allDrinkItems.length > 0 && allDrinkItems.every(d => (drinkRatings[d] ?? 0) > 0)

  const canNext = [
    rating > 0,
    anyDrinkSelected,
    allDrinkRated,
    musicRating > 0 && musicGenres.length > 0,
    crowdRating > 0,
    wouldReturn !== null,
  ][step]

  async function submit() {
    setSubmitting(true)
    await apiFetch('/api/surveys', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id:   booking.id,
        rating,
        drinks:       Object.keys(drinkPicks).filter(k => (drinkPicks[k]?.size ?? 0) > 0),
        drink_kinds:  Object.fromEntries(Object.entries(drinkPicks).filter(([,s]) => s.size > 0).map(([k,s]) => [k, [...s]])),
        drink_custom: drinkCustom,
        drink_ratings: drinkRatings,
        vibe_rating:  musicRating,
        crowd_rating: crowdRating,
        would_return: wouldReturn,
        music_genres: musicGenres,
      }),
    })
    setSubmitting(false)
    onDone(booking.id)
  }

  function next() { setStep(s => s + 1) }
  const isLast = step === TOTAL - 1

  // ── Step content ────────────────────────────────────────────────────────────

  const STEPS = [
    // Step 1 — Overall
    {
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={RED} strokeWidth="1.5">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ),
      stepLabel: 'N° 01 · La Serata',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <h2 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 40, fontWeight: 400, lineHeight: 1.05, color: INK, margin: '0 0 10px' }}>
              How was <em>the night?</em>
            </h2>
            <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 14, color: INK2, margin: 0 }}>
              Your honest rating helps the next person find the right room.
            </p>
          </div>
          <Stars value={rating} onChange={setRating} labels={['Terrible', 'Amazing']} />
        </div>
      ),
    },

    // Step 2 — Drinks
    {
      icon: (
        <svg width="20" height="22" viewBox="0 0 24 24" fill="none" stroke={RED} strokeWidth="1.5">
          <path d="M8 22h8M12 11v11M5 2h14l-2 9a5 5 0 01-10 0L5 2z" />
        </svg>
      ),
      stepLabel: 'N° 02 · Il Bere',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <h2 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 40, fontWeight: 400, lineHeight: 1.05, color: INK, margin: '0 0 10px' }}>
              What did you <em>drink?</em>
            </h2>
            <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 14, color: INK2, margin: 0 }}>
              Tap a category to expand it — pick as many as you like.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {DRINK_ROWS.map(row => {
              const isOpen  = drinkOpen === row.id
              const picks   = drinkPicks[row.id] ?? new Set<string>()
              const hasPick = picks.size > 0 || (drinkCustom[row.id] ?? '').trim().length > 0
              return (
                <div
                  key={row.id}
                  style={{
                    border: `1.5px solid ${hasPick ? RED : isOpen ? 'rgba(140,42,42,0.4)' : BORDER}`,
                    borderRadius: 14,
                    overflow: 'hidden',
                    background: hasPick ? 'rgba(140,42,42,0.04)' : 'transparent',
                  }}
                >
                  {/* Header row — tap to expand/collapse */}
                  <button
                    onClick={() => setDrinkOpen(isOpen ? null : row.id)}
                    style={{
                      width: '100%', background: 'none', border: 'none',
                      padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12,
                      cursor: 'pointer', touchAction: 'manipulation',
                    }}
                  >
                    {/* Checkbox circle */}
                    <div style={{
                      width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                      border: `2px solid ${hasPick ? RED : BORDER}`,
                      background: hasPick ? RED : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {hasPick && (
                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                          <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                    <div style={{ flex: 1, textAlign: 'left' }}>
                      <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: 'italic', fontSize: 20, color: INK }}>{row.label}</span>
                      <span style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: INK2, marginLeft: 8 }}>{row.sub}</span>
                      {hasPick && (
                        <span style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 10, color: RED, marginLeft: 8 }}>
                          {[...picks].join(', ')}{picks.size > 0 && drinkCustom[row.id]?.trim() ? ', ' : ''}{drinkCustom[row.id]?.trim()}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 16, color: INK2, transition: 'transform 0.2s', display: 'inline-block', transform: isOpen ? 'rotate(180deg)' : 'none' }}>⌄</span>
                  </button>

                  {/* Expanded picker */}
                  {isOpen && (
                    <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {/* Chip grid */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {DRINK_KINDS[row.id]?.map(item => {
                          const sel = picks.has(item)
                          return (
                            <button
                              key={item}
                              onClick={() => toggleDrinkPick(row.id, item)}
                              style={{
                                padding: '6px 14px',
                                borderRadius: 20,
                                border: `1.5px solid ${sel ? RED : BORDER}`,
                                background: sel ? RED : 'transparent',
                                color: sel ? BG : INK,
                                fontFamily: 'Geist, -apple-system, system-ui, sans-serif',
                                fontSize: 12, fontWeight: sel ? 600 : 400,
                                cursor: 'pointer', touchAction: 'manipulation',
                                transition: 'all 0.15s',
                              }}
                            >
                              {item}
                            </button>
                          )
                        })}
                      </div>

                      {/* Custom text field */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                        <span style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 11, color: INK2, flexShrink: 0 }}>Other:</span>
                        <input
                          type="text"
                          placeholder="Type your drink…"
                          value={drinkCustom[row.id] ?? ''}
                          onChange={e => setDrinkCustom(prev => ({ ...prev, [row.id]: e.target.value }))}
                          style={{
                            flex: 1, padding: '7px 12px',
                            border: `1.5px solid ${(drinkCustom[row.id] ?? '').trim() ? RED : BORDER}`,
                            borderRadius: 10,
                            background: 'transparent',
                            fontFamily: 'Geist, -apple-system, system-ui, sans-serif',
                            fontSize: 16, color: INK,
                            outline: 'none',
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ),
    },

    // Step 3 — Rate each drink
    {
      icon: (
        <svg width="20" height="22" viewBox="0 0 24 24" fill="none" stroke={RED} strokeWidth="1.5">
          <path d="M8 22h8M12 11v11M5 2h14l-2 9a5 5 0 01-10 0L5 2z" />
        </svg>
      ),
      stepLabel: 'N° 03 · Il Voto',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div>
            <h2 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 40, fontWeight: 400, lineHeight: 1.05, color: INK, margin: '0 0 10px' }}>
              Rate each <em>drink.</em>
            </h2>
            <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 14, color: INK2, margin: 0 }}>
              One star rating per drink you had tonight.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            {allDrinkItems.map(drink => (
              <div key={drink} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={{
                  fontFamily: 'Geist, -apple-system, system-ui, sans-serif',
                  fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
                  color: INK2, margin: 0,
                }}>
                  {drink}
                </p>
                <Stars
                  value={drinkRatings[drink] ?? 0}
                  onChange={v => setDrinkRatings(prev => ({ ...prev, [drink]: v }))}
                  labels={['Terrible', 'Amazing']}
                />
              </div>
            ))}
          </div>
        </div>
      ),
    },

    // Step 4 — Music
    {
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={RED} strokeWidth="1.5">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="3" />
          <circle cx="12" cy="12" r="6" strokeDasharray="2 2" />
        </svg>
      ),
      stepLabel: 'N° 04 · La Musica',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <h2 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 40, fontWeight: 400, lineHeight: 1.05, color: INK, margin: '0 0 10px' }}>
              The <em>music?</em>
            </h2>
            <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 14, color: INK2, margin: 0 }}>
              Rate the room, then tell us what was on.
            </p>
          </div>
          <Stars value={musicRating} onChange={setMusicRating} labels={['Dead', 'Electric']} />

          <div>
            <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: INK2, margin: '0 0 10px' }}>
              ↓ What was playing
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {GENRES.map(g => {
                const on = musicGenres.includes(g)
                return (
                  <button
                    key={g}
                    onClick={() => setMusicGenres(prev => on ? prev.filter(x => x !== g) : [...prev, g])}
                    style={{
                      fontFamily: 'Geist, -apple-system, system-ui, sans-serif',
                      fontSize: 13,
                      padding: '7px 14px',
                      borderRadius: 99,
                      border: `1.5px solid ${on ? RED : BORDER}`,
                      background: on ? RED : 'transparent',
                      color: on ? BG : INK,
                      cursor: 'pointer',
                      touchAction: 'manipulation',
                      transition: 'all 0.15s',
                    }}
                  >
                    {g}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      ),
    },

    // Step 4 — Crowd
    {
      icon: (
        <svg width="24" height="20" viewBox="0 0 24 24" fill="none" stroke={RED} strokeWidth="1.5">
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
        </svg>
      ),
      stepLabel: 'N° 05 · La Sala',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <h2 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 40, fontWeight: 400, lineHeight: 1.05, color: INK, margin: '0 0 10px' }}>
              And the <em>crowd?</em>
            </h2>
            <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 14, color: INK2, margin: 0 }}>
              A great room is half people, half music.
            </p>
          </div>
          <Stars value={crowdRating} onChange={setCrowdRating} labels={['Empty / bad', 'Packed & great']} />
        </div>
      ),
    },

    // Step 5 — Would you go back?
    {
      icon: (
        <svg width="22" height="20" viewBox="0 0 24 24" fill="none" stroke={RED} strokeWidth="1.5">
          <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
        </svg>
      ),
      stepLabel: 'N° 06 · Tornerai?',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <h2 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 40, fontWeight: 400, lineHeight: 1.05, color: INK, margin: '0 0 10px' }}>
              Would you <em>go back?</em>
            </h2>
            <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 14, color: INK2, margin: 0 }}>
              One tap and we're done.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {([
              { id: 'yes',   label: 'Subito',   sub: '100%',        note: 'First in line next time.' },
              { id: 'maybe', label: 'Forse',    sub: 'MAYBE',       note: 'If the night calls for it.' },
              { id: 'no',    label: 'Mai più',  sub: 'NEVER AGAIN', note: 'Once was enough.' },
            ] as const).map(opt => {
              const sel = wouldReturn === opt.id
              return (
                <button
                  key={opt.id}
                  onClick={() => setWouldReturn(opt.id)}
                  style={{
                    border: `1.5px solid ${sel ? RED : BORDER}`,
                    borderRadius: 14,
                    padding: '14px 18px',
                    background: sel ? 'rgba(140,42,42,0.04)' : 'transparent',
                    display: 'flex', alignItems: 'center', gap: 14,
                    cursor: 'pointer', touchAction: 'manipulation',
                    textAlign: 'left', width: '100%',
                  }}
                >
                  {/* Radio */}
                  <div style={{
                    width: 20, height: 20, borderRadius: '50%',
                    border: `2px solid ${sel ? RED : BORDER}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {sel && <div style={{ width: 10, height: 10, borderRadius: '50%', background: RED }} />}
                  </div>

                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: 'italic', fontSize: 20, color: INK }}>{opt.label}</span>
                      <span style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: INK2 }}>{opt.sub}</span>
                    </div>
                    <span style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 12, color: INK2, fontStyle: 'italic' }}>{opt.note}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ),
    },
  ]

  const current = STEPS[step]

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60,
      background: BG,
      display: 'flex', flexDirection: 'column',
      overflowY: 'auto', overflowX: 'hidden',
      overscrollBehavior: 'none',
      width: '100%', maxWidth: '100vw',
      WebkitOverflowScrolling: 'touch' as any,
    }}>

      {/* ── Progress bar + step counter ───────────────────────────────────── */}
      <div style={{ padding: '16px 24px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          {STEPS.map((_, i) => (
            <div
              key={i}
              style={{
                flex: 1, height: 3, borderRadius: 2,
                background: i <= step ? RED : 'rgba(34,30,26,0.15)',
                transition: 'background 0.3s',
              }}
            />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <span style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: INK2 }}>
            Step {String(step + 1).padStart(2, '0')} / {String(TOTAL).padStart(2, '0')}
          </span>
          <span style={{ margin: '0 12px', color: BORDER }}>·</span>
          <button
            onClick={() => onSkip(booking.id)}
            style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: INK2, cursor: 'pointer' }}
          >
            Skip
          </button>
        </div>
      </div>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div style={{ flex: 1, padding: '28px 24px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <StepIcon>{current.icon}</StepIcon>

        <p style={{
          fontFamily: 'Geist, -apple-system, system-ui, sans-serif',
          fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase',
          color: RED, margin: 0, fontWeight: 500,
        }}>
          {current.stepLabel}
        </p>

        {current.content}
      </div>

      {/* ── Bottom CTA ───────────────────────────────────────────────────── */}
      <div style={{ padding: '0 24px 100px', flexShrink: 0 }}>
        <button
          onClick={isLast ? submit : next}
          disabled={!canNext || submitting}
          style={{
            width: '100%', padding: '17px 0',
            background: canNext && !submitting ? RED : 'rgba(140,42,42,0.35)',
            color: BG,
            border: 'none', borderRadius: 14,
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 18, fontStyle: 'italic',
            cursor: canNext && !submitting ? 'pointer' : 'default',
            touchAction: 'manipulation',
            transition: 'background 0.2s',
          }}
        >
          {submitting ? 'Sending…' : isLast ? 'Submit' : 'Continue'}
        </button>
      </div>
    </div>
  )
}
