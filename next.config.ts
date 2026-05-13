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
  }),
}

export default nextConfig
