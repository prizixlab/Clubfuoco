/**
 * API fetch helper.
 *
 * When the app runs inside Capacitor (loaded from the device, protocol = "capacitor:")
 * relative paths like "/api/clubs" would resolve to capacitor://localhost/api/clubs
 * and 404. We prefix them with the Vercel host so they always hit the real backend.
 *
 * Cross-origin requests from Capacitor don't carry cookies, so Vercel's auth
 * middleware would redirect unauthenticated. We attach the Supabase session
 * token as `Authorization: Bearer <token>` so the middleware can verify it.
 *
 * When running on Vercel itself the protocol is "https:" and relative paths work fine.
 */

function getApiBase(): string {
  if (typeof window === 'undefined') return ''                          // SSR / build
  if (window.location.protocol === 'capacitor:') {
    return 'https://clubfuoco.vercel.app'
  }
  return ''                                                             // Vercel — relative OK
}

async function getAuthHeader(): Promise<Record<string, string>> {
  if (typeof window === 'undefined') return {}
  if (window.location.protocol !== 'capacitor:') return {}
  try {
    // Dynamically import to avoid bundling Supabase into non-Capacitor paths
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
      return { Authorization: `Bearer ${session.access_token}` }
    }
  } catch { /* ignore — request will go through without auth header */ }
  return {}
}

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const url     = input.startsWith('/') ? `${getApiBase()}${input}` : input
  const authHdr = await getAuthHeader()
  const headers = Object.keys(authHdr).length
    ? { ...authHdr, ...(init?.headers ?? {}) }
    : (init?.headers ?? {})
  return fetch(url, { ...init, headers })
}
