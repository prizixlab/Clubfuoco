// ── Schedule-ahead helpers ────────────────────────────────────────────────────
// Shared by WhenPlanner (Explore) and the booking page. A "plan" is the night
// the user intends to go out: a calendar day, capped 14 days ahead.

export const MAX_DAYS_AHEAD = 14

// Locale used for day labels. Mirrors the app's LocaleContext values.
type PlanLocale = 'en' | 'es'
const INTL_LOCALE: Record<PlanLocale, string> = { en: 'en-GB', es: 'es-ES' }

// Local YYYY-MM-DD (avoids UTC off-by-one from toISOString()).
export function toDateValue(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export interface DayOption { value: string; label: string }

// Today → today + MAX_DAYS_AHEAD (inclusive) = 15 entries.
export function buildDayOptions(locale: PlanLocale = 'en'): DayOption[] {
  const out: DayOption[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = 0; i <= MAX_DAYS_AHEAD; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    let label: string
    if (i === 0) label = locale === 'es' ? 'Esta noche' : 'Tonight'
    else if (i === 1) label = locale === 'es' ? 'Mañana' : 'Tomorrow'
    else label = d.toLocaleDateString(INTL_LOCALE[locale], { weekday: 'short', day: 'numeric', month: 'short' })
    out.push({ value: toDateValue(d), label })
  }
  return out
}

export interface Plan { date: string }

export function defaultPlan(): Plan {
  return { date: toDateValue(new Date()) }
}

export function isValidPlanDate(value: string): boolean {
  const opts = buildDayOptions()
  return opts.some(o => o.value === value)
}

// Human label, e.g. "Tonight" or "Sat 14 Jun".
export function formatPlan(plan: Plan, locale: PlanLocale = 'en'): string {
  const day = buildDayOptions(locale).find(d => d.value === plan.date)
  return day?.label ?? plan.date
}
