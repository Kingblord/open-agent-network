'use client'

import { createThirdwebClient } from 'thirdweb'
import { bsc } from 'thirdweb/chains'

// Client-side Thirdweb client. Vite/Next will inline NEXT_PUBLIC_ vars at build
// time. When the client id is not configured we return a client that only works
// for static/public reads — never for wallet/account flows.
const publicClientId = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID

const configured = typeof publicClientId === 'string' && publicClientId.length > 0

/** True when a real thirdweb client id is configured (wallet flows usable). */
export const isThirdwebConfigured = configured;

// BNB Smart Chain mainnet (chainId 56). We start from thirdweb's canonical
// chain definition and override the RPC (so local/dev can point at a custom
// endpoint). Thirdweb v5 ChainOptions expects `rpc` to be a single string, so
// we override it with a single endpoint, not an array.
export const bnbChainDef = {
  ...bsc,
  rpc:
    process.env.NEXT_PUBLIC_BAN_RPC_URL || 'https://bsc-dataseed1.binance.org',
}

// Client-safe factory. Used by the wallet provider for Connect/ActiveAccount.
export function getThirdwebClient() {
  if (!configured) {
    // No client id configured — return a client so the UI can render a disabled
    // state rather than crash. Actually using connect will throw.
    return createThirdwebClient({ clientId: 'unconfigured' })
  }
  return createThirdwebClient({ clientId: publicClientId as string })
}