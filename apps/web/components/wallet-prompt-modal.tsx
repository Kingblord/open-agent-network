'use client'

import { useEffect, useState } from 'react'
import { ConnectButton } from 'thirdweb/react'
import { useWallet } from '@/lib/wallet-context'
import { useAuth } from '@/lib/auth-context'
import { getThirdwebClient } from '@/lib/thirdweb'

/**
 * Dismissal is per-tab-session (sessionStorage), not permanent. Closing the tab
 * and revisiting shows the prompt again for users who have still not connected
 * a wallet — matching the requirement "comes up whenever they close and revisit
 * the app". Once a wallet is connected (or linked), the modal never shows.
 */
const DISMISS_KEY = 'ban.walletPromptDismissed'

function readDismissed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function markDismissed() {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(DISMISS_KEY, '1')
  } catch {
    /* ignore storage errors */
  }
}

/**
 * Connect-wallet prompt shown to signed-in users who have not connected a BNB
 * Smart Chain wallet yet. The CTA triggers Thirdweb's connect modal; "Not now"
 * dismisses until the next tab session.
 */
export function WalletPromptModal() {
  const { chain, isConnected, hydrating, linkedAddress } = useWallet()
  const { user } = useAuth()
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed())

  const connected = isConnected || Boolean(linkedAddress)

  // Once connected, stop showing the prompt entirely (and clear the "nag").
  useEffect(() => {
    if (connected) setDismissed(true)
  }, [connected])

  const show = !hydrating && Boolean(user) && !connected && !dismissed

  if (!show) return null

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-background/70 p-4">
      <div className="w-full max-w-sm border-2 border-[#F0B90B]/40 bg-card rounded-xl p-6">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-[10px] font-black uppercase tracking-widest text-[#F0B90B]">
            Wallet required
          </span>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#F0B90B"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" />
            <path d="M16 11h.01" />
          </svg>
        </div>

        <h3 className="mb-2 text-lg font-black uppercase tracking-tight text-foreground">
          You have not connected your wallet yet
        </h3>
        <p className="mb-5 text-xs leading-relaxed text-muted-foreground">
          Connect a BNB Smart Chain wallet so your agents can operate with
          session-bounded authority. Your connection is saved.
        </p>

        <div className="flex flex-col gap-2">
          <ConnectButton
            client={getThirdwebClient()}
            chain={chain}
            theme="dark"
            connectButton={{
              label: 'Click here to connect your wallet',
              style: {
                background: '#F0B90B',
                color: '#000',
                fontWeight: 700,
                fontSize: '10px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                borderRadius: '6px',
                border: 'none',
                width: '100%',
              },
            }}
          />
          <button
            type="button"
            onClick={() => {
              markDismissed()
              setDismissed(true)
            }}
            className="w-full border border-border rounded px-3 py-2 text-[10px] font-black uppercase tracking-wider text-muted-foreground hover:text-foreground hover:border-accent/60 transition"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}