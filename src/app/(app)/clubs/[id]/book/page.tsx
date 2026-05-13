import Content from './_client'

// generateStaticParams must return at least one entry for "output: export".
// We return a placeholder — actual routing is client-side in Capacitor.
export function generateStaticParams() {
  return [{ id: 'placeholder' }]
}

export default function Page() {
  return <Content />
}
