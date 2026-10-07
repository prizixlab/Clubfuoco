'use client'

import { useEffect, useState, type ImgHTMLAttributes } from 'react'

const MAX_RETRIES = 3

/** Re-request the same photo under a fresh query string — the browser never
 *  re-fetches an <img> whose src didn't change. */
function withRetry(src: string, attempt: number) {
  if (attempt === 0) return src
  return `${src}${src.includes('?') ? '&' : '?'}retry=${attempt}`
}

/** Drop-in `<img>` for venue photos that retries failed loads. Supabase
 *  Storage answers 429 once an IP spends its request budget (shared by
 *  everyone on a carrier NAT), and a plain <img> treats that — or any
 *  dropped connection — as final, leaving the card blank for the session.
 *  Mirrors the iOS app's ImageCache retry. */
export function VenuePhoto({ src, ...props }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const [attempt, setAttempt] = useState(0)

  useEffect(() => { setAttempt(0) }, [src])

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      loading="lazy"
      decoding="async"
      {...props}
      src={withRetry(src, attempt)}
      onError={(e) => {
        props.onError?.(e)
        if (attempt >= MAX_RETRIES) return
        const delay = 500 * 2 ** attempt + Math.random() * 400
        setTimeout(() => setAttempt(a => (a === attempt ? a + 1 : a)), delay)
      }}
    />
  )
}
