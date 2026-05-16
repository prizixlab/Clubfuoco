'use client'
import { apiFetch } from '@/lib/api'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import DrinkStep from '@/components/DrinkStep'

// ── Onboarding questionnaire — cinema design style
// Matches the auth flow visual language exactly.

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  cream:  '#F8F5EE',
  ink:    '#221E1A',
  stone:  '#6E6356',
  sand:   '#9F9486',
  red:    '#8C2A2A',
  white:  '#FFFFFF',
}

// ─── Data ─────────────────────────────────────────────────────────────────────
const MUSIC_GENRES = [
  { value: 'House',       label: 'House'       },
  { value: 'Techno',      label: 'Techno'      },
  { value: 'Hip-Hop',     label: 'Hip-Hop'     },
  { value: 'R&B',         label: 'R&B'         },
  { value: 'Latin',       label: 'Latin'       },
  { value: 'Reggaeton',   label: 'Reggaeton'   },
  { value: 'Afrobeats',   label: 'Afrobeats'   },
  { value: 'Electronic',  label: 'Electronic'  },
  { value: 'Drum & Bass', label: 'Drum & Bass' },
  { value: 'Commercial',  label: 'Commercial'  },
  { value: 'Live Music',  label: 'Live Music'  },
  { value: 'Jazz',        label: 'Jazz'        },
]

const VIBES = [
  { value: 'wild',        label: 'Wild & loud'   },
  { value: 'intimate',    label: 'Intimate'      },
  { value: 'underground', label: 'Underground'   },
  { value: 'upscale',     label: 'Upscale'       },
  { value: 'rooftop',     label: 'Rooftop'       },
  { value: 'beach',       label: 'Beachfront'    },
  { value: 'dancing',     label: 'Dance floor'   },
  { value: 'chill',       label: 'Chill bar'     },
]

const DRINKS = [
  { value: 'cocktails',    label: 'Cocktails'       },
  { value: 'beer',         label: 'Beer'            },
  { value: 'wine',         label: 'Wine & Rosé'     },
  { value: 'spirits',      label: 'Spirits'         },
  { value: 'shots',        label: 'Shots'           },
  { value: 'non_alcoholic',label: 'Alcohol-free'    },
  { value: 'champagne',    label: 'Champagne'       },
  { value: 'everything',   label: 'Everything'      },
]

const NIGHTS = [
  { value: 'thursday',  label: 'Thursday'          },
  { value: 'friday',    label: 'Friday'            },
  { value: 'saturday',  label: 'Saturday'          },
  { value: 'sunday',    label: 'Sunday'            },
  { value: 'wednesday', label: 'Wednesday'         },
  { value: 'monday',    label: 'Monday'            },
  { value: 'tuesday',   label: 'Tuesday'           },
  { value: 'special',   label: 'Special occasions' },
]

const CROWD = [
  { value: 'mixed',         label: 'Mixed crowd'      },
  { value: 'lgbtq',         label: 'LGBTQ+ friendly'  },
  { value: 'local',         label: 'Mostly locals'    },
  { value: 'international', label: 'International'    },
  { value: 'mature',        label: 'Mature (25+)'     },
  { value: 'young',         label: 'Young energy'     },
]

// How big is the group you go out with
const SQUAD = [
  { value: 'solo',   label: 'Solo', sub: 'Just me' },
  { value: 'duo',    label: 'Duo',  sub: 'Me + 1'  },
  { value: 'small',  label: 'Crew', sub: '3 – 5'   },
  { value: 'large',  label: 'Gang', sub: '6+'       },
]

const BUDGET_NO_LIMIT = 999

// Step metadata
const STEPS = [
  { key: 'music',  kicker: 'N° 01 · Musica',     title: 'What gets you',   italic: 'moving?',   sub: 'Pick all the genres you love.',       multi: true  },
  { key: 'vibes',  kicker: 'N° 02 · Atmosfera',  title: "What's your",     italic: 'vibe?',     sub: 'Pick up to 3 that fit you best.',     multi: true  },
  { key: 'drinks', kicker: 'N° 03 · Bevande',    title: "What's in your",  italic: 'glass?',    sub: 'Pick everything you drink.',          multi: true  },
  { key: 'nights', kicker: 'N° 04 · Serate',     title: 'When do you come', italic: 'alive?',   sub: 'Pick every night you go out.',        multi: true  },
  { key: 'budget', kicker: 'N° 05 · Budget',     title: "What's your",     italic: 'limit?',    sub: 'How much do you spend on a night out?', multi: false },
  { key: 'squad',  kicker: 'N° 06 · Compagnia',  title: 'Who do you roll',  italic: 'with?',    sub: 'How big is the crew you go out with.', multi: false },
  { key: 'crowd',  kicker: 'N° 07 · Folla',      title: "Who's your",       italic: 'crowd?',   sub: 'The kind of people around you.',      multi: false },
] as const

type StepKey = typeof STEPS[number]['key']

interface Prefs {
  music:   string[]
  vibes:   string[]
  drinks:  string[]
  nights:  string[]
  budget:  number
  squad:   string
  crowd:   string
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <div style={{ display: 'flex', gap: 5 }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{
          flex: 1, height: 2, borderRadius: 1,
          background: i < step ? C.red : 'rgba(34,30,26,0.16)',
          transition: 'background 0.3s',
        }} />
      ))}
    </div>
  )
}

// Chip button — used for multi-select and single-select options
function Chip({
  label, selected, onClick, small,
}: {
  label: string, selected: boolean, onClick: () => void, small?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: small ? '8px 14px' : '10px 18px',
        borderRadius: 999,
        border: selected ? `1px solid ${C.red}` : '1px solid rgba(34,30,26,0.12)',
        background: selected ? C.red : C.white,
        cursor: 'pointer',
        fontFamily: '"Instrument Serif", Georgia, serif',
        fontSize: small ? 15 : 17,
        fontStyle: 'italic',
        color: selected ? C.cream : C.ink,
        transition: 'all 0.15s',
        whiteSpace: 'nowrap' as const,
        display: 'flex', alignItems: 'center', gap: 6,
      }}
    >
      {selected && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
          <path d="M2 6l2.5 2.5L10 4" stroke={C.cream} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
      {label}
    </button>
  )
}

// Squad card — bigger tappable card
function SquadCard({
  label, sub, selected, onClick,
}: {
  label: string, sub: string, selected: boolean, onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, padding: '20px 12px',
        borderRadius: 16,
        border: selected ? `1.5px solid ${C.red}` : '1px solid rgba(34,30,26,0.08)',
        background: selected ? 'rgba(140,42,42,0.06)' : C.white,
        cursor: 'pointer', textAlign: 'center',
        display: 'flex', flexDirection: 'column', gap: 4,
        transition: 'all 0.15s',
      }}
    >
      <span style={{
        fontFamily: '"Instrument Serif", Georgia, serif',
        fontSize: 24, fontStyle: 'italic',
        color: selected ? C.red : C.ink,
      }}>
        {label}
      </span>
      <span style={{
        fontFamily: 'var(--font-geist-mono), monospace',
        fontSize: 9, color: C.sand, letterSpacing: '1.6px',
        textTransform: 'uppercase' as const,
      }}>
        {sub}
      </span>
    </button>
  )
}

// Budget slider
function BudgetSlider({
  budget, onChange,
}: {
  budget: number, onChange: (v: number) => void
}) {
  const noLimit  = budget >= BUDGET_NO_LIMIT
  const sliderVal = noLimit ? 200 : budget
  const PRESETS   = [20, 50, 100, 150]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* Big number */}
      <div style={{ textAlign: 'center' }}>
        <p style={{
          fontFamily: 'var(--font-geist-mono), monospace',
          fontSize: 9, color: C.sand, letterSpacing: '1.8px',
          textTransform: 'uppercase' as const, margin: '0 0 8px',
        }}>
          Your limit per night
        </p>
        <p style={{
          fontFamily: '"Instrument Serif", Georgia, serif',
          fontSize: 72, fontStyle: 'italic',
          color: C.red, margin: 0, lineHeight: 1,
          letterSpacing: '-2px',
        }}>
          {noLimit ? '∞' : `€${sliderVal}`}
        </p>
        <p style={{
          fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
          fontSize: 13, color: C.stone, margin: '8px 0 0',
        }}>
          {noLimit ? 'No limit — full VIP mode' : `under €${sliderVal} per night`}
        </p>
      </div>

      {/* Slider */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          type="range" min={10} max={200} step={5}
          value={sliderVal}
          onChange={e => {
            const v = parseInt(e.target.value)
            onChange(v >= 200 ? BUDGET_NO_LIMIT : v)
          }}
          style={{ width: '100%', accentColor: C.red, cursor: 'pointer' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          {['€10', '€50', '€100', '€150', 'No limit'].map(l => (
            <span key={l} style={{
              fontFamily: 'var(--font-geist-mono), monospace',
              fontSize: 8.5, color: C.sand, letterSpacing: '0.8px',
              textTransform: 'uppercase' as const,
            }}>
              {l}
            </span>
          ))}
        </div>
      </div>

      {/* Quick presets */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const, justifyContent: 'center' }}>
        {PRESETS.map(v => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            style={{
              padding: '8px 16px', borderRadius: 999,
              border: budget === v ? `1px solid ${C.red}` : '1px solid rgba(34,30,26,0.12)',
              background: budget === v ? C.red : C.white,
              fontFamily: '"Instrument Serif", Georgia, serif',
              fontSize: 15, fontStyle: 'italic',
              color: budget === v ? C.cream : C.ink,
              cursor: 'pointer',
            }}
          >
            €{v}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange(BUDGET_NO_LIMIT)}
          style={{
            padding: '8px 16px', borderRadius: 999,
            border: noLimit ? `1px solid ${C.red}` : '1px solid rgba(34,30,26,0.12)',
            background: noLimit ? C.red : C.white,
            fontFamily: '"Instrument Serif", Georgia, serif',
            fontSize: 15, fontStyle: 'italic',
            color: noLimit ? C.cream : C.ink,
            cursor: 'pointer',
          }}
        >
          No limit
        </button>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function OnboardingPage() {
  const router = useRouter()
  const [step,   setStep]   = useState(0)
  const [saving, setSaving] = useState(false)
  const [prefs,  setPrefs]  = useState<Prefs>({
    music: [], vibes: [], drinks: [], nights: [],
    budget: 50, squad: '', crowd: '',
  })

  const current = STEPS[step]
  const isLast  = step === STEPS.length - 1

  // ── Toggle helpers
  function toggleMulti(key: 'music' | 'vibes' | 'drinks' | 'nights', value: string) {
    setPrefs(p => {
      const arr  = p[key]
      const next = arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value]
      // Max 3 for vibes
      if (key === 'vibes' && next.length > 3) return p
      return { ...p, [key]: next }
    })
  }

  function setSingle(key: 'squad' | 'crowd', value: string) {
    setPrefs(p => ({ ...p, [key]: value }))
  }

  function isSelected(key: StepKey, value: string): boolean {
    if (key === 'budget') return false
    const v = prefs[key as keyof Prefs]
    if (Array.isArray(v)) return v.includes(value)
    return v === value
  }

  function canAdvance(): boolean {
    switch (current.key) {
      case 'music':  return prefs.music.length  > 0
      case 'vibes':  return prefs.vibes.length  > 0
      case 'drinks': return prefs.drinks.length > 0
      case 'nights': return prefs.nights.length > 0
      case 'budget': return true
      case 'squad':  return prefs.squad !== ''
      case 'crowd':  return prefs.crowd !== ''
      default:       return true
    }
  }

  async function finish() {
    setSaving(true)
    try {
      await apiFetch('/api/preferences', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(prefs),
      })
    } finally {
      router.replace('/explore')
    }
  }

  function advance() {
    if (isLast) finish()
    else setStep(s => s + 1)
  }

  function skip() {
    if (isLast) finish()
    else setStep(s => s + 1)
  }

  const OPTS: Record<StepKey, typeof MUSIC_GENRES> = {
    music:  MUSIC_GENRES,
    vibes:  VIBES,
    drinks: DRINKS,
    nights: NIGHTS,
    budget: [],
    squad:  [],
    crowd:  CROWD,
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: C.cream,
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
    } as React.CSSProperties}>

      {/* ── Header */}
      <div style={{ padding: '16px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          onClick={() => step === 0 ? router.push('/explore') : setStep(s => s - 1)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontFamily: 'var(--font-geist-mono), monospace',
            fontSize: 10, color: C.stone, letterSpacing: '1.8px',
            textTransform: 'uppercase' as const, background: 'none', border: 'none',
            cursor: 'pointer', padding: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back
        </button>

        <p style={{
          fontFamily: 'var(--font-geist-mono), monospace',
          fontSize: 8.5, color: C.sand, letterSpacing: '1.87px',
          textTransform: 'uppercase' as const, margin: 0,
        }}>
          {String(step + 1).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}
        </p>
      </div>

      {/* Progress bar */}
      <div style={{ padding: '12px 20px 0' }}>
        <ProgressBar step={step + 1} total={STEPS.length} />
      </div>

      {/* ── Body */}
      <div style={{
        padding: '28px 24px',
        paddingBottom: 'calc(40px + env(safe-area-inset-bottom, 0px))',
      }}>
        {/* Kicker */}
        <p style={{
          fontFamily: 'var(--font-geist-mono), monospace',
          fontSize: 9.5, color: C.red, letterSpacing: '2.09px',
          textTransform: 'uppercase' as const, margin: '0 0 12px',
        }}>
          {current.kicker}
        </p>

        {/* Headline */}
        <h1 style={{
          fontFamily: '"Instrument Serif", Georgia, serif',
          fontSize: 48, fontWeight: 400, lineHeight: 1.1,
          letterSpacing: '-1.04px', color: C.ink, margin: '0 0 8px',
        }}>
          {current.title}<br /><em>{current.italic}</em>
        </h1>
        <p style={{
          fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
          fontSize: 13.5, color: C.stone, letterSpacing: '-0.07px',
          margin: '0 0 32px',
        }}>
          {current.sub}
          {current.key === 'vibes' && (
            <span style={{ color: C.sand }}>{' '}· {prefs.vibes.length}/3</span>
          )}
        </p>

        {/* ── Music, Vibes, Nights, Crowd — chip grid */}
        {current.key !== 'budget' && current.key !== 'squad' && current.key !== 'drinks' && (
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 10, marginBottom: 32 }}>
            {OPTS[current.key].map(opt => (
              <Chip
                key={opt.value}
                label={opt.label}
                selected={isSelected(current.key, opt.value)}
                onClick={() => {
                  if (current.multi) {
                    toggleMulti(current.key as 'music' | 'vibes' | 'drinks' | 'nights', opt.value)
                  } else {
                    setSingle(current.key as 'crowd', opt.value)
                  }
                }}
              />
            ))}
          </div>
        )}

        {/* ── Drinks — categories expand to specific drink choices */}
        {current.key === 'drinks' && (
          <div style={{ marginBottom: 32 }}>
            <DrinkStep
              drinks={prefs.drinks}
              setDrinks={fn => setPrefs(p => ({ ...p, drinks: fn(p.drinks) }))}
            />
          </div>
        )}

        {/* ── Budget */}
        {current.key === 'budget' && (
          <div style={{ marginBottom: 32 }}>
            <BudgetSlider
              budget={prefs.budget}
              onChange={v => setPrefs(p => ({ ...p, budget: v }))}
            />
          </div>
        )}

        {/* ── Squad size */}
        {current.key === 'squad' && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 32 }}>
            {SQUAD.map(s => (
              <SquadCard
                key={s.value}
                label={s.label}
                sub={s.sub}
                selected={prefs.squad === s.value}
                onClick={() => setSingle('squad', s.value)}
              />
            ))}
          </div>
        )}

        {/* ── CTA */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button
            type="button"
            onClick={advance}
            disabled={!canAdvance() || saving}
            style={{
              width: '100%', height: 55,
              background: !canAdvance() ? 'rgba(140,42,42,0.3)' : C.red,
              color: C.cream, borderRadius: 14, border: 'none',
              fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
              fontSize: 15, fontWeight: 500,
              cursor: !canAdvance() ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'background 0.2s',
            }}
          >
            {saving ? 'Saving…' : isLast ? "Let's go" : (
              <>
                Continue
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={skip}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-geist-sans), Inter, sans-serif',
              fontSize: 13, color: C.sand, padding: '8px 0', textAlign: 'center',
            }}
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  )
}
