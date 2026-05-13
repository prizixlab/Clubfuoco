/**
 * Adds breathing room below page content so the floating nav pill
 * doesn't obscure the last item. Use on every (app) page except /explore.
 */
export default function NavSpacer() {
  return (
    <div
      style={{
        height: 'calc(env(safe-area-inset-bottom, 0px) + 88px)',
        flexShrink: 0,
      }}
      aria-hidden="true"
    />
  )
}
