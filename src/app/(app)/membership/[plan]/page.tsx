import Content from './_client'

export function generateStaticParams() {
  return [
    { plan: 'placeholder' },
    { plan: 'gold' },
    { plan: 'sapphire' },
    { plan: 'black' },
  ]
}

export default function Page() {
  return <Content />
}
