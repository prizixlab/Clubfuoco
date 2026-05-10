import { BottomNav } from '@/components/ui/BottomNav'
import { TopNav } from '@/components/ui/TopNav'
import { createClient } from '@/lib/supabase/server'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let accountType: 'user' | 'club' | 'dj' = 'user'
  if (user) {
    const { data } = await supabase
      .from('users')
      .select('account_type')
      .eq('id', user.id)
      .single()
    if (data?.account_type === 'club' || data?.account_type === 'dj') {
      accountType = data.account_type
    }
  }

  return (
    <>
      <TopNav showNotification />
      <div className="mt-14 pb-28">
        {children}
      </div>
      <BottomNav accountType={accountType} />
    </>
  )
}
