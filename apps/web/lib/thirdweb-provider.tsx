'use client'

import { ThirdwebProvider as ThirdWebReactProvider } from 'thirdweb/react'

/**
 * Wraps the app in Thirdweb's React provider so any child can use the wallet
 * hooks (`useWallet`, `useActiveAccount`, `useDisconnect`, `ConnectButton`).
 *
 * We intentionally do NOT pass a client prop here — in Thirdweb v5 the client is
 * provided per-hook via `getThirdwebClient()`. If a client id is not configured,
 * consumers show a disabled/empty state instead of crashing.
 */
export function ThirdwebProvider({ children }: { children: React.ReactNode }) {
  return <ThirdWebReactProvider>{children}</ThirdWebReactProvider>
}