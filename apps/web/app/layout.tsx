import type { Metadata, Viewport } from 'next'
import './globals.css'
import { DialogProvider } from '../components/Dialog'

export const metadata: Metadata = {
  title: 'Liquor Express',
  description: 'Sistema de administración — Liquor Express (JCA Soft)',
}

export const viewport: Viewport = {
  themeColor: '#0c0a08',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('le_tema');if(t)document.documentElement.dataset.theme=t;}catch(e){}` }} />
        <DialogProvider>{children}</DialogProvider>
      </body>
    </html>
  )
}
