'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function NewRumbaPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const [form, setForm] = useState({
    title:       '',
    venue_name:  '',
    event_date:  '',
    capacity:    100,
    description: '',
    dress_code:  '',
    cover_image: '',
  })

  function onChange(key: keyof typeof form, value: string | number) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const res  = await fetch('/api/rumbas', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(form),
    })
    const data = await res.json()
    setSaving(false)

    if (!res.ok) { setError(data.error ?? 'Failed to create rumba'); return }
    router.push(`/staff/rumbas/${data.data.id}`)
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-8">
        <Link href="/staff" className="text-on-surface-variant hover:text-on-surface transition-colors">
          <span className="material-symbols-outlined text-[24px]">arrow_back</span>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white">New Rumba</h1>
          <p className="text-on-surface-variant text-sm mt-0.5">Create a new guest list event</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-red-400 text-sm">{error}</div>
        )}

        {/* Title */}
        <div>
          <label className="block text-sm font-semibold text-on-surface-variant mb-1.5">Title *</label>
          <input
            type="text"
            value={form.title}
            onChange={e => onChange('title', e.target.value)}
            placeholder="e.g. Rumba Sabado Noche"
            required
            className="w-full bg-surface-container border border-outline-variant/30 rounded-xl px-4 py-3 text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/60"
          />
        </div>

        {/* Venue */}
        <div>
          <label className="block text-sm font-semibold text-on-surface-variant mb-1.5">Venue Name *</label>
          <input
            type="text"
            value={form.venue_name}
            onChange={e => onChange('venue_name', e.target.value)}
            placeholder="e.g. Club Fuoco Barcelona"
            required
            className="w-full bg-surface-container border border-outline-variant/30 rounded-xl px-4 py-3 text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/60"
          />
        </div>

        {/* Date/time */}
        <div>
          <label className="block text-sm font-semibold text-on-surface-variant mb-1.5">Event Date & Time *</label>
          <input
            type="datetime-local"
            value={form.event_date}
            onChange={e => onChange('event_date', e.target.value)}
            required
            className="w-full bg-surface-container border border-outline-variant/30 rounded-xl px-4 py-3 text-on-surface focus:outline-none focus:border-primary/60"
          />
        </div>

        {/* Capacity */}
        <div>
          <label className="block text-sm font-semibold text-on-surface-variant mb-1.5">
            Capacity
            <span className="ml-2 font-normal opacity-60">(max guests on the list)</span>
          </label>
          <input
            type="number"
            min={1}
            max={2000}
            value={form.capacity}
            onChange={e => onChange('capacity', parseInt(e.target.value, 10) || 100)}
            className="w-full bg-surface-container border border-outline-variant/30 rounded-xl px-4 py-3 text-on-surface focus:outline-none focus:border-primary/60"
          />
        </div>

        {/* Dress code */}
        <div>
          <label className="block text-sm font-semibold text-on-surface-variant mb-1.5">Dress Code</label>
          <input
            type="text"
            value={form.dress_code}
            onChange={e => onChange('dress_code', e.target.value)}
            placeholder="e.g. Smart casual, no trainers"
            className="w-full bg-surface-container border border-outline-variant/30 rounded-xl px-4 py-3 text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/60"
          />
        </div>

        {/* Cover image URL */}
        <div>
          <label className="block text-sm font-semibold text-on-surface-variant mb-1.5">Cover Image URL</label>
          <input
            type="url"
            value={form.cover_image}
            onChange={e => onChange('cover_image', e.target.value)}
            placeholder="https://…"
            className="w-full bg-surface-container border border-outline-variant/30 rounded-xl px-4 py-3 text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/60"
          />
          {form.cover_image && (
            <div className="mt-2 w-full h-32 rounded-lg overflow-hidden bg-surface-container-high">
              <img src={form.cover_image} alt="Preview" className="w-full h-full object-cover" onError={e => (e.currentTarget.style.display = 'none')} />
            </div>
          )}
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-semibold text-on-surface-variant mb-1.5">Description</label>
          <textarea
            value={form.description}
            onChange={e => onChange('description', e.target.value)}
            rows={4}
            placeholder="Tell guests what to expect…"
            className="w-full bg-surface-container border border-outline-variant/30 rounded-xl px-4 py-3 text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/60 resize-none"
          />
        </div>

        <p className="text-xs text-on-surface-variant/50">
          The rumba will be saved as a draft. Toggle it live from the manage page.
        </p>

        <div className="flex gap-3 pt-2">
          <Link
            href="/staff"
            className="flex-1 py-3 rounded-xl font-bold text-center bg-surface-container border border-outline-variant/30 text-on-surface-variant hover:border-outline-variant transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 py-3 rounded-xl font-bold bg-primary text-on-primary ignite-glow transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving
              ? <><span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span> Saving…</>
              : <><span className="material-symbols-outlined text-[18px]">add</span> Create Rumba</>
            }
          </button>
        </div>
      </form>
    </div>
  )
}
