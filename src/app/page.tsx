import Link from 'next/link'

export default function SplashPage() {
  return (
    <div className="bg-black text-on-surface font-body-md overflow-hidden h-screen flex flex-col">
      <main className="relative flex-1 flex flex-col items-center justify-end overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 z-0">
          <div className="w-full h-full bg-gradient-to-b from-black via-[#1a0a05] to-black opacity-90" />
          <div className="absolute inset-0 glass-scrim" />
        </div>

        {/* Content */}
        <div className="relative z-10 w-full px-container-padding pb-xl flex flex-col items-center text-center">
          {/* Flame icon */}
          <div className="mb-lg bloom-glow">
            <span
              className="material-symbols-outlined text-[64px] text-primary"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              local_fire_department
            </span>
          </div>

          <h1 className="font-display text-display text-primary tracking-[0.2em] uppercase mb-base">
            CLUB FUOCO
          </h1>

          <p className="font-body-lg text-body-lg text-on-surface-variant max-w-[280px] leading-relaxed mb-xl">
            Where the night begins before you arrive.
          </p>

          <div className="w-full max-w-sm space-y-gutter">
            <Link
              href="/explore"
              className="w-full h-14 bg-primary-container text-on-primary-fixed-variant font-h2 text-h2 rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(255,76,47,0.3)] active:scale-95 transition-all duration-200"
            >
              Explore Barcelona
            </Link>
            <Link
              href="/login"
              className="w-full h-14 bg-surface-container-high/40 backdrop-blur-md border border-outline-variant/30 text-on-surface font-h2 text-h2 rounded-xl flex items-center justify-center active:scale-95 transition-all duration-200"
            >
              Log in
            </Link>
          </div>
        </div>

        {/* Bloom */}
        <div className="absolute -bottom-20 left-1/2 -translate-x-1/2 w-[150%] h-40 bg-primary/20 blur-[100px] rounded-full" />
      </main>
    </div>
  )
}
