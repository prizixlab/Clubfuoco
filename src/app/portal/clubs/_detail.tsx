'use client'

import { useEffect, useMemo, useState } from 'react'
import { Btn, ErrorLine, Field, Modal, SectionLabel, TextInput, api, C, caps, font, mono } from '../_ui'

// Full club row — loose typing (the clubs table has many Google/sync columns
// we only read). The editable subset is spelled out in the form below.
type Club = Record<string, unknown> & { id: string; name: string }

// Detail / edit modal for one club. Loads the full row, edits the operator-owned
// fields, shows the Google/sync-managed fields read-only, and PATCHes only what
// changed (so an unapplied column never gets written, same pattern as the brand
// editor).
export default function ClubDetailModal({ clubId, onClose, onSaved }: {
  clubId: string; onClose: () => void; onSaved: () => void
}) {
  const [club, setClub]   = useState<Club | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<Club>(`/api/portal/clubs/${clubId}`)
      .then(setClub)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load club'))
  }, [clubId])

  return (
    <Modal onClose={onClose} width={680}>
      {!club && !error && <p style={{ color: C.dim, fontFamily: font, fontSize: 14, margin: 0 }}>Loading…</p>}
      <ErrorLine error={error} />
      {club && (
        // key by id so a different club remounts (re-seeds fields); after a save
        // we re-seed the baseline with the returned row so the form resettles to
        // "No changes" and shows the saved confirmation.
        <ClubForm key={club.id} club={club} onClose={onClose}
          onSavedRow={row => { setClub(row); onSaved() }} />
      )}
    </Modal>
  )
}

const str = (v: unknown) => (v == null ? '' : String(v))
const numOrNull = (s: string): number | null => {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function ClubForm({ club, onClose, onSavedRow }: { club: Club; onClose: () => void; onSavedRow: (row: Club) => void }) {
  // Editable field state, seeded from the loaded row.
  const [name, setName]               = useState(str(club.name))
  const [slug, setSlug]               = useState(str(club.slug))
  const [description, setDescription] = useState(str(club.description))
  const [address, setAddress]         = useState(str(club.address))
  const [neighborhood, setNeighborhood] = useState(str(club.neighborhood))
  const [lat, setLat]                 = useState(str(club.lat))
  const [lng, setLng]                 = useState(str(club.lng))
  const [cover, setCover]             = useState(str(club.cover_image_url))
  const [genres, setGenres]           = useState(Array.isArray(club.music_genres) ? (club.music_genres as string[]).join(', ') : '')
  const [capacity, setCapacity]       = useState(str(club.max_capacity))
  const [entry, setEntry]             = useState(str(club.general_entry_price))
  const [vipMin, setVipMin]           = useState(str(club.vip_table_min_spend))
  const [instagram, setInstagram]     = useState(str(club.instagram_handle))
  const [whatsapp, setWhatsapp]       = useState(str(club.whatsapp_link))
  const [isActive, setIsActive]       = useState(!!club.is_active)
  const [isFeatured, setIsFeatured]   = useState(!!club.is_featured)
  const [isPartner, setIsPartner]     = useState(!!club.is_partner)

  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Diff against the loaded row — send only what changed.
  const patch = useMemo(() => {
    const p: Record<string, unknown> = {}
    const genreArr = genres.split(',').map(g => g.trim()).filter(Boolean)
    const origGenres = Array.isArray(club.music_genres) ? (club.music_genres as string[]) : []

    if (name.trim() !== str(club.name)) p.name = name.trim()
    if (slug.trim() !== str(club.slug)) p.slug = slug.trim()
    if (description.trim() !== str(club.description)) p.description = description.trim() || null
    if (address.trim() !== str(club.address)) p.address = address.trim() || null
    if (neighborhood.trim() !== str(club.neighborhood)) p.neighborhood = neighborhood.trim() || null
    if (numOrNull(lat) !== (club.lat ?? null)) p.lat = numOrNull(lat)
    if (numOrNull(lng) !== (club.lng ?? null)) p.lng = numOrNull(lng)
    if (cover.trim() !== str(club.cover_image_url)) p.cover_image_url = cover.trim() || null
    if (JSON.stringify(genreArr) !== JSON.stringify(origGenres)) p.music_genres = genreArr.length ? genreArr : null
    if (numOrNull(capacity) !== (club.max_capacity ?? null)) p.max_capacity = numOrNull(capacity)
    if (numOrNull(entry) !== (club.general_entry_price ?? null)) p.general_entry_price = numOrNull(entry)
    if (numOrNull(vipMin) !== (club.vip_table_min_spend ?? null)) p.vip_table_min_spend = numOrNull(vipMin)
    if (instagram.trim() !== str(club.instagram_handle)) p.instagram_handle = instagram.trim() || null
    if (whatsapp.trim() !== str(club.whatsapp_link)) p.whatsapp_link = whatsapp.trim() || null
    if (isActive !== !!club.is_active) p.is_active = isActive
    if (isFeatured !== !!club.is_featured) p.is_featured = isFeatured
    if (isPartner !== !!club.is_partner) p.is_partner = isPartner
    return p
  }, [club, name, slug, description, address, neighborhood, lat, lng, cover, genres,
      capacity, entry, vipMin, instagram, whatsapp, isActive, isFeatured, isPartner])

  const dirty = Object.keys(patch).length > 0

  async function save() {
    if (!dirty || busy) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const updated = await api<Club>(`/api/portal/clubs/${club.id}`, { method: 'PATCH', body: JSON.stringify(patch) })
      setSaved(true)
      // Re-seed the baseline with the saved row → field values now equal the
      // baseline → the diff empties, the button resettles, "Saved" shows.
      onSavedRow(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const half: React.CSSProperties = { flex: 1, minWidth: 150 }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: C.text, fontFamily: font }}>{str(club.name) || 'Club'}</h2>
        <span style={{ fontFamily: mono, fontSize: 11, color: C.faint }}>{club.id.slice(0, 8)}</span>
      </div>

      {/* ── Identity ─────────────────────────────────────────────────────── */}
      <div style={{ marginTop: 18 }}><SectionLabel>Identity</SectionLabel></div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={half}><Field label="Name"><TextInput value={name} maxLength={120} onChange={e => setName(e.target.value)} /></Field></div>
        <div style={half}><Field label="Slug" hint="URL slug — must be unique."><TextInput value={slug} maxLength={120} style={{ fontFamily: mono, fontSize: 13 }} onChange={e => setSlug(e.target.value)} /></Field></div>
      </div>
      <Field label="Description">
        <textarea value={description} maxLength={4000} onChange={e => setDescription(e.target.value)}
          rows={3} className="cfp-input"
          style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,0.35)', color: C.text, border: `1px solid ${C.line}`, borderRadius: 4, padding: '11px 12px', fontSize: 14, fontFamily: font, resize: 'vertical' }} />
      </Field>

      {/* ── Location ─────────────────────────────────────────────────────── */}
      <SectionLabel>Location</SectionLabel>
      <Field label="Address"><TextInput value={address} maxLength={300} onChange={e => setAddress(e.target.value)} /></Field>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={half}><Field label="Neighborhood"><TextInput value={neighborhood} maxLength={120} onChange={e => setNeighborhood(e.target.value)} /></Field></div>
        <div style={half}><Field label="Latitude"><TextInput value={lat} onChange={e => setLat(e.target.value)} style={{ fontFamily: mono, fontSize: 13 }} /></Field></div>
        <div style={half}><Field label="Longitude"><TextInput value={lng} onChange={e => setLng(e.target.value)} style={{ fontFamily: mono, fontSize: 13 }} /></Field></div>
      </div>

      {/* ── Media & vibe ─────────────────────────────────────────────────── */}
      <SectionLabel>Media &amp; vibe</SectionLabel>
      <Field label="Cover image URL" hint="Leave blank to clear.">
        <TextInput value={cover} onChange={e => setCover(e.target.value)} placeholder="https://…" />
      </Field>
      {cover.trim() && (
        <div style={{ margin: '-8px 0 16px', height: 90, borderRadius: 6, overflow: 'hidden', border: `1px solid ${C.line}`, background: 'rgba(0,0,0,0.4)' }}>
          <img src={cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => (e.currentTarget.style.display = 'none')} />
        </div>
      )}
      <Field label="Music genres" hint="Comma-separated, e.g. “Reggaeton, Hip Hop, House”.">
        <TextInput value={genres} onChange={e => setGenres(e.target.value)} placeholder="Reggaeton, Hip Hop, House" />
      </Field>

      {/* ── Pricing & capacity ───────────────────────────────────────────── */}
      <SectionLabel>Pricing &amp; capacity</SectionLabel>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={half}><Field label="General entry (€)"><TextInput type="number" min={0} value={entry} onChange={e => setEntry(e.target.value)} style={{ fontFamily: mono, fontSize: 13 }} /></Field></div>
        <div style={half}><Field label="VIP table min spend (€)"><TextInput type="number" min={0} value={vipMin} onChange={e => setVipMin(e.target.value)} style={{ fontFamily: mono, fontSize: 13 }} /></Field></div>
        <div style={half}><Field label="Max capacity"><TextInput type="number" min={1} value={capacity} onChange={e => setCapacity(e.target.value)} style={{ fontFamily: mono, fontSize: 13 }} /></Field></div>
      </div>

      {/* ── Social ───────────────────────────────────────────────────────── */}
      <SectionLabel>Social</SectionLabel>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={half}><Field label="Instagram handle"><TextInput value={instagram} maxLength={120} onChange={e => setInstagram(e.target.value)} placeholder="@venue" /></Field></div>
        <div style={half}><Field label="WhatsApp link"><TextInput value={whatsapp} maxLength={300} onChange={e => setWhatsapp(e.target.value)} placeholder="https://wa.me/…" /></Field></div>
      </div>

      {/* ── Visibility flags ─────────────────────────────────────────────── */}
      <SectionLabel>Visibility</SectionLabel>
      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginBottom: 8 }}>
        <Toggle label="Active" checked={isActive} onChange={setIsActive} hint="Shows in the app catalog" />
        <Toggle label="Featured" checked={isFeatured} onChange={setIsFeatured} hint="Boosted in listings" />
        <Toggle label="Partner" checked={isPartner} onChange={setIsPartner} hint="Marked as a partner venue" />
      </div>

      {/* ── Read-only: synced from Google / system ───────────────────────── */}
      <ReadOnlyMeta club={club} />

      <ErrorLine error={error} />
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, marginTop: 20,
        position: 'sticky', bottom: -28, background: C.card, padding: '14px 0 2px',
        borderTop: `1px solid ${C.line}`,
      }}>
        <Btn kind="primary" onClick={save} disabled={!dirty || busy || !name.trim() || !slug.trim()}>
          {busy ? 'Saving…' : dirty ? 'Save changes' : 'No changes'}
        </Btn>
        <Btn kind="ghost" onClick={onClose}>Close</Btn>
        {saved && !dirty && <span style={{ ...caps, fontSize: 10.5, color: C.green }}>● Saved</span>}
      </div>
    </div>
  )
}

function Toggle({ label, checked, onChange, hint }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ width: 17, height: 17, accentColor: C.gold, cursor: 'pointer', marginTop: 1 }} />
      <span>
        <span style={{ display: 'block', fontSize: 14, fontFamily: font, color: C.text }}>{label}</span>
        {hint && <span style={{ display: 'block', fontSize: 11, color: C.faint, fontFamily: font }}>{hint}</span>}
      </span>
    </label>
  )
}

// Google/sync-managed fields, shown read-only so the operator can see the full
// picture without risking the automated data.
function ReadOnlyMeta({ club }: { club: Club }) {
  const fmt = (v: unknown) => {
    if (v == null) return '—'
    const d = new Date(String(v))
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }
  const photoCount = (Array.isArray(club.photos) ? club.photos.length : 0) + (Array.isArray(club.gallery_urls) ? club.gallery_urls.length : 0)
  const rows: [string, React.ReactNode][] = [
    ['Rating', club.rating != null ? `★ ${club.rating} (${str(club.ratings_total) || 0})` : '—'],
    ['Google place ID', str(club.google_place_id) || '—'],
    ['Photos on file', String(photoCount)],
    ['Last synced', fmt(club.last_synced_at ?? club.places_synced_at)],
    ['Created', fmt(club.created_at)],
  ]
  return (
    <>
      <SectionLabel>Synced data (read-only)</SectionLabel>
      <div style={{ background: 'rgba(0,0,0,0.25)', border: `1px solid ${C.line}`, borderRadius: 8, padding: '6px 14px', marginBottom: 6 }}>
        {rows.map(([k, v], i) => (
          <div key={k} style={{
            display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 0',
            borderTop: i === 0 ? 'none' : `1px solid ${C.line}`, fontFamily: font, fontSize: 12.5,
          }}>
            <span style={{ color: C.dim }}>{k}</span>
            <span style={{ color: C.text, fontFamily: mono, fontSize: 11.5, maxWidth: '62%', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
          </div>
        ))}
      </div>
      {Array.isArray(club.opening_hours) && (club.opening_hours as string[]).length > 0 && (
        <details style={{ marginBottom: 8 }}>
          <summary style={{ ...caps, color: C.dim, cursor: 'pointer', padding: '6px 0', letterSpacing: '0.12em' }}>Opening hours</summary>
          <div style={{ padding: '4px 2px' }}>
            {(club.opening_hours as string[]).map((h, i) => (
              <p key={i} style={{ margin: '3px 0', fontSize: 12, color: C.dim, fontFamily: font }}>{h}</p>
            ))}
          </div>
        </details>
      )}
    </>
  )
}
