'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Prefs {
  music:   string[]
  vibes:   string[]
  crowd:   string
  drinks:  string[]
  budget:  number    // euro amount; 999 = no limit
  nights:  string[]  // multi-select days
}

const STEPS = [
  'music', 'vibes', 'drinks', 'budget', 'nights', 'crowd',
] as const

const STEP_META: Record<string, { title: string; subtitle: string; multi?: boolean }> = {
  music:  { title: 'What gets you moving?',   subtitle: 'Pick all the genres you love',        multi: true  },
  vibes:  { title: "What's your vibe?",        subtitle: 'Pick up to 3',                        multi: true  },
  drinks: { title: "What's in your glass?",    subtitle: 'Pick your drinks — get specific',     multi: true  },
  budget: { title: "What's your budget?",      subtitle: 'Drag to set your limit for a night',  multi: false },
  nights: { title: 'When do you come alive?',  subtitle: 'Pick every night you go out',         multi: true  },
  crowd:  { title: "Who's your crowd?",        subtitle: 'The vibe of the people around you',   multi: false },
}

const OPTIONS: Record<string, { value: string; label: string }[]> = {
  music: [
    { value: 'House',       label: 'House'       },
    { value: 'Techno',      label: 'Techno'      },
    { value: 'Hip-Hop',     label: 'Hip-Hop'     },
    { value: 'Latin',       label: 'Latin'       },
    { value: 'R&B',         label: 'R&B'         },
    { value: 'Electronic',  label: 'Electronic'  },
    { value: 'Reggaeton',   label: 'Reggaeton'   },
    { value: 'Afrobeats',   label: 'Afrobeats'   },
    { value: 'Commercial',  label: 'Commercial'  },
    { value: 'Drum & Bass', label: 'Drum & Bass' },
  ],
  vibes: [
    { value: 'wild',        label: 'Wild & loud' },
    { value: 'intimate',    label: 'Intimate'    },
    { value: 'underground', label: 'Underground' },
    { value: 'upscale',     label: 'Upscale'     },
    { value: 'beach',       label: 'Beachfront'  },
    { value: 'rooftop',     label: 'Rooftop'     },
    { value: 'live_music',  label: 'Live music'  },
    { value: 'dancing',     label: 'Dance floor' },
  ],
  nights: [
    { value: 'monday',    label: 'Monday'            },
    { value: 'tuesday',   label: 'Tuesday'           },
    { value: 'wednesday', label: 'Wednesday'         },
    { value: 'thursday',  label: 'Thursday'          },
    { value: 'friday',    label: 'Friday'            },
    { value: 'saturday',  label: 'Saturday'          },
    { value: 'sunday',    label: 'Sunday'            },
    { value: 'special',   label: 'Special occasions' },
  ],
  crowd: [
    { value: 'mixed',        label: 'Mixed crowd'     },
    { value: 'lgbtq',        label: 'LGBTQ+ friendly' },
    { value: 'local',        label: 'Mostly locals'   },
    { value: 'international',label: 'International'   },
    { value: 'mature',       label: 'Mature (25+)'    },
    { value: 'young',        label: 'Young energy'    },
  ],
}

const DRINK_CATEGORIES = [
  {
    key: 'cocktails',
    label: 'Cocktails',
    allowCustom: true,
    items: [
      'Espresso Martini', 'Aperol Spritz', 'Mojito', 'Negroni', 'Margarita',
      'Gin & Tonic', 'Long Island Iced Tea', 'Daiquiri', 'Cosmopolitan', 'Paloma',
      'Old Fashioned', 'Whiskey Sour', 'Manhattan', 'Dark & Stormy', 'Moscow Mule',
      'Piña Colada', 'Sex on the Beach', 'Tequila Sunrise', 'Blue Lagoon', 'Sidecar',
      'Bramble', 'French 75', 'Kir Royale', 'Bellini', 'Mimosa',
      'Hugo', 'Tom Collins', 'Singapore Sling', 'Caipirinha', 'Pisco Sour',
      'Mai Tai', 'White Russian', 'Bloody Mary', 'Cuba Libre', 'Spicy Margarita',
      'Mezcal Negroni', 'Jungle Bird', 'Paper Plane', 'Last Word', 'Penicillin',
      'Clover Club', 'Porn Star Martini', 'Naked & Famous', 'Gimlet', 'Bee\'s Knees',
    ],
  },
  {
    key: 'beer',
    label: 'Beer',
    allowCustom: false,
    items: [
      'Estrella Damm', 'Moritz', 'Voll-Damm', 'San Miguel', 'Corona',
      'Heineken', 'Peroni', 'Asahi', 'Tiger', 'Sapporo',
      'Modelo', 'Dos Equis', 'Guinness', 'Newcastle Brown', 'Blue Moon',
      'Craft IPA', 'Hazy IPA', 'Session IPA', 'Pale Ale', 'Amber Ale',
      'Wheat Beer', 'Erdinger', 'Paulaner', 'Leffe', 'Duvel',
      'Chimay', 'Lager', 'Pilsner', 'Stout', 'Porter', 'Sour Beer',
    ],
  },
  {
    key: 'wine',
    label: 'Wine',
    allowCustom: false,
    items: ['Red Wine', 'White Wine', 'Rosé', 'Sangria', 'Cava', 'Prosecco', 'Rioja', 'Albariño'],
  },
  {
    key: 'shots',
    label: 'Shots',
    allowCustom: false,
    items: ['Tequila', 'Mezcal', 'Vodka', 'Whiskey', 'Jägermeister', 'Sambuca', 'Rum', 'Gin', 'Absinthe', 'Fireball', 'Limoncello', 'Baileys'],
  },
  {
    key: 'champagne',
    label: 'Champagne',
    allowCustom: false,
    items: ['Moët & Chandon', 'Veuve Clicquot', 'Dom Pérignon', 'Laurent-Perrier', 'House Champagne', 'Cava'],
  },
  {
    key: 'non_alcoholic',
    label: 'Non-alcoholic',
    allowCustom: false,
    items: ['Mocktail', 'Virgin Mojito', 'Juice', 'Sparkling Water', 'Energy Drink', 'Soda', 'Kombucha', 'Lemonade'],
  },
]

const BUDGET_NO_LIMIT = 999

function BudgetSlider({ budget, setBudget }: { budget: number; setBudget: (v: number) => void }) {
  const noLimit = budget >= BUDGET_NO_LIMIT
  const sliderVal = noLimit ? 200 : budget

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = parseInt(e.target.value)
    setBudget(v >= 200 ? BUDGET_NO_LIMIT : v)
  }

  return (
    <div className="flex-1 flex flex-col justify-center gap-xl">
      {/* Amount display */}
      <div className="text-center">
        <p className="font-label-sm text-label-sm text-on-surface-variant/50 uppercase tracking-widest mb-xs">
          your limit
        </p>
        <p className="font-display text-[56px] text-primary leading-none">
          {noLimit ? '∞' : `€${sliderVal}`}
        </p>
        <p className="font-body-md text-on-surface-variant mt-xs">
          {noLimit ? 'No limit — VIP mode' : `under €${sliderVal} per night`}
        </p>
      </div>

      {/* Slider */}
      <div className="px-sm space-y-sm">
        <input
          type="range"
          min={10}
          max={200}
          step={5}
          value={sliderVal}
          onChange={handleChange}
          className="w-full h-2 rounded-full appearance-none cursor-pointer accent-primary bg-surface-container-highest"
        />
        <div className="flex justify-between font-label-sm text-[10px] text-on-surface-variant/40 uppercase tracking-widest">
          <span>€10</span>
          <span>€50</span>
          <span>€100</span>
          <span>€150</span>
          <span>No limit</span>
        </div>
      </div>

      {/* Quick presets */}
      <div className="flex gap-sm justify-center flex-wrap">
        {[20, 50, 100, 150].map(v => (
          <button key={v} onClick={() => setBudget(v)}
            className={`px-md py-xs rounded-full border font-label-sm text-label-sm uppercase tracking-widest transition-all active:scale-95 ${
              budget === v
                ? 'border-primary bg-primary-container/30 text-primary'
                : 'border-outline-variant/20 bg-surface-container text-on-surface-variant'
            }`}>
            €{v}
          </button>
        ))}
        <button onClick={() => setBudget(BUDGET_NO_LIMIT)}
          className={`px-md py-xs rounded-full border font-label-sm text-label-sm uppercase tracking-widest transition-all active:scale-95 ${
            noLimit
              ? 'border-primary bg-primary-container/30 text-primary'
              : 'border-outline-variant/20 bg-surface-container text-on-surface-variant'
          }`}>
          No limit
        </button>
      </div>
    </div>
  )
}

function DrinkStep({ drinks, setDrinks }: {
  drinks: string[]
  setDrinks: (fn: (prev: string[]) => string[]) => void
}) {
  const [expanded, setExpanded]       = useState<string | null>(null)
  const [customInput, setCustomInput] = useState('')
  const [showCustom, setShowCustom]   = useState(false)

  function toggleItem(item: string) {
    setDrinks(prev => prev.includes(item) ? prev.filter(d => d !== item) : [...prev, item])
  }

  function addCustom() {
    const val = customInput.trim()
    if (!val) return
    setDrinks(prev => prev.includes(val) ? prev : [...prev, val])
    setCustomInput('')
    setShowCustom(false)
  }

  function dontCare(catKey: string) {
    const cat = DRINK_CATEGORIES.find(c => c.key === catKey)!
    setDrinks(prev => {
      const withoutCat = prev.filter(d => !cat.items.includes(d) && d !== catKey)
      return [...withoutCat, catKey]
    })
    setExpanded(null)
  }

  function catHasSelection(cat: typeof DRINK_CATEGORIES[number]) {
    return cat.items.some(i => drinks.includes(i)) || drinks.includes(cat.key)
  }

  return (
    <div className="flex-1 space-y-sm overflow-y-auto">
      {DRINK_CATEGORIES.map(cat => {
        const isOpen     = expanded === cat.key
        const hasSel     = catHasSelection(cat)
        const isDontCare = drinks.includes(cat.key)
        const selCount   = cat.items.filter(i => drinks.includes(i)).length

        return (
          <div key={cat.key} className={`rounded-2xl border-2 overflow-hidden transition-all ${hasSel ? 'border-primary' : 'border-outline-variant/20'}`}>
            <button
              className={`w-full flex items-center justify-between px-md py-sm transition-colors ${hasSel ? 'bg-primary-container/20' : 'bg-surface-container'}`}
              onClick={() => setExpanded(isOpen ? null : cat.key)}
            >
              <div className="flex items-center gap-sm">
                {hasSel && (
                  <span className="material-symbols-outlined text-primary text-[16px]"
                    style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                )}
                <span className={`font-body-md font-bold ${hasSel ? 'text-on-surface' : 'text-on-surface-variant'}`}>
                  {cat.label}
                </span>
                {isDontCare && (
                  <span className="font-label-sm text-[10px] text-on-surface-variant/50 uppercase tracking-widest">any</span>
                )}
                {!isDontCare && selCount > 0 && (
                  <span className="font-label-sm text-[10px] text-primary/70 uppercase tracking-widest">{selCount} selected</span>
                )}
              </div>
              <span className="material-symbols-outlined text-on-surface-variant/50 text-[20px]">
                {isOpen ? 'expand_less' : 'expand_more'}
              </span>
            </button>

            {isOpen && (
              <div className="px-sm pb-sm pt-xs border-t border-outline-variant/10 bg-surface-container/50 space-y-xs">
                <div className="flex flex-wrap gap-xs pt-xs">
                  {cat.items.map(item => {
                    const sel = drinks.includes(item)
                    return (
                      <button key={item} onClick={() => toggleItem(item)}
                        className={`flex items-center gap-xs px-sm py-xs rounded-xl border text-left transition-all active:scale-[0.97] ${
                          sel
                            ? 'border-primary bg-primary-container/30 text-on-surface'
                            : 'border-outline-variant/20 bg-surface-container text-on-surface-variant'
                        }`}>
                        {sel && (
                          <span className="material-symbols-outlined text-primary text-[13px]"
                            style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
                        )}
                        <span className="font-body-md font-bold text-sm whitespace-nowrap">{item}</span>
                      </button>
                    )
                  })}

                  {/* Custom cocktail entry */}
                  {cat.allowCustom && (
                    showCustom ? (
                      <div className="flex items-center gap-xs w-full mt-xs">
                        <input
                          autoFocus
                          value={customInput}
                          onChange={e => setCustomInput(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && addCustom()}
                          placeholder="Type a cocktail…"
                          className="flex-1 bg-surface-container border border-outline-variant/30 rounded-xl px-sm py-xs font-body-md text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/60 text-sm"
                        />
                        <button onClick={addCustom}
                          className="px-sm py-xs rounded-xl bg-primary-container text-on-primary-container font-label-sm text-label-sm uppercase tracking-widest active:scale-95">
                          Add
                        </button>
                        <button onClick={() => setShowCustom(false)}
                          className="p-xs text-on-surface-variant/50 active:scale-95">
                          <span className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setShowCustom(true)}
                        className="flex items-center gap-xs px-sm py-xs rounded-xl border border-dashed border-outline-variant/40 text-on-surface-variant/60 transition-all active:scale-[0.97]">
                        <span className="material-symbols-outlined text-[14px]">add</span>
                        <span className="font-body-md text-sm whitespace-nowrap">Custom</span>
                      </button>
                    )
                  )}
                </div>

                <button
                  onClick={() => dontCare(cat.key)}
                  className={`w-full mt-xs py-xs rounded-xl border text-center font-label-sm text-label-sm uppercase tracking-widest transition-all active:scale-[0.98] ${
                    isDontCare
                      ? 'border-primary/40 bg-primary-container/20 text-primary'
                      : 'border-outline-variant/20 text-on-surface-variant/50'
                  }`}>
                  I don't really care
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep]     = useState(0)
  const [saving, setSaving] = useState(false)
  const [prefs, setPrefs]   = useState<Prefs>({
    music: [], vibes: [], crowd: '', drinks: [],
    budget: 50, nights: [],
  })

  const currentKey = STEPS[step]
  const meta       = STEP_META[currentKey]
  const opts       = OPTIONS[currentKey] ?? []
  const isMulti    = meta.multi
  const progress   = ((step + 1) / STEPS.length) * 100

  function toggle(key: keyof Prefs, value: string) {
    setPrefs(p => {
      if (isMulti) {
        const arr = p[key] as string[]
        const next = arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value]
        if (key === 'vibes' && next.length > 3) return p
        return { ...p, [key]: next }
      }
      return { ...p, [key]: value }
    })
  }

  function isSelected(key: keyof Prefs, value: string) {
    const v = prefs[key]
    if (Array.isArray(v)) return v.includes(value)
    return String(v) === value
  }

  function canAdvance() {
    if (currentKey === 'drinks') return prefs.drinks.length > 0
    if (currentKey === 'budget') return true
    const v = prefs[currentKey as keyof Prefs]
    if (Array.isArray(v)) return v.length > 0
    return v !== '' && v !== undefined
  }

  async function finish() {
    setSaving(true)
    await fetch('/api/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    })
    router.replace('/explore')
  }

  const isLast = step === STEPS.length - 1

  return (
    <div className="min-h-screen flex flex-col px-container-padding pt-md pb-8">
      {/* Progress bar */}
      <div className="h-1 bg-surface-container-highest rounded-full mb-lg overflow-hidden">
        <div className="h-full bg-primary-container rounded-full transition-all duration-500"
          style={{ width: `${progress}%` }} />
      </div>

      {/* Step counter */}
      <p className="font-label-sm text-label-sm text-on-surface-variant/50 uppercase tracking-widest mb-xs">
        {step + 1} of {STEPS.length}
      </p>

      {/* Question */}
      <div className="mb-lg">
        <h1 className="font-h1 text-h1 text-primary uppercase tracking-[0.08em] leading-tight mb-xs">
          {meta.title}
        </h1>
        <p className="font-body-md text-on-surface-variant">{meta.subtitle}</p>
      </div>

      {/* Step-specific rendering */}
      {currentKey === 'drinks' ? (
        <DrinkStep
          drinks={prefs.drinks}
          setDrinks={fn => setPrefs(p => ({ ...p, drinks: fn(p.drinks) }))}
        />
      ) : currentKey === 'budget' ? (
        <BudgetSlider
          budget={prefs.budget}
          setBudget={v => setPrefs(p => ({ ...p, budget: v }))}
        />
      ) : (
        <div className="flex flex-wrap gap-sm content-start flex-1">
          {opts.map(opt => {
            const selected = isSelected(currentKey as keyof Prefs, opt.value)
            return (
              <button key={opt.value}
                onClick={() => toggle(currentKey as keyof Prefs, opt.value)}
                className={`flex items-center gap-xs px-md py-sm rounded-2xl border-2 text-left transition-all active:scale-[0.97] ${
                  selected
                    ? 'border-primary bg-primary-container/20'
                    : 'border-outline-variant/20 bg-surface-container'
                }`}>
                {selected && (
                  <span className="material-symbols-outlined text-primary text-[16px] flex-shrink-0"
                    style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                )}
                <span className={`font-body-md font-bold whitespace-nowrap ${selected ? 'text-on-surface' : 'text-on-surface-variant'}`}>
                  {opt.label}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Navigation */}
      <div className="flex gap-sm mt-lg">
        {step > 0 && (
          <button onClick={() => setStep(s => s - 1)}
            className="h-14 px-md border border-outline-variant/30 text-on-surface-variant font-h2 rounded-xl active:scale-95">
            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
          </button>
        )}
        <button
          onClick={() => isLast ? finish() : setStep(s => s + 1)}
          disabled={!canAdvance() || saving}
          className="flex-1 h-14 bg-primary-container text-on-primary-container font-h2 rounded-xl ignite-glow active:scale-[0.98] disabled:opacity-40 transition-all">
          {saving ? 'Saving…' : isLast ? "Let's go" : 'Next'}
        </button>
      </div>

      {/* Skip */}
      {!isLast && (
        <button onClick={() => setStep(s => s + 1)}
          className="text-center font-label-sm text-label-sm text-on-surface-variant/40 uppercase tracking-widest mt-sm active:scale-95">
          Skip this one
        </button>
      )}
    </div>
  )
}
