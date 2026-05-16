'use client'
import { getPlaceFavorites, removePlaceFavorite } from '@/lib/supabase/queries'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
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

const C = {
  bg:      '#F8F5EE',
  surface: '#FFFFFF',
  bg2:     '#EDE8DF',
  ink:     'rgb(34,30,26)',
  ink3:    'rgb(159,148,134)',
  cream:   '#F8F5EE',
}

export default function SavedPage() {
  const router = useRouter()
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
    <div style={{ background: C.bg, minHeight: '100vh' }}>
      {/* Title */}
      <div style={{ padding: '20px 20px 16px' }}>
        <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 10, color: C.ink3, letterSpacing: '0.18em', textTransform: 'uppercase', margin: '0 0 6px' }}>
          Club Fuoco · Saved
        </p>
        <h1 style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontSize: 44, fontWeight: 400, fontStyle: 'italic', lineHeight: 1.05, letterSpacing: '-0.88px', color: C.ink, margin: '0 0 4px' }}>
          I miei locali
        </h1>
        <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 13, color: C.ink3, margin: 0 }}>
          {loading ? ' ' : places.length === 0
            ? 'No saved clubs yet'
            : `${places.length} ${places.length === 1 ? 'club saved' : 'clubs saved'}`}
        </p>
      </div>

      {/* Loading skeletons */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '0 20px' }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ height: 312, borderRadius: 18, background: 'rgba(34,30,26,0.06)' }} className="animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && places.length === 0 && (
        <div style={{ textAlign: 'center', padding: '56px 24px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: 52, color: C.ink3, opacity: 0.35, display: 'block', marginBottom: 14 }}>favorite</span>
          <p style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontStyle: 'italic', fontSize: 22, color: C.ink, margin: '0 0 6px' }}>
            Nothing saved yet
          </p>
          <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 13, color: C.ink3, margin: '0 0 20px' }}>
            Tap the heart on any club to save it here.
          </p>
          <button
            onClick={() => router.push('/explore')}
            style={{ background: C.ink, color: '#F8F5EE', border: 'none', borderRadius: 12, padding: '12px 22px', cursor: 'pointer', fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 13, fontWeight: 600 }}
          >
            Explore clubs
          </button>
        </div>
      )}

      {/* Saved clubs — full-width magazine cards */}
      {!loading && places.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '0 20px 24px' }}>
          {places.map(p => (
            <div key={p.id} style={{
              borderRadius: 18, overflow: 'hidden', background: C.surface,
              boxShadow: '0 1px 2px rgba(34,30,26,0.04), 0 10px 28px rgba(34,30,26,0.08)',
            }}>
              <div style={{ position: 'relative', height: 200, background: C.bg2 }}>
                {p.cover_photo
                  ? <img src={p.cover_photo} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 48, color: C.ink3, opacity: 0.3, fontVariationSettings: "'FILL' 1" }}>nightlife</span>
                    </div>}
                <span
                  role="button" tabIndex={0}
                  onClick={e => { e.preventDefault(); e.stopPropagation(); remove(p.place_id) }}
                  style={{ position: 'absolute', top: 12, right: 12, width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 17, color: '#E05252', fontVariationSettings: "'FILL' 1" }}>favorite</span>
                </span>
              </div>
              <div style={{ padding: '18px 20px 20px' }}>
                <h3 style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontSize: 30, fontWeight: 400, lineHeight: 1.1, letterSpacing: '-0.5px', color: C.ink, margin: '0 0 6px' }}>
                  {p.name}
                </h3>
                <p style={{ fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 13, color: C.ink3, margin: '0 0 16px', lineHeight: 1.4 }}>
                  {p.address ?? ''}
                </p>
                <button
                  onClick={() => router.push(`/clubs/place/placeholder?id=${p.place_id}`)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', height: 46, borderRadius: 12, border: 'none', cursor: 'pointer', background: C.ink, color: '#F8F5EE', fontFamily: 'Geist, -apple-system, system-ui, sans-serif', fontSize: 13, fontWeight: 600 }}
                >
                  View Club
                  <span className="material-symbols-outlined" style={{ fontSize: 17 }}>arrow_forward</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <NavSpacer />
    </div>
  )
}
