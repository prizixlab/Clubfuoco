import '../_web/site.css'
import '../_web/investors.css'
import InvestorsGate    from './_gate'
import InvestorsContent from './_content'
import { INVESTORS_COOKIE, tokenIsValid } from '@/lib/investors-access'
import { cookies } from 'next/headers'

// The gate is enforced HERE, on the server, before anything renders. A locked
// visitor is sent the form and nothing else — the metrics and copy in
// _content.tsx never reach their browser, and the access code never leaves the
// server (see src/lib/investors-access.ts). The old version compared the code
// inside a client component, which shipped it in the page JS.
//
// Deliberately not middleware: the gate needs to render a form on the same
// URL, and keeping the check next to the content makes it hard to bypass by
// adding a route later.

export const dynamic = 'force-dynamic'   // cookie-dependent; never prerender

export default async function InvestorsPage() {
  if (process.env.BUILD_TARGET === 'ios') return null

  const jar = await cookies()
  const unlocked = tokenIsValid(jar.get(INVESTORS_COOKIE)?.value)

  return unlocked ? <InvestorsContent /> : <InvestorsGate />
}
