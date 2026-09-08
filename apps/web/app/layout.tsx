import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Liquor Express',
  description: 'Sistema de administración — Liquor Express (JCA Soft)',
}

export const viewport: Viewport = {
  themeColor: '#17120d',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
