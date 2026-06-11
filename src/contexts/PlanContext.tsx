'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { type Plan, defaultPlan, isValidPlanDate } from '@/lib/plan'

// ── PlanContext ───────────────────────────────────────────────────────────────
// Holds the user's "when are you going out" selection (the night/day), set from
// the WhenPlanner on Explore and read by the booking page to pre-fill the date.
// Persisted to localStorage so it survives navigation and relaunches.

const STORAGE_KEY = 'cf-plan'

interface PlanContextValue {
  plan: Plan
  setPlan: (plan: Plan) => void
  setDate: (date: string) => void
}

const PlanContext = createContext<PlanContextValue | null>(null)

function loadPlan(): Plan {
  if (typeof window === 'undefined') return defaultPlan()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Plan>
      // Stored date may have gone stale (past day) — fall back to today.
      if (parsed.date && isValidPlanDate(parsed.date)) {
        return { date: parsed.date }
      }
    }
  } catch {
    /* ignore malformed storage */
  }
  return defaultPlan()
}

export function PlanProvider({ children }: { children: React.ReactNode }) {
  const [plan, setPlanState] = useState<Plan>(() => defaultPlan())

  // Hydrate from storage on mount (client-only to avoid SSR mismatch).
  useEffect(() => {
    setPlanState(loadPlan())
  }, [])

  const persist = useCallback((next: Plan) => {
    setPlanState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, [])

  const setDate = useCallback((date: string) => persist({ ...plan, date }), [plan, persist])

  return (
    <PlanContext.Provider value={{ plan, setPlan: persist, setDate }}>
      {children}
    </PlanContext.Provider>
  )
}

export function usePlan(): PlanContextValue {
  const ctx = useContext(PlanContext)
  if (!ctx) throw new Error('usePlan must be used within a PlanProvider')
  return ctx
}
