import { Suspense } from 'react'
import Content from './_client'

// generateStaticParams must return at least one entry for "output: export".
// Real routing is client-side in Capacitor via /groups/placeholder?id=REAL_UUID
// (searchParams read in _client), because only the placeholder is pre-built.
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
