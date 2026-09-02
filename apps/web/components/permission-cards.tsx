'use client'

import { useCallback, useEffect, useState } from 'react'
import { useActiveAccount } from 'thirdweb/react'
import { useWallet } from '@/lib/wallet-context'
import { useToast } from '@/components/toast-provider'
import { LoadingButton } from '@/components/ui/loading-button'
import { eip7702Digest, BAN_MAINNET_CHAIN_ID } from '@ban/eip7702'
import type { AgentPermission } from '@ban/schemas'

/**
 * Permission cards — user-funds (EIP-7702) authorization records for one agent.
 *
 * Reads the CALLER'S OWN records via GET /api/permissions and renders status,
 * scope (protocols/functions/tokens), spend ceilings, validity, and nonce.
 *
 * PENDING → ACTIVE ONLY after the user signs the one-time authorization digest
 * in their connected wallet. The digest is the SAME one the server recovers
 * (`@ban/eip7702` eip7702Digest: keccak(chain 56 ‖ impl address ‖ nonce)); the
 * wallet's EIP-191 (personal_sign) signature over that digest is verified
 * server-side by the activate route (which accepts the raw-digest form from
 * the hermetic tests AND the EIP-191 form from thirdweb). Nothing executes
 * without that verification. ACTIVE → REVOKE is terminal (one-shot).
 *
 * Fail-closed honesty: activation is disabled unless a client-side EIP-7702
 * impl address is configured (NEXT_PUBLIC_BAN_EIP7702_IMPL_ADDRESS) and a
 * wallet is connected. We never show a fabricated signature or a fake
 * "activated" state.
 */

interface PermissionCardsProps {
  agentId: string
}

/** Client-side EIP-7702 implementation address (BAN mainnet permission impl). */
const IMPL_ADDRESS = process.env.NEXT_PUBLIC_BAN_EIP7702_IMPL_ADDRESS ?? ''
const CHAIN_ID = BAN_MAINNET_CHAIN_ID // 56 — mainnet only

function shortAddr(a: string | undefined | null): string {
  if (!a) return '—'
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function statusColor(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return 'text-emerald-500 border-emerald-500/40 bg-emerald-500/10 dark:text-emerald-400'
    case 'PENDING':
      return 'text-amber-500 border-amber-500/40 bg-amber-500/10 dark:text-amber-400'
    case 'REVOKED':
      return 'text-red-500 border-red-500/40 bg-red-500/10 dark:text-red-400'
    default:
      return 'text-muted-foreground border-border bg-muted'
  }
}

function expiresLabel(p: AgentPermission): string {
  if (!p.validUntil) return '—'
  const t = new Date(p.validUntil).getTime()
  if (Number.isNaN(t)) return '—'
  if (t <= Date.now()) return 'Expired'
  return new Date(p.validUntil).toLocaleString()
}

/** The authorization tuple fields the digest binds (chain, impl, nonce). */
interface AuthTuple {
  chainId: string
  address: string
  nonce: string
}

export function PermissionCards({ agentId }: PermissionCardsProps) {
  const activeAccount = useActiveAccount()
  const { activeAddress } = useWallet()
  const { success, error: toastError } = useToast()

  const [permissions, setPermissions] = useState<AgentPermission[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [signError, setSignError] = useState<string | null>(null)

  const connectedAddress = activeAccount?.address ?? activeAddress ?? null
  const canActivate = Boolean(connectedAddress) && IMPL_ADDRESS.length > 0

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/permissions?agentId=${encodeURIComponent(agentId)}`, {
        cache: 'no-store',
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok) {
        setPermissions((data.permissions ?? []) as AgentPermission[])
      } else {
        setPermissions([])
      }
    } catch {
      setPermissions([])
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => {
    void load()
  }, [load])

  const handleRevoke = useCallback(
    async (permissionId: string) => {
      setBusyId(permissionId)
      try {
        const res = await fetch(`/api/permissions/${permissionId}/revoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok) {
          toastError(data?.error?.message ?? 'Revocation failed')
          return
        }
        success('Permission revoked (terminal)')
        await load()
      } catch {
        toastError('Revocation failed — please retry')
      } finally {
        setBusyId(null)
      }
    },
    [load, success, toastError],
  )

  const computeAuthTuple = useCallback(
    (permission: AgentPermission): AuthTuple => ({
      chainId: String(CHAIN_ID),
      address: IMPL_ADDRESS,
      nonce: permission.nonce ?? '0',
    }),
    [],
  )

  const handleActivate = useCallback(
    async (permission: AgentPermission) => {
      setSignError(null)
      if (!canActivate || !activeAccount) {
        setSignError('Connect a BNB wallet and configure the impl address to sign.')
        return
      }
      setBusyId(permission.id)
      try {
        const auth = computeAuthTuple(permission)

        // 1) Compute the EXACT digest the server verifies (chain ‖ impl ‖ nonce).
        const digest = eip7702Digest({
          chainId: auth.chainId,
          address: auth.address,
          nonce: auth.nonce,
          yParity: 0,
          r: '0x0000000000000000000000000000000000000000000000000000000000000000',
          s: '0x0000000000000000000000000000000000000000000000000000000000000000',
        })
        if (!/^0x[a-fA-F0-9]{64}$/.test(digest)) {
          throw new Error('Failed to compute the EIP-7702 authorization digest')
        }

        // 2) Sign the digest with the USER's connected EOA (EIP-191 personal_sign
        //    of the 64-char hex). The server recovers this form (and the raw form)
        //    and requires the signer to equal permission.userAddress.
        const signature = await activeAccount.signMessage({ message: digest as `0x${string}` })
        if (!signature || !/^0x[a-fA-F0-9]{130}$/.test(signature ?? '')) {
          throw new Error('Wallet returned an invalid signature')
        }

        // 3) Submit for server-side verification + activation.
        const res = await fetch(`/api/permissions/${permission.id}/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            authorization: auth,
            signature,
          }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok) {
          toastError(data?.error?.message ?? 'Permission activation failed (server verification)')
          return
        }
        success('Permission ACTIVE — agent may execute in scope')
        await load()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Signature request failed'
        setSignError(message)
        toastError(message)
      } finally {
        setBusyId(null)
      }
    },
    [canActivate, activeAccount, computeAuthTuple, load, success, toastError],
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black text-foreground tracking-widest uppercase">
          EIP-7702 PERMISSIONS (USER FUNDS)
        </span>
        <button
          type="button"
          onClick={load}
          className="text-[10px] font-black text-[#F0B90B] uppercase tracking-wider hover:text-yellow-300"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground py-2">Loading permissions…</p>
      ) : permissions.length === 0 ? (
        <div className="border border-border rounded-lg p-3">
          <p className="text-sm font-black text-muted-foreground mb-1">No permissions yet</p>
          <p className="text-xs text-muted-foreground">
            User-funds jobs need one signed EIP-7702 authorization before the agent can touch your funds.
            Create the permission profile first (this needs a PENDING record from the agent flow).
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {permissions.map((p) => (
            <div key={p.id} className="border border-border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-[9px] font-black uppercase tracking-wider border rounded px-1.5 py-0.5 ${statusColor(p.status)}`}>
                    {p.status}
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground truncate" title={p.id}>
                    {p.id.slice(0, 12)}…
                  </span>
                </div>
                <span className="text-[10px] font-mono text-muted-foreground">nonce {p.nonce ?? '0'}</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase tracking-wide">Spend cap</span>
                  <span className="font-black text-foreground font-mono">{p.spend?.spendLimit ?? '—'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase tracking-wide">Per tx</span>
                  <span className="font-black text-foreground font-mono">{p.spend?.perTransactionCap ?? '—'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase tracking-wide">User</span>
                  <span className="font-black text-[#F0B90B] font-mono">{shortAddr(p.userAddress)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase tracking-wide">Valid until</span>
                  <span className="font-black text-foreground">{expiresLabel(p)}</span>
                </div>
              </div>

              <div className="text-[10px] text-muted-foreground space-y-0.5">
                {p.allowedProtocols?.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    <span className="uppercase text-muted-foreground">Protocols:</span>
                    {p.allowedProtocols.map((x) => (
                      <span key={x} className="text-[#F0B90B]/80">{x}</span>
                    ))}
                  </div>
                )}
                {p.allowedFunctions?.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    <span className="uppercase text-muted-foreground">Functions:</span>
                    {p.allowedFunctions.map((x) => (
                      <span key={x} className="text-foreground font-mono">{x}</span>
                    ))}
                  </div>
                )}
                {p.allowedTokens?.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    <span className="uppercase text-muted-foreground">Tokens:</span>
                    {p.allowedTokens.map((x) => (
                      <span key={x} className="text-foreground font-mono">{x}</span>
                    ))}
                  </div>
                )}
              </div>

              {p.status === 'ACTIVE' ? (
                <LoadingButton
                  onClick={() => handleRevoke(p.id)}
                  loading={busyId === p.id}
                  loadingLabel="Revoking…"
                  variant="destructive"
                >
                  REVOKE (TERMINAL)
                </LoadingButton>
              ) : p.status === 'PENDING' ? (
                <LoadingButton
                  onClick={() => handleActivate(p)}
                  loading={busyId === p.id}
                  loadingLabel="Signing…"
                  variant="outline"
                  disabled={!canActivate}
                >
                  {canActivate ? 'SIGN & ACTIVATE' : 'CONNECT WALLET TO SIGN'}
                </LoadingButton>
              ) : (
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Terminal — no further action</p>
              )}

              {signError && busyId === p.id && (
                <p className="text-[11px] text-red-500 dark:text-red-400">{signError}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {!IMPL_ADDRESS && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400/80">
          NEXT_PUBLIC_BAN_EIP7702_IMPL_ADDRESS not configured — activation is disabled (fail-closed). Operational (Altana) flows are unaffected.
        </p>
      )}
    </div>
  )
}