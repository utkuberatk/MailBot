import type { Metadata } from 'next'
import { Sidebar } from '@/components/sidebar'
import './globals.css'

export const metadata: Metadata = {
  title: 'MailBot',
  description: 'E-ticaret şirketi keşfi, AI destekli mail gönderimi ve yanıt analizi',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 overflow-x-hidden px-8 py-7">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </body>
    </html>
  )
}
