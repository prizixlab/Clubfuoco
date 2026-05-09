import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/')

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['staff', 'admin'].includes(profile.role)) {
    redirect('/')
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Staff top bar */}
      <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-surface/90 backdrop-blur-xl border-b border-outline-variant/20 flex items-center px-6 gap-4">
        <div className="flex items-center gap-2">
          <span
            className="material-symbols-outlined text-[20px] text-primary"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >local_fire_department</span>
          <span className="font-bold text-on-surface tracking-widest text-sm uppercase">Club Fuoco Staff</span>
        </div>
        <span className="ml-auto text-xs text-on-surface-variant/50 uppercase tracking-widest font-semibold bg-primary/10 text-primary px-2 py-1 rounded-full">
          {profile.role}
        </span>
      </header>
      <div className="pt-14 min-h-screen">
        {children}
      </div>
    </div>
  )
}
