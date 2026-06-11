'use client'

import { useRef, useState, useEffect, useCallback } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// DrumPicker — iOS-style scroll-snap wheel picker
// Extracted from the signup birthday step so it can be shared by the
// schedule-ahead "WhenPlanner" (Explore) and the booking page.
// ─────────────────────────────────────────────────────────────────────────────
export const ITEM_H = 40

type Theme = 'light' | 'dark'

// Per-theme colour tokens. `light` matches the warm editorial system used on
// signup/Explore; `dark` matches the neon booking screen (orange on near-black).
const THEMES: Record<Theme, {
  surface: string
  border: string
  fadeFrom: string        // solid colour the top/bottom masks fade from
  band: string            // selection band hairline
  label: string           // tiny uppercase label colour
  selected: string        // centred/selected item colour
  item: string            // off-centre item colour
}> = {
  light: {
    surface: '#FFFFFF',
    border: 'rgba(34,30,26,0.08)',
    fadeFrom: '255,255,255',
    band: 'rgba(34,30,26,0.16)',
    label: '#9F9486',
    selected: '#8C2A2A',
    item: '#221E1A',
  },
  dark: {
    surface: 'rgba(255,255,255,0.04)',
    border: 'rgba(255,255,255,0.10)',
    fadeFrom: '14,11,10',
    band: 'rgba(255,76,47,0.35)',
    label: 'rgba(255,255,255,0.45)',
    selected: '#FF4C2F',
    item: 'rgba(255,255,255,0.85)',
  },
}

export function DrumPicker({
  values, labels, selected, onSelect, label, theme = 'light',
}: {
  values: (string | number)[]
  labels?: string[]
  selected: string
  onSelect: (v: string) => void
  label: string
  theme?: Theme
}) {
  const t = THEMES[theme]
  const items = values.map((v, i) => ({ value: String(v), label: labels?.[i] ?? String(v) }))
  const scrollRef = useRef<HTMLDivElement>(null)
  const [localIdx, setLocalIdx] = useState(() => Math.max(0, items.findIndex(i => i.value === selected)))
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Scroll to selection on mount / external change
  useEffect(() => {
    const idx = items.findIndex(i => i.value === selected)
    if (idx >= 0) {
      setLocalIdx(idx)
      if (scrollRef.current) {
        scrollRef.current.scrollTop = idx * ITEM_H
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  const onScroll = useCallback(() => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (!scrollRef.current) return
      const idx = Math.round(scrollRef.current.scrollTop / ITEM_H)
      const clamped = Math.max(0, Math.min(idx, items.length - 1))
      setLocalIdx(clamped)
      onSelect(items[clamped].value)
    }, 80)
  }, [items, onSelect])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
      <p style={{
        fontFamily: 'var(--font-geist-mono), monospace',
        fontSize: 9, color: t.label, letterSpacing: '1.8px',
        textTransform: 'uppercase' as const, textAlign: 'center', margin: 0,
      }}>
        {label}
      </p>

      <div style={{
        position: 'relative', background: t.surface, borderRadius: 12,
        overflow: 'hidden', border: `1px solid ${t.border}`,
        height: ITEM_H * 5,
      }}>
        {/* Fade top */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: ITEM_H * 2.2,
          background: `linear-gradient(to bottom, rgba(${t.fadeFrom},1) 40%, rgba(${t.fadeFrom},0))`,
          zIndex: 2, pointerEvents: 'none',
        }} />
        {/* Fade bottom */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: ITEM_H * 2.2,
          background: `linear-gradient(to top, rgba(${t.fadeFrom},1) 40%, rgba(${t.fadeFrom},0))`,
          zIndex: 2, pointerEvents: 'none',
        }} />
        {/* Top band */}
        <div style={{
          position: 'absolute', top: ITEM_H * 2, left: 0, right: 0,
          height: 1, background: t.band, zIndex: 3, pointerEvents: 'none',
        }} />
        {/* Bottom band */}
        <div style={{
          position: 'absolute', top: ITEM_H * 3, left: 0, right: 0,
          height: 1, background: t.band, zIndex: 3, pointerEvents: 'none',
        }} />

        {/* Scroll list */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="drum-scroll"
          style={{
            height: '100%',
            overflowY: 'scroll',
            scrollSnapType: 'y mandatory',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          } as React.CSSProperties}
        >
          {/* top spacer */}
          <div style={{ height: ITEM_H * 2, flexShrink: 0 }} />
          {items.map((item, i) => {
            const dist = Math.abs(i - localIdx)
            const isSel = dist === 0
            return (
              <div
                key={item.value}
                style={{
                  height: ITEM_H, scrollSnapAlign: 'center',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: '"Instrument Serif", Georgia, serif',
                  fontSize: isSel ? 26 : 20,
                  fontStyle: isSel ? 'italic' : 'normal',
                  color: isSel ? t.selected : t.item,
                  opacity: dist === 0 ? 1 : dist === 1 ? 0.5 : 0.25,
                  letterSpacing: '-0.07px',
                  userSelect: 'none',
                  cursor: 'pointer',
                  transition: 'font-size 0.12s, color 0.12s',
                }}
                onClick={() => {
                  onSelect(item.value)
                  scrollRef.current?.scrollTo({ top: i * ITEM_H, behavior: 'smooth' })
                }}
              >
                {item.label}
              </div>
            )
          })}
          {/* bottom spacer */}
          <div style={{ height: ITEM_H * 2, flexShrink: 0 }} />
        </div>
      </div>
    </div>
  )
}
