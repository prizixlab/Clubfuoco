'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { RUMBALIST_OFFERS, type RumbalistOffer } from '@/lib/rumbalist-offers'

// ── PartnerContext ─────────────────────────────────────────────────────────
// The active guestlist partner's brand + per-club offers, fetched from
// /api/partner at runtime so a partner switch propagates without a redeploy.
// Seeded synchronously with the current values as a fallback, so first paint
// (and offline / Capacitor cold start) is always exactly today's data.

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

  useEffect(() => {
    if (cache) return
    let alive = true
    apiFetch('/api/partner')
      .then(r => r.json())
      .then(({ data }) => {
        if (!alive || !data?.brand) return
        cache = { brand: data.brand, offersByClub: data.offersByClub ?? {} }
        setState(cache)
      })
      .catch(() => { /* keep fallback */ })
    return () => { alive = false }
  }, [])

  const getOffers = (clubId: string | null | undefined) =>
    clubId ? (state.offersByClub[clubId] ?? []) : []

  return (
    <PartnerContext.Provider value={{ brand: state.brand, offersByClub: state.offersByClub, getOffers }}>
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
  }
}
