'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { RUMBALIST_OFFERS, type RumbalistOffer } from '@/lib/rumbalist-offers'

// ── PartnerContext ─────────────────────────────────────────────────────────
// Every live guestlist offer, per club, fetched from /api/partner at runtime so
// changes propagate without a redeploy. Offers come from MANY brands (any
// promoter can publish one) and each carries its own supplier for attribution —
// `brand` here is just the primary/featured supplier. Seeded synchronously with
// the bundled catalog as a fallback, so first paint (and offline / Capacitor
// cold start) always shows something.

export interface PartnerBrand {
  key:      string
  name:     string
  logo_url: string | null
  color:    string
  // Contractual supplier credit — when required, the booking sheet shows a
  // small subordinate "attribution_label name" line (e.g. "Guestlist by Rumba").
  attribution_required: boolean
  attribution_label:    string | null
}

interface PartnerValue {
  brand:        PartnerBrand
  offersByClub: Record<string, RumbalistOffer[]>
  getOffers:    (clubId: string | null | undefined) => RumbalistOffer[]
  // Re-pull the live offer set. The explore feed calls this on mount so a
  // venue gaining/losing an offer re-tiers on the next feed build without a
  // redeploy — the deal set is volatile (offers toggled daily).
  refresh:      () => void
}

const FALLBACK_BRAND: PartnerBrand = {
  key: 'clubfuoco', name: 'Club Fuoco', logo_url: null, color: '#C09950',
  attribution_required: false, attribution_label: null,
}

// Module-level cache so navigations don't re-fetch or flash the fallback.
let cache: { brand: PartnerBrand; offersByClub: Record<string, RumbalistOffer[]> } | null = null

const PartnerContext = createContext<PartnerValue | null>(null)

export function PartnerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState(() => cache ?? { brand: FALLBACK_BRAND, offersByClub: RUMBALIST_OFFERS })
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    let alive = true
    // Always fetch — even when the cache is warm — so a stale set from an
    // earlier navigation refreshes; the cache only prevents a fallback flash.
    apiFetch('/api/partner')
      .then(r => r.json())
      .then(({ data }) => {
        // `brand` is only the primary supplier and may be null; the offers
        // themselves each carry their own brand, so don't gate on it.
        if (!alive || !data) return
        cache = { brand: data.brand ?? FALLBACK_BRAND, offersByClub: data.offersByClub ?? {} }
        setState(cache)
      })
      .catch(() => { /* keep fallback */ })
    return () => { alive = false }
  }, [refreshTick])

  const getOffers = (clubId: string | null | undefined) =>
    clubId ? (state.offersByClub[clubId] ?? []) : []

  const refresh = useCallback(() => setRefreshTick(t => t + 1), [])

  return (
    <PartnerContext.Provider value={{ brand: state.brand, offersByClub: state.offersByClub, getOffers, refresh }}>
      {children}
    </PartnerContext.Provider>
  )
}

export function usePartner(): PartnerValue {
  const ctx = useContext(PartnerContext)
  if (ctx) return ctx
  // Safe default if a consumer renders outside the provider.
  return {
    brand: FALLBACK_BRAND,
    offersByClub: RUMBALIST_OFFERS,
    getOffers: (clubId) => (clubId ? (RUMBALIST_OFFERS[clubId] ?? []) : []),
    refresh: () => {},
  }
}
