import Content from './_client'

export function generateStaticParams() {
  return [{ plan: 'placeholder' }]
}

export default function Page() {
  return <Content />
}
