import type { OfferBrand } from '@/lib/rumbalist-offers'

/** The supplier's mark, restoring the branding it had before the swappable-
 *  partner refactor. Rumba gets the bundled wordmark masking a gloss sweep in
 *  the brand color; other suppliers get their logo, or their name in the
 *  brand color. Used on the offer buttons + booking sheet — anywhere an offer
 *  needs to read as "this comes from Rumbalist/whoever", never in app chrome. */
export function SupplierMark({ brand, size = 18, tint }: {
  brand: OfferBrand
  size?: number
  /** Repaint the mark in this color. Supplier logos are single-ink wordmarks
   *  drawn with their ink baked in, so a light mark is invisible on a light
   *  surface. Pass the surrounding text color on light cards; leave unset on
   *  dark ones, where the logo's own ink is what the supplier intended. */
  tint?: string
}) {
  if (brand.key === 'rumba') {
    const mask = 'url(/rumbalist-logo.png) no-repeat left center / contain'
    return (
      <span
        aria-label={brand.name}
        style={{
          display: 'inline-block',
          height: size,
          aspectRatio: '1600 / 325',
          verticalAlign: '-0.28em',
          backgroundImage:
            `linear-gradient(105deg, ${brand.color} 0%, ${brand.color} 38%, #FFFFFF 50%, ${brand.color} 62%, ${brand.color} 100%)`,
          backgroundSize: '260% 100%',
          backgroundPosition: '100% 0',
          WebkitMask: mask,
          mask,
          animation: 'rumbaGloss 3.4s ease-in-out infinite',
        }}
      />
    )
  }
  if (brand.logo_url) {
    if (tint) {
      // Paint the tint and clip it to the logo's own alpha. The hidden <img>
      // is what gives the span its intrinsic width — a mask alone can't size
      // its box, and hardcoding a width would letterbox every logo whose
      // aspect ratio we guessed wrong.
      const mask = {
        WebkitMaskImage: `url(${brand.logo_url})`, maskImage: `url(${brand.logo_url})`,
        WebkitMaskSize: 'contain', maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'left center', maskPosition: 'left center',
      } as const
      return (
        <span aria-label={brand.name} style={{
          display: 'inline-block', verticalAlign: '-0.28em', background: tint, ...mask,
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brand.logo_url} alt="" style={{ height: size, display: 'block', visibility: 'hidden' }} />
        </span>
      )
    }
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={brand.logo_url} alt={brand.name} style={{ height: size, verticalAlign: '-0.28em', objectFit: 'contain', maxWidth: size * 6 }} />
  }
  return <span style={{ fontWeight: 700, color: tint ?? brand.color }}>{brand.name}</span>
}

/** "#RRGGBB" → rgba() at the given alpha; passes anything else through. */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const v = parseInt(m[1], 16)
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${alpha})`
}

/** The gloss-sweep keyframes SupplierMark's Rumba variant depends on. Inject
 *  once per page that renders a SupplierMark (booking sheet, offer buttons). */
export function SupplierMarkKeyframes() {
  return (
    <style>{`@keyframes rumbaGloss {
      0%   { background-position: 100% 0; }
      55%  { background-position: -60% 0; }
      100% { background-position: -60% 0; }
    }`}</style>
  )
}
