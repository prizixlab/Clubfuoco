'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Capacitor } from '@capacitor/core'
import { createClient } from '@/lib/supabase/client'

// Handles the OAuth deep link redirect on native (com.clubfuoco.app://auth/callback?code=xxx)
// Must be rendered once at the app root level.
export default function AuthDeepLinkHandler() {
  const router = useRouter()

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    let cleanup: (() => void) | undefined

    async function setup() {
      const { App } = await import('@capacitor/app')
      const { Browser } = await import('@capacitor/browser')

      const handle = await App.addListener('appUrlOpen', async ({ url }) => {
        if (!url.startsWith('com.clubfuoco.app://auth/callback')) return

        await Browser.close()

        const parsed = new URL(url)
        const code = parsed.searchParams.get('code')

        if (code) {
          const supabase = createClient()
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          if (!error) {
            // AuthContext picks up the session change via onAuthStateChange.
            // Route to explore — the context will redirect club/dj accounts correctly.
            router.replace('/explore')
            return
          }
        }

        router.replace('/login?error=auth_callback_failed')
      })

      cleanup = () => handle.remove()
    }

    setup()
    return () => cleanup?.()
  }, [router])

  return null
}
