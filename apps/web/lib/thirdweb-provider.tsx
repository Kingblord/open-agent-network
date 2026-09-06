'use client'

import { useMemo } from 'react'
import { ThirdwebProvider as ThirdWebReactProvider, AutoConnect } from 'thirdweb/react'
import { getThirdwebClient, isThirdwebConfigured } from './thirdweb'

/**
 * Wraps the app in Thirdweb's React provider so any child can use the wallet
 * hooks (`useWallet`, `useActiveAccount`, `useDisconnect`, `ConnectButton`).
 *
 * We intentionally do NOT pass a client prop here — in Thirdweb v5 the client is
 * provided per-hook via `getThirdwebClient()`. If a client id is not configured,
 * consumers show a disabled/empty state instead of crashing.
 *
 * `AutoConnect` is the critical piece: thirdweb restores a persisted wallet
 * (localStorage) only when a ConnectButton/ConnectEmbed/AutoConnect is mounted.
 * Pages like My Agents → agent detail have no ConnectButton, so without this the
 * active account stayed null after a reload and transaction signing threw
 * "no account connected" until the user reconnected in Settings. Mounting
 * AutoConnect once at the root reconnects the last wallet on every page load.
 */
export function ThirdwebProvider({ children }: { children: React.ReactNode }) {
  const client = useMemo(
    () => (isThirdwebConfigured ? getThirdwebClient() : null),
    [],
  )
  return (
    <ThirdWebReactProvider>
      {client && <AutoConnect client={client} />}
      {children}
    </ThirdWebReactProvider>
  )
}