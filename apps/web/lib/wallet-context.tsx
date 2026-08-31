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
  const { user, updateUserWallet } = useAuth()

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

  // Keep localStorage + state consistent with the actively connected account,
  // and reflect the connection on the auth user immediately.
  useEffect(() => {
    if (activeAddress) {
      setLinkedAddressState(activeAddress)
      writeStoredWallet(activeAddress)
      updateUserWallet(activeAddress)
    }
  }, [activeAddress, updateUserWallet])

  const setLinkedAddress = useCallback(
    (address: string | null) => {
      setLinkedAddressState(address)
      writeStoredWallet(address)
      updateUserWallet(address)
    },
    [updateUserWallet],
  )

  // Rehydrate the persisted wallet from the SERVER when the auth user loads.
  // This is the missing persistence fix: connecting on one browser (which POSTs
  // to /api/developers/wallet) must appear on any other browser/device even when
  // localStorage is empty there. We also mirror the server value into AuthUser
  // so profile headers reflect the connection without a full refresh.
  useEffect(() => {
    if (!user) {
      // When signed out, don't claim a wallet on a fresh profile.
      return
    }
    let cancelled = false

    // If the auth user already knows a wallet (post-login/profile), make sure
    // the linked state agrees with it.
    if (user.walletAddress) {
      setLinkedAddressState((prev) => prev ?? user.walletAddress!)
      writeStoredWallet(user.walletAddress)
    }

    // If we have no local link yet, ask the server for the persisted one.
    if (!user.walletAddress) {
      void fetch('/api/developers/wallet', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (cancelled) return
          const serverWallet = data?.walletAddress ?? null
          if (serverWallet) {
            setLinkedAddressState(serverWallet)
            writeStoredWallet(serverWallet)
            updateUserWallet(serverWallet)
          }
        })
        .catch(() => {
          // Non-fatal — localStorage link (if any) remains authoritative.
        })
    }

    return () => {
      cancelled = true
    }
  }, [user, updateUserWallet])

  // Best-effort sync of the linked wallet to the authenticated account so it
  // survives across sessions (not just the browser tab).
  useEffect(() => {
    if (!linkedAddress || !user) return
    void fetch('/api/developers/wallet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: linkedAddress }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        // Mirror the server-confirmed value (if any) into AuthUser so the
        // profile reflects the connection as soon as the POST settles.
        if (data?.walletAddress) {
          updateUserWallet(data.walletAddress)
        }
      })
      .catch(() => {
        // Non-fatal — wallet link stays in localStorage; server sync is best-effort.
      })
  }, [linkedAddress, user, updateUserWallet])

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
    // Also clear the server-side link so the profile stops showing it.
    if (user) {
      void fetch('/api/developers/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: null }),
      }).catch(() => {
        // Non-fatal.
      })
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