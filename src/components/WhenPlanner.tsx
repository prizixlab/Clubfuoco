'use client'

import { useState, useRef, useEffect } from 'react'
import { usePlan } from '@/contexts/PlanContext'
import { useLocale } from '@/contexts/LocaleContext'
import { DrumPicker } from '@/components/ui/DrumPicker'
import { buildDayOptions, formatPlan } from '@/lib/plan'

// ── WhenPlanner ───────────────────────────────────────────────────────────────
// Collapsible "when are you going out?" control pinned at the top of Explore.
// Collapsed = a pill showing the resolved plan ("Tonight · 23:00"). Expanded =
// a dual iOS drum picker (Day capped at 14 days ahead, Time 20:00–04:00).

const C = {
  ink: '#221E1A',
  ink2: '#6E6356',
  ink3: '#9F9486',
  red: '#8C2A2A',
  surface: '#FFFFFF',
  pillBg: 'rgba(34,30,26,0.05)',
  line: 'rgba(34,30,26,0.08)',
}

export default function WhenPlanner() {
  const { plan, setDate } = usePlan()
  const { locale, t } = useLocale()
  const [open, setOpen] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [bodyH, setBodyH] = useState(0)

  // Measure the body's natural height so the slide animates to an exact px
  // value (no overshoot to a guessed max-height, which is what felt laggy).
  useEffect(() => {
    if (bodyRef.current) setBodyH(bodyRef.current.scrollHeight)
  }, [locale, open])

  const days = buildDayOptions(locale)
  const dayValues = days.map(d => d.value)
  const dayLabels = days.map(d => d.label)
  const resolved = formatPlan(plan, locale)

  return (
    <div style={{ margin: '0 20px 16px' }}>
      {/* Single box — the drum slides open from within, staying attached. */}
      <div style={{
        background: open ? C.surface : C.pillBg,
        border: `1px solid ${open ? C.line : 'transparent'}`,
        borderRadius: 14, overflow: 'hidden',
        transition: 'background 0.2s, border-color 0.2s',
      }}>
        {/* Header row — tap to toggle */}
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            width: '100%', padding: '9px 16px', background: 'transparent',
            border: 'none', cursor: 'pointer', textAlign: 'left',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 17, color: C.red }}>event</span>
            <span style={{
              fontFamily: 'Geist, -apple-system, system-ui, sans-serif',
              fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.ink3,
              flexShrink: 0,
            }}>
              {t('plan.goingOut')}
            </span>
            <span style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 17, fontStyle: 'italic', color: C.ink, lineHeight: 1,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {resolved}
            </span>
          </div>
          <span className="material-symbols-outlined" style={{
            fontSize: 19, color: C.ink2, flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s',
          }}>
            expand_more
          </span>
        </button>

        {/* Sliding body. The clip box snaps to the measured height instantly (a
            single reflow, no per-frame layout) while the inner content does the
            visible motion with a GPU transform + opacity — buttery on-device. */}
        <div style={{
          height: open ? bodyH : 0,
          overflow: 'hidden',
        }}>
          <div
            ref={bodyRef}
            style={{
              padding: '14px 16px 16px', borderTop: `1px solid ${C.line}`,
              transform: open ? 'translateY(0)' : 'translateY(-12px)',
              opacity: open ? 1 : 0,
              transition: 'transform 0.24s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.2s ease',
              willChange: 'transform, opacity',
            }}
          >
            <DrumPicker
              label={t('plan.day')}
              values={dayValues}
              labels={dayLabels}
              selected={plan.date}
              onSelect={setDate}
            />
            <button
              onClick={() => setOpen(false)}
              style={{
                marginTop: 14, width: '100%', padding: '11px 0', background: C.ink,
                color: '#F8F5EE', border: 'none', borderRadius: 12, cursor: 'pointer',
                fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 13,
                fontWeight: 600, letterSpacing: '0.02em',
              }}
            >
              {t('plan.done')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
