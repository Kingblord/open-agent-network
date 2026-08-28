'use client'

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from 'react'
import { useActiveAccount, useActiveWallet, useDisconnect } from 'thirdweb/react'
import { useAuth } from './auth-context'
import { getThirdwebClient, bnbChainDef } from './thirdweb'

const STORAGE_KEY = 'ban.linkedWallet'

interface WalletContextValue {
  /** Configured chain (BNB Smart Chain, chainId 56). */
  chain: typeof bnbChainDef
  /** Always the active connected account address (from Thirdweb), or null. */
  activeAddress: string | null
  /** Whether a wallet is actively connected right now. */
  isConnected: boolean
  /** Address persisted locally for the session/user (survives refresh). */
  linkedAddress: string | null
  /** Whether we're still rehydrating the persisted link on mount. */
  hydrating: boolean
  /** Persist a connected address for the account (idempotent). */
  setLinkedAddress: (address: string | null) => void
  /** Disconnect both the active ThirdWeb session and the persisted link. */
  disconnect: () => Promise<void>
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined)

function readStoredWallet(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as { address?: string }) : null
    return parsed?.address ?? null
  } catch {
    return null
  }
}

function writeStoredWallet(address: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (address) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ address }))
    } else {
      window.localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    /* ignore storage errors */
  }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const activeAccount = useActiveAccount()
  const activeWallet = useActiveWallet()
  const { disconnect: thirdwebDisconnect } = useDisconnect()
  const { user } = useAuth()

  // Persistent link rehydrated from localStorage (survives refresh so the user
  // doesn't need to reconnect all the time).
  const [linkedAddress, setLinkedAddressState] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : readStoredWallet(),
  )
  const [hydrating, setHydrating] = useState(true)

  const chain = useMemo(() => bnbChainDef, [])
  // Keep a client reference so consumers that only reach the hook can connect
  // without re-instantiating; unused in the default flow but stable.
  const client = useMemo(() => {
    try {
      return getThirdwebClient()
    } catch {
      return null
    }
  }, [])

  const activeAddress = activeAccount?.address ?? null
  const isConnected = Boolean(activeAddress)

  // Mark hydration complete on mount (after the first paint).
  useEffect(() => {
    setHydrating(false)
  }, [])

  // Keep localStorage + state consistent with the actively connected account.
  useEffect(() => {
    if (activeAddress) {
      setLinkedAddressState(activeAddress)
      writeStoredWallet(activeAddress)
    }
  }, [activeAddress])

  const setLinkedAddress = useCallback((address: string | null) => {
    setLinkedAddressState(address)
    writeStoredWallet(address)
  }, [])

  // Best-effort sync of the linked wallet to the authenticated account so it
  // survives across sessions (not just the browser tab).
  useEffect(() => {
    if (!linkedAddress || !user) return
    void fetch('/api/developers/wallet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: linkedAddress }),
    }).catch(() => {
      // Non-fatal — wallet link stays in localStorage; server sync is best-effort.
    })
  }, [linkedAddress, user])

  const disconnect = useCallback(async () => {
    // Disconnect the active Thirdweb wallet session (if any).
    if (activeWallet) {
      try {
        await thirdwebDisconnect(activeWallet)
      } catch {
        // Ignore — we still clear the persisted link locally.
      }
    }
    // Forget any persisted link for this session/user.
    setLinkedAddress(null)
  }, [activeWallet, thirdwebDisconnect, setLinkedAddress])

  const value: WalletContextValue = {
    chain,
    activeAddress,
    isConnected,
    linkedAddress,
    hydrating,
    setLinkedAddress,
    disconnect,
  }

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  )
}

export function useWallet() {
  const context = useContext(WalletContext)
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider')
  }
  return context
}