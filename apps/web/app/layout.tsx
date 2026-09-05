import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'
import { AuthProvider } from '@/lib/auth-context'
import { ThirdwebProvider } from '@/lib/thirdweb-provider'
import { WalletProvider } from '@/lib/wallet-context'
import { ToastProvider } from '@/components/toast-provider'
import { WalletPromptModal } from '@/components/wallet-prompt-modal'
import { ThemeInit } from '@/components/theme-init'

export const metadata: Metadata = {
  title: 'BAN — BNB Agent Network | Smart Money Marketplace',
  description: 'Hire and deploy AI agents on the decentralized network',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  // Let the active theme (dark/light) drive the browser chrome color instead of
  // forcing dark permanently. ThemeInit sets `colorScheme` on <html> at runtime.
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#1a1a1a' },
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    // ThemeInit (client) owns the active theme: it reads 'oan-theme-v1' or the
    // system preference and applies `.light`/`.dark` to <html> on every page.
    // Keep `dark` as the pre-hydration default so the first paint never flashes
    // light, then ThemeInit reconciles to the persisted theme.
    <html lang="en" className="dark bg-background" suppressHydrationWarning>
      <body className="antialiased">
        <AuthProvider>
          <ThirdwebProvider>
            <WalletProvider>
              <ToastProvider>
                {children}
              </ToastProvider>
              <WalletPromptModal />
            </WalletProvider>
          </ThirdwebProvider>
        </AuthProvider>
        <ThemeInit />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}