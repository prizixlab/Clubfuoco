// Root route — chosen at BUILD TIME so each surface ships the right code.
//
//  · iOS bundle (`BUILD_TARGET=ios npx next build` → `out/index.html`)
//    Renders the existing NativeSplash with the Continue-as-guest / Sign in /
//    Create account buttons. Apple Review approved this surface; we preserve
//    it byte-for-byte. The WebHome import is dead-code-eliminated.
//
//  · Web bundle (Vercel, no BUILD_TARGET set)
//    Renders the marketing landing (clubfuoco.com). The NativeSplash import is
//    dead-code-eliminated.
//
// Because the branch is on `process.env.BUILD_TARGET`, Next.js / Webpack
// statically resolves it at build time — only one component ends up in each
// surface's bundle. No runtime check, no flicker, no risk of the iOS app
// accidentally rendering the marketing page.
import NativeSplash from './_native/Splash'
import WebHome      from './_web/Home'

export default function HomePage() {
  if (process.env.BUILD_TARGET === 'ios') return <NativeSplash />
  return <WebHome />
}
