// Root route — the marketing landing (clubfuoco.com).
//
// (The BUILD_TARGET=ios branch that rendered NativeSplash for the Capacitor
// static export is gone — iOS is a fully native app now, see ios-native/.)
import WebHome from './_web/Home'

// The hero shows a live count of tonight's offers — re-render at most every
// five minutes instead of freezing the number at build time. The HypeList feed
// behind most of it only updates hourly.
export const revalidate = 300

export default function HomePage() {
  return <WebHome />
}
