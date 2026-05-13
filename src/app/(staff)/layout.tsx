'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { createClient } from '@/lib/supabase/client'

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [role,        setRole]        = useState<string | null>(null)
  const [roleLoading, setRoleLoading] = useState(true)

  // Guard: must be authenticated + have staff/admin role
  useEffect(() => {
    if (loading) return
    if (!user) { router.replace('/'); return }

    const supabase = createClient()
    ;(supabase as any)
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()
      .then(({ data }: any) => {
        const r = data?.role ?? null
        if (!r || !['staff', 'admin'].includes(r)) {
          router.replace('/')
        } else {
          setRole(r)
        }
        setRoleLoading(false)
      })
  }, [user, loading, router])

  if (loading || roleLoading || !role) return null

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-surface/90 backdrop-blur-xl border-b border-outline-variant/20 flex items-center px-6 gap-4">
        <div className="flex items-center gap-2">
          <span
            className="material-symbols-outlined text-[20px] text-primary"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >local_fire_department</span>
          <span className="font-bold text-on-surface tracking-widest text-sm uppercase">Club Fuoco Staff</span>
        </div>
        <span className="ml-auto text-xs text-on-surface-variant/50 uppercase tracking-widest font-semibold bg-primary/10 text-primary px-2 py-1 rounded-full">
          {role}
        </span>
      </header>
      <div className="pt-14 min-h-screen">
        {children}
      </div>
    </div>
  )
}
