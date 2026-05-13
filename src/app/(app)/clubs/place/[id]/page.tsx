import { Suspense } from 'react'
import Content from './_client'

// generateStaticParams must return at least one entry for "output: export".
// We return a placeholder — actual routing is client-side in Capacitor via
// /clubs/place/placeholder?id=REAL_UUID (searchParams read in _client).
export function generateStaticParams() {
  return [{ id: 'placeholder' }]
}

export default function Page() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  )
}
