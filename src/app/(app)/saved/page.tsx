'use client'
import { getPlaceFavorites, removePlaceFavorite } from '@/lib/supabase/queries'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import NavSpacer from '@/components/NavSpacer'

interface PlaceFavorite {
  id:          string
  place_id:    string
  name:        string
  address:     string | null
  cover_photo: string | null
  rating:      number | null
  created_at:  string
}

export default function SavedPage() {
  const [places,  setPlaces]  = useState<PlaceFavorite[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getPlaceFavorites()
      .then(d => { setPlaces(d as PlaceFavorite[]); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function remove(placeId: string) {
    setPlaces(prev => prev.filter(p => p.place_id !== placeId))
    await removePlaceFavorite(placeId)
  }

  return (
    <div className="px-container-padding pt-base pb-8">
      <h2 className="font-h2 text-h2 text-on-surface mb-md">Saved</h2>

      {loading && (
        <div className="space-y-gutter">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="glass-card rounded-xl h-24 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && places.length === 0 && (
        <div className="flex flex-col items-center justify-center py-xl text-center">
          <span className="material-symbols-outlined text-[64px] mb-md text-primary bloom-glow"
            style={{ fontVariationSettings: "'FILL' 1" }}>
            favorite
          </span>
          <p className="font-h2 text-h2 text-on-surface mb-xs">Nothing saved yet</p>
          <p className="font-body-md text-on-surface-variant max-w-[240px]">
            Tap the heart on any venue to save it here.
          </p>
          <Link href="/explore"
            className="mt-md px-md py-sm bg-primary-container text-on-primary-container font-h2 rounded-xl ignite-glow">
            Explore Venues
          </Link>
        </div>
      )}

      <div className="space-y-gutter">
        {places.map(p => (
          <div key={p.id} className="glass-card rounded-xl overflow-hidden flex items-center gap-md p-sm neon-glow">
            {/* Thumbnail */}
            <Link href={`/clubs/place/${p.place_id}`} className="flex-shrink-0">
              <div className="w-20 h-20 rounded-lg overflow-hidden bg-surface-container-high flex items-center justify-center">
                {p.cover_photo
                  ? <img src={p.cover_photo} alt={p.name} className="w-full h-full object-cover" />
                  : <span className="material-symbols-outlined text-on-surface-variant/30 text-[32px]">nightlife</span>
                }
              </div>
            </Link>

            {/* Info */}
            <Link href={`/clubs/place/${p.place_id}`} className="flex-1 min-w-0">
              <p className="font-h2 text-h2 text-on-surface truncate">{p.name}</p>
              {p.address && (
                <p className="font-body-md text-on-surface-variant text-sm truncate mt-[2px]">{p.address}</p>
              )}
              {p.rating && (
                <div className="flex items-center gap-xs mt-xs">
                  <span className="material-symbols-outlined text-yellow-400 text-[13px]"
                    style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                  <span className="font-body-md text-sm text-on-surface-variant">{p.rating.toFixed(1)}</span>
                </div>
              )}
            </Link>

            {/* Remove */}
            <button onClick={() => remove(p.place_id)}
              className="flex-shrink-0 active:scale-90 transition-transform">
              <span className="material-symbols-outlined text-primary text-[28px]"
                style={{ fontVariationSettings: "'FILL' 1" }}>
                favorite
              </span>
            </button>
          </div>
        ))}
      </div>
      <NavSpacer />
    </div>
  )
}
