'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * iOS-style interactive pop gesture for the Capacitor app: a swipe that starts
 * within ~24px of the left edge and drags right far enough takes the user back.
 *
 * Mounted once in the (app) layout. Calls router.back() — Next.js will pop the
 * client history, restoring the previous screen.
 */
export default function SwipeBack() {
  const router = useRouter()

  useEffect(() => {
    const EDGE       = 26   // px from the left edge to start tracking
    const DX_TRIGGER = 80   // px right movement that fires "back"
    const DY_CANCEL  = 32   // px vertical movement that's a scroll, not a swipe

    let startX = 0
    let startY = 0
    let tracking = false

    function onStart(e: TouchEvent) {
      const t = e.touches[0]
      if (!t) return
      if (t.clientX <= EDGE) { startX = t.clientX; startY = t.clientY; tracking = true }
    }
    function onMove(e: TouchEvent) {
      if (!tracking) return
      const t = e.touches[0]
      if (!t) return
      const dx = t.clientX - startX
      const dy = Math.abs(t.clientY - startY)
      if (dy > DY_CANCEL && dy > dx) { tracking = false; return }
      if (dx > DX_TRIGGER)            { tracking = false; router.back() }
    }
    function onEnd() { tracking = false }

    window.addEventListener('touchstart',  onStart, { passive: true })
    window.addEventListener('touchmove',   onMove,  { passive: true })
    window.addEventListener('touchend',    onEnd,   { passive: true })
    window.addEventListener('touchcancel', onEnd,   { passive: true })

    return () => {
      window.removeEventListener('touchstart',  onStart)
      window.removeEventListener('touchmove',   onMove)
      window.removeEventListener('touchend',    onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [router])

  return null
}
