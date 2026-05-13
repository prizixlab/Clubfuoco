'use client'

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

export type AccountType = 'user' | 'club' | 'dj'

interface AuthContextValue {
  user:        User | null
  accountType: AccountType
  /** true while the initial session + account-type check is in flight */
  loading:     boolean
}

const AuthContext = createContext<AuthContextValue>({
  user:        null,
  accountType: 'user',
  loading:     true,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,        setUser]        = useState<User | null>(null)
  const [accountType, setAccountType] = useState<AccountType>('user')
  const [loading,     setLoading]     = useState(true)

  async function resolveAccountType(userId: string) {
    try {
      const supabase = createClient()
      const { data } = await (supabase as any)
        .from('users')
        .select('account_type')
        .eq('id', userId)
        .single()
      const t = (data as any)?.account_type
      if (t === 'club' || t === 'dj') setAccountType(t)
      else setAccountType('user')
    } catch {
      setAccountType('user')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const supabase = createClient()

    // 1. Hydrate from the stored session immediately (no network call)
    supabase.auth.getSession().then(({ data: { session } }: any) => {
      const user = session?.user ?? null
      setUser(user)
      if (user) resolveAccountType(user.id)
      else setLoading(false)
    })

    // 2. React to sign-in / sign-out events
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event: any, session: any) => {
        const u = session?.user ?? null
        setUser(u)
        if (u) resolveAccountType(u.id)
        else { setAccountType('user'); setLoading(false) }
      }
    )

    return () => subscription.unsubscribe()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <AuthContext.Provider value={{ user, accountType, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
