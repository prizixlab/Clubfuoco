'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      const { data: profile } = await supabase
        .from('users')
        .select('account_type')
        .eq('id', data.user.id)
        .single()
      const type = profile?.account_type ?? 'user'
      const home: Record<string, string> = { user: '/explore', club: '/club-dashboard', dj: '/dj-dashboard' }
      router.push(home[type] ?? '/explore')
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-container-padding bg-background">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-xl">
          <span
            className="material-symbols-outlined text-[48px] text-primary bloom-glow mb-base block"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            local_fire_department
          </span>
          <h1 className="font-display text-h1 text-primary tracking-[0.2em] uppercase">CLUB FUOCO</h1>
          <p className="font-body-md text-on-surface-variant mt-xs">Welcome back</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-gutter">
          <div className="space-y-xs">
            <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="vibe-input w-full"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-xs">
            <label className="font-label-sm text-label-sm text-on-surface-variant/60 uppercase tracking-widest">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="vibe-input w-full"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="font-body-md text-error text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-14 bg-primary-container text-on-primary-fixed-variant font-h2 text-h2 rounded-xl flex items-center justify-center ignite-glow active:scale-95 transition-all duration-200 disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Log In'}
          </button>
        </form>

        <p className="text-center font-body-md text-on-surface-variant mt-md">
          No account?{' '}
          <Link href="/signup" className="text-primary font-bold hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
