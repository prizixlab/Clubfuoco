'use client'

import { useState } from 'react'
import { DRINK_CATEGORIES } from '@/lib/preferences'

// All preset items across every category — used to identify custom drinks
const ALL_PRESET_ITEMS = new Set(
  DRINK_CATEGORIES.flatMap(c => [...c.items, c.key])
)

function getCustomDrinks(drinks: string[]) {
  return drinks.filter(d => !ALL_PRESET_ITEMS.has(d))
}

export default function DrinkStep({
  drinks,
  setDrinks,
}: {
  drinks: string[]
  setDrinks: (fn: (prev: string[]) => string[]) => void
}) {
  const [expanded,     setExpanded]     = useState<string | null>(null)
  // Per-category custom input state
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({})
  const [showCustom,   setShowCustom]   = useState<Record<string, boolean>>({})

  function getInput(key: string)  { return customInputs[key] ?? '' }
  function isShowingInput(key: string) { return showCustom[key] ?? false }

  function setInput(key: string, val: string) {
    setCustomInputs(prev => ({ ...prev, [key]: val }))
  }
  function openInput(key: string) {
    setShowCustom(prev => ({ ...prev, [key]: true }))
  }
  function closeInput(key: string) {
    setShowCustom(prev => ({ ...prev, [key]: false }))
    setInput(key, '')
  }

  function toggleItem(item: string) {
    setDrinks(prev => prev.includes(item) ? prev.filter(d => d !== item) : [...prev, item])
  }

  function addCustom(catKey: string) {
    const val = getInput(catKey).trim()
    if (!val) return
    setDrinks(prev => prev.includes(val) ? prev : [...prev, val])
    closeInput(catKey)
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
    if (cat.key === 'other') return getCustomDrinks(drinks).length > 0
    return cat.items.some(i => drinks.includes(i)) || drinks.includes(cat.key)
  }

  function handleExpand(key: string) {
    const next = expanded === key ? null : key
    setExpanded(next)
    // Auto-open input for categories with no preset items
    if (next) {
      const cat = DRINK_CATEGORIES.find(c => c.key === next)!
      if (cat.items.length === 0) openInput(next)
    }
  }

  return (
    <div className="space-y-sm">
      {DRINK_CATEGORIES.map(cat => {
        const isOpen      = expanded === cat.key
        const hasSel      = catHasSelection(cat)
        const isDontCare  = drinks.includes(cat.key)
        const selCount    = cat.key === 'other'
          ? getCustomDrinks(drinks).length
          : cat.items.filter(i => drinks.includes(i)).length
        const inputVal    = getInput(cat.key)
        const inputOpen   = isShowingInput(cat.key)
        const customItems = cat.key === 'other' ? getCustomDrinks(drinks) : []
        const isOther     = cat.key === 'other'

        return (
          <div
            key={cat.key}
            className={`rounded-2xl border-2 overflow-hidden transition-all ${
              hasSel ? 'border-primary' : 'border-outline-variant/20'
            }`}
          >
            {/* Category header */}
            <button
              type="button"
              className={`w-full flex items-center justify-between px-md py-sm transition-colors ${
                hasSel ? 'bg-primary-container/20' : 'bg-surface-container'
              }`}
              onClick={() => handleExpand(cat.key)}
            >
              <div className="flex items-center gap-sm">
                {hasSel && (
                  <span
                    className="material-symbols-outlined text-primary text-[16px]"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    check_circle
                  </span>
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
                {/* Preset pills */}
                {cat.items.length > 0 && (
                  <div className="flex flex-wrap gap-xs pt-xs">
                    {cat.items.map(item => {
                      const sel = drinks.includes(item)
                      return (
                        <button
                          key={item}
                          type="button"
                          onClick={() => toggleItem(item)}
                          className={`flex items-center gap-xs px-sm py-xs rounded-xl border text-left transition-all active:scale-[0.97] ${
                            sel
                              ? 'border-primary bg-primary-container/30 text-on-surface'
                              : 'border-outline-variant/20 bg-surface-container text-on-surface-variant'
                          }`}
                        >
                          {sel && (
                            <span
                              className="material-symbols-outlined text-primary text-[13px]"
                              style={{ fontVariationSettings: "'FILL' 1" }}
                            >
                              check
                            </span>
                          )}
                          <span className="font-body-md font-bold text-sm whitespace-nowrap">{item}</span>
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* Custom items (Other tab shows all custom drinks as removable pills) */}
                {isOther && customItems.length > 0 && (
                  <div className="flex flex-wrap gap-xs pt-xs">
                    {customItems.map(item => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => toggleItem(item)}
                        className="flex items-center gap-xs px-sm py-xs rounded-xl border border-primary bg-primary-container/30 text-on-surface transition-all active:scale-[0.97]"
                      >
                        <span className="font-body-md font-bold text-sm whitespace-nowrap">{item}</span>
                        <span className="material-symbols-outlined text-primary/70 text-[13px]">close</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Custom input */}
                {cat.allowCustom && (
                  <div className={cat.items.length > 0 ? 'pt-xs' : 'pt-xs'}>
                    {inputOpen || isOther ? (
                      <div className="flex items-center gap-xs">
                        <input
                          autoFocus={inputOpen && !isOther}
                          value={inputVal}
                          onChange={e => setInput(cat.key, e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && addCustom(cat.key)}
                          placeholder={isOther ? 'Type anything you like…' : `Add your own…`}
                          className="flex-1 bg-surface-container border border-outline-variant/30 rounded-xl px-sm py-xs font-body-md text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/60 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => addCustom(cat.key)}
                          disabled={!inputVal.trim()}
                          className="px-sm py-xs rounded-xl bg-primary-container text-on-primary-container font-label-sm text-label-sm uppercase tracking-widest active:scale-95 disabled:opacity-30"
                        >
                          Add
                        </button>
                        {!isOther && (
                          <button
                            type="button"
                            onClick={() => closeInput(cat.key)}
                            className="p-xs text-on-surface-variant/50 active:scale-95"
                          >
                            <span className="material-symbols-outlined text-[18px]">close</span>
                          </button>
                        )}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openInput(cat.key)}
                        className="flex items-center gap-xs px-sm py-xs rounded-xl border border-dashed border-outline-variant/40 text-on-surface-variant/60 transition-all active:scale-[0.97]"
                      >
                        <span className="material-symbols-outlined text-[14px]">add</span>
                        <span className="font-body-md text-sm whitespace-nowrap">Other</span>
                      </button>
                    )}
                  </div>
                )}

                {/* "I don't really care" — not shown for Other tab */}
                {!isOther && (
                  <button
                    type="button"
                    onClick={() => dontCare(cat.key)}
                    className={`w-full mt-xs py-xs rounded-xl border text-center font-label-sm text-label-sm uppercase tracking-widest transition-all active:scale-[0.98] ${
                      isDontCare
                        ? 'border-primary/40 bg-primary-container/20 text-primary'
                        : 'border-outline-variant/20 text-on-surface-variant/50'
                    }`}
                  >
                    I don't really care
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
