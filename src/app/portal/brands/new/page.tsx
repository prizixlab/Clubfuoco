'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { BrandRow } from '@/lib/partner'
import { Btn, Card, ErrorLine, Field, TextInput, api, C, font, mono } from '../../_ui'

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)

// New brand — name, key (slug, immutable after create), color. Logo, offers
// and attribution live in the editor this screen lands on.
export default function NewBrandPage() {
  const router = useRouter()
  const [name, setName]   = useState('')
  const [key, setKey]     = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [color, setColor] = useState('#C09950')
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const brand = await api<BrandRow>('/api/portal/brands', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), key, color }),
      })
      router.push(`/portal/brands/${brand.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create brand')
      setBusy(false)
    }
  }

  return (
    <Card style={{ maxWidth: 480 }}>
      <h1 style={{ margin: '0 0 18px', fontSize: 19, fontWeight: 700, fontFamily: font }}>New supplier brand</h1>
      <form onSubmit={create}>
        <Field label="Name" hint="Display name shown in the supplier credit, e.g. “Aashi”.">
          <TextInput value={name} autoFocus maxLength={60} placeholder="Aashi"
            onChange={e => {
              setName(e.target.value)
              if (!keyTouched) setKey(slugify(e.target.value))
            }} />
        </Field>
        <Field label="Key" hint="Stable slug — storage path + cache key. Cannot be changed later.">
          <TextInput value={key} maxLength={32} placeholder="aashi" style={{ fontFamily: mono }}
            onChange={e => { setKeyTouched(true); setKey(slugify(e.target.value)) }} />
        </Field>
        <Field label="Brand color" hint="Confined to the supplier’s small credit/logo — the app accent stays ember.">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input type="color" value={color} onChange={e => setColor(e.target.value.toUpperCase())}
              style={{ width: 44, height: 38, border: `1px solid ${C.line}`, borderRadius: 8, background: 'none', padding: 2, cursor: 'pointer' }} />
            <TextInput value={color} maxLength={7} style={{ width: 120, fontFamily: mono }}
              onChange={e => setColor(e.target.value.startsWith('#') ? e.target.value.toUpperCase() : `#${e.target.value.toUpperCase()}`)} />
          </div>
        </Field>
        <ErrorLine error={error} />
        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          <Btn kind="primary" type="submit" disabled={busy || !name.trim() || key.length < 2 || !/^#[0-9A-F]{6}$/i.test(color)}>
            {busy ? 'Creating…' : 'Create brand'}
          </Btn>
          <Btn kind="ghost" onClick={() => router.push('/portal')}>Cancel</Btn>
        </div>
      </form>
    </Card>
  )
}
