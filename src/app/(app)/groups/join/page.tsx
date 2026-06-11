'use client'
import { apiFetch } from '@/lib/api'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

// Resolves an invite code (?code=ABC123) to its group, then redirects into the
// group screen where the user RSVPs / pays. Reads the query from window.location
// to avoid the useSearchParams() static-export Suspense requirement.
export default function JoinByCode() {
  const router = useRouter()
  const [error, setError] = useState('')

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code')
    if (!code) { setError('Missing invite code'); return }
    apiFetch(`/api/groups/code/${encodeURIComponent(code)}`)
      .then(r => r.json())
      .then(d => {
        if (d?.data?.id) router.replace(`/groups/placeholder?id=${d.data.id}`)
        else setError(d?.error ?? 'Invite not found')
      })
      .catch(() => setError('Could not open this invite'))
  }, [router])

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-container-padding">
      <p className={`font-body-md text-center ${error ? 'text-error' : 'text-on-surface-variant'}`}>
        {error || 'Opening invite…'}
      </p>
    </div>
  )
}
