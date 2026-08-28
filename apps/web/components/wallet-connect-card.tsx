'use client'

import { useEffect, useState } from 'react'
import { ConnectButton } from 'thirdweb/react'
import { useWallet } from '@/lib/wallet-context'
import { getThirdwebClient } from '@/lib/thirdweb'

/**
 * Wallet connection card used in Settings → General.
 *
 * Shows the connected + persisted wallet address. The connection is stored in
 * localStorage (ban.linkedWallet) AND synced to the account record via
 * POST /api/developers/wallet, so a user does not need to reconnect on every
 * visit/session.
 */
export function WalletConnectCard() {
  const { chain, activeAddress, linkedAddress, hydrating, disconnect, setLinkedAddress } = useWallet()
  const [serverAddress, setServerAddress] = useState<string | null>(null)

  // Load the persisted server-side wallet for the logged-in account.
  useEffect(() => {
    let cancelled = false
    fetch('/api/developers/wallet')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setServerAddress(data?.walletAddress ?? null)
      })
      .catch(() => {
        /* non-fatal */
      })
    return () => {
      cancelled = true
    }
  }, [linkedAddress])

  const displayAddress = activeAddress ?? linkedAddress ?? serverAddress ?? null

  const shortAddress = (address: string) =>
    `${address.slice(0, 6)}…${address.slice(-4)}`

  return (
    <div className="bg-[#111] rounded-xl p-5 border border-[#222]">
      <h3 className="text-[10px] font-black text-white tracking-widest uppercase mb-4">
        Connected Wallet
      </h3>

      {hydrating ? (
        <p className="text-xs text-gray-500">Checking saved wallet…</p>
      ) : displayAddress ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 bg-black/60 border border-[#222] rounded-lg">
            <div className="w-9 h-9 rounded-full bg-[#F0B90B]/15 border border-[#F0B90B]/40 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F0B90B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" />
                <path d="M16 11h.01" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-mono text-sm text-white truncate">{shortAddress(displayAddress)}</div>
              <div className="text-[10px] text-gray-500 font-mono truncate">{displayAddress}</div>
            </div>
            <div className="text-[9px] font-black uppercase tracking-wider text-emerald-400 bg-emerald-400/10 border border-emerald-400/30 rounded px-2 py-1">
              Linked
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <ConnectButton
              client={getThirdwebClient()}
              chain={chain}
              theme="dark"
              connectButton={{
                label: 'Switch wallet',
                style: {
                  background: '#F0B90B',
                  color: '#000',
                  fontWeight: 700,
                  fontSize: '10px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderRadius: '6px',
                  border: 'none',
                },
              }}
            />
          </div>

          <button
            onClick={() => {
              setLinkedAddress(null)
              void disconnect()
            }}
            className="text-[10px] font-black uppercase tracking-wider text-red-400 hover:text-red-300 border border-red-400/30 rounded px-3 py-2 hover:bg-red-400/10 transition"
          >
            Disconnect wallet
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-400 leading-relaxed">
            Connect a BNB Smart Chain wallet to authorize agents on your behalf.
            Your connection is saved, so you won&apos;t need to reconnect every time.
          </p>
          <ConnectButton
            client={getThirdwebClient()}
            chain={chain}
            theme="dark"
            connectButton={{
              label: 'Connect wallet',
              style: {
                background: '#F0B90B',
                color: '#000',
                fontWeight: 700,
                fontSize: '10px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                borderRadius: '6px',
                border: 'none',
              },
            }}
          />
        </div>
      )}
    </div>
  )
}