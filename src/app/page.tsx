// Root route — the marketing landing (clubfuoco.com).
//
// (The BUILD_TARGET=ios branch that rendered NativeSplash for the Capacitor
// static export is gone — iOS is a fully native app now, see ios-native/.)
import WebHome from './_web/Home'

export default function HomePage() {
  return <WebHome />
}
