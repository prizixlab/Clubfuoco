import type { NextConfig } from 'next'

// When building for Capacitor iOS (npm run build:ios) we generate a fully
// static bundle that the native shell loads from disk.  API routes are NOT
// available in that bundle — all data access must go via the Supabase client.
// For web / Vercel deployment, keep the default (no output override).
const isCapacitorBuild = process.env.BUILD_TARGET === 'ios'

const nextConfig: NextConfig = {
  ...(isCapacitorBuild && {
    output: 'export',
    // next/image can't be optimised at request-time in a static export
    images: { unoptimized: true },
  }),
  ...(!isCapacitorBuild && {
    images: {
      remotePatterns: [
        { protocol: 'https', hostname: 'res.cloudinary.com' },
        { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      ],
    },
    // @capacitor-community/stripe is a native-only Capacitor plugin. Its only
    // usage (membership Apple Pay flow) is guarded by Capacitor.isNativePlatform(),
    // so the web build never executes it. Alias it to an empty module so the
    // Vercel build never has to resolve the native package.
    webpack: (config: { resolve?: { alias?: Record<string, string | false> } }) => {
      config.resolve = config.resolve ?? {}
      config.resolve.alias = {
        ...config.resolve.alias,
        '@capacitor-community/stripe': false,
      }
      return config
    },
  }),
}

export default nextConfig
