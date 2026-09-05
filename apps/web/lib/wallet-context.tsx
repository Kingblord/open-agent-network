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
  chain: typeof bnbChainDef
  /** Active connected account address (from Thirdweb live connection), or null. */
  activeAddress: string | null
  /** Whether a wallet is actively connected right now (live OR server-persisted). */
  isConnected: boolean
  /** Address persisted to Firestore via the server, survives across devices. */
  linkedAddress: string | null
  /** Whether we're still loading the persisted server link. */
  hydrating: boolean
  /** Persist a connected address to Firestore + local. */
  setLinkedAddress: (address: string | null) => void
  /** Disconnect both the active ThirdWeb session and the persisted server link. */
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
  const { user, updateUserWallet } = useAuth()

  // Start with localStorage for instant render, then overwrite from server.
  const [linkedAddress, setLinkedAddressState] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : readStoredWallet(),
  )
  const [hydrating, setHydrating] = useState(true)

  const chain = useMemo(() => bnbChainDef, [])
  const client = useMemo(() => {
    try { return getThirdwebClient() } catch { return null }
  }, [])

  const activeAddress = activeAccount?.address ?? null

  // On mount, fetch the server-persisted wallet (Firestore-backed).
  // This is the AUTHORITATIVE source — localStorage is a fast local cache.
  useEffect(() => {
    let cancelled = false
    setHydrating(true)

    if (user?.walletAddress) {
      // Auth user already has a wallet — use it immediately.
      setLinkedAddressState(user.walletAddress)
      writeStoredWallet(user.walletAddress)
      setHydrating(false)
      return
    }

    // No wallet on the auth user yet — ask the server.
    fetch('/api/developers/wallet', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return
        const serverWallet = data?.walletAddress ?? null
        if (serverWallet) {
          setLinkedAddressState(serverWallet)
          writeStoredWallet(serverWallet)
          updateUserWallet(serverWallet)
        } else {
          // Server has no wallet either — use local cache as fallback.
          const local = readStoredWallet()
          if (local) {
            // Local cache exists — sync it to the server.
            setLinkedAddressState(local)
            updateUserWallet(local)
            fetch('/api/developers/wallet', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ walletAddress: local }),
            }).catch(() => { /* non-fatal */ })
          }
        }
      })
      .catch(() => {
        // Server unreachable — localStorage is the fallback.
        if (!cancelled) setLinkedAddressState(readStoredWallet())
      })
      .finally(() => {
        if (!cancelled) setHydrating(false)
      })

    return () => { cancelled = true }
  }, [user?.id, updateUserWallet]) // eslint-disable-line react-hooks/exhaustive-deps

  // isConnected: true if the wallet is live-connected OR server-persisted.
  // This makes the wallet "stay connected" across devices.
  const isConnected = Boolean(activeAddress || linkedAddress)

  // When a live connection is made, immediately persist to server.
  useEffect(() => {
    if (activeAddress && activeAddress !== linkedAddress) {
      setLinkedAddressState(activeAddress)
      writeStoredWallet(activeAddress)
      updateUserWallet(activeAddress)
      // Fire-and-forget: persist to Firestore via server.
      fetch('/api/developers/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: activeAddress }),
      }).catch(() => { /* non-fatal */ })
    }
  }, [activeAddress, linkedAddress, updateUserWallet])

  const setLinkedAddress = useCallback(
    (address: string | null) => {
      setLinkedAddressState(address)
      writeStoredWallet(address)
      updateUserWallet(address)
      // Persist to Firestore.
      fetch('/api/developers/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: address }),
      }).catch(() => { /* non-fatal */ })
    },
    [updateUserWallet],
  )

  const disconnect = useCallback(async () => {
    if (activeWallet) {
      try { await thirdwebDisconnect(activeWallet) } catch { /* ignore */ }
    }
    setLinkedAddress(null)
    if (user) {
      await fetch('/api/developers/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: null }),
      }).catch(() => { /* non-fatal */ })
      updateUserWallet(null)
    }
  }, [activeWallet, thirdwebDisconnect, setLinkedAddress, user, updateUserWallet])

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
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used within a WalletProvider')
  return ctx
}