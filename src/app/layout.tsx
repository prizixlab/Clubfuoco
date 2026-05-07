import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Club Fuoco — Where the night begins before you arrive.',
  description: 'Real-time nightlife discovery for Barcelona.',
  themeColor: '#121414',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-background text-on-surface`}>
        {children}
      </body>
    </html>
  )
}
