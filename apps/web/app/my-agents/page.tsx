'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { CryptoIcon } from '@/components/crypto-icon';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';
import NetworkModeBadge from '@/components/network-mode-badge';
import { CopyAddress } from '@/components/copy-address';
import { useToast } from '@/components/toast-provider';

interface Agent {
  id: string;
  name: string;
  description?: string;
  status: string;
  executionCount?: number;
  lastExecutionAt?: string | null;
  strategyId?: string;
  capabilities?: string[];
  walletAddress?: string;
}

interface PerformanceData {
  agentId: string;
  mode: string;
  modeReason: string;
  confirmedCount: number;
}

interface BalanceData {
  address?: string | null;
  balanceBnb?: string | null;
  balanceUsdt?: string | null;
  balanceUsdc?: string | null;
  balanceUsd?: string | null;
  usdPrice?: number | null;
}

/** On-chain agent wallet balance — value is null until the chain read succeeds. */
function AgentBalance({ agentId, walletAddress }: { agentId: string; walletAddress?: string }) {
  const toast = useToast();
  const [balance, setBalance] = useState<BalanceData | null>(null);

  const load = useCallback(async () => {
    if (!walletAddress) return;
    try {
      const res = await fetch(`/api/agents/${agentId}/balance`);
      if (!res.ok) return;
      const data = (await res.json()) as BalanceData;
      setBalance(data);
    } catch (err) {
      console.error('Failed to load agent balance:', err);
    }
  }, [agentId, walletAddress]);

  useEffect(() => {
    setBalance(null);
    load();
  }, [load]);

  // No wallet provisioned yet →’ show nothing beside the address (no fabricated zero).
  const hasTokenBalance = Boolean(balance?.balanceBnb || balance?.balanceUsdt || balance?.balanceUsdc || balance?.balanceUsd);
  const currentBalance = balance;
  if (!walletAddress || !currentBalance || !hasTokenBalance) {
    return null;
  }

  return (
    <button
      type="button"
      title="Live on-chain BNB, USDT, and USDC balances (BSC)"
      onClick={() => {
        load();
        toast.success({ title: 'Balance refreshed', description: 'Live BNB, USDT, and USDC balances fetched from BSC.' });
      }}
      className="inline-flex items-center gap-2 rounded border border-border bg-background/40 px-2 py-1 font-mono hover:border-[#F0B90B]/60 transition"
    >
      <span className="text-[#F0B90B] font-bold">
        {currentBalance.balanceBnb ? `${currentBalance.balanceBnb} BNB` : ''}
        {currentBalance.balanceUsdt ? ` · ${currentBalance.balanceUsdt} USDT` : ''}
        {currentBalance.balanceUsdc ? ` · ${currentBalance.balanceUsdc} USDC` : ''}
      </span>
      {currentBalance.balanceUsd ? (
        <span className="text-muted-foreground">· ${currentBalance.balanceUsd}</span>
      ) : (
        <span className="text-gray-600" title="USD price unavailable">· —</span>
      )}
    </button>
  );
}

export default function MyAgentsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [modeMap, setModeMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'DEPLOYED' | 'CREATE'>('DEPLOYED');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function loadMode(agentId: string) {
    try {
      const res = await fetch(`/api/agents/${agentId}/performance`);
      if (res.ok) {
        const data = await res.json();
        const pd: PerformanceData = data.performance;
        setModeMap((prev) => ({ ...prev, [agentId]: pd?.mode || '' }));
      }
    } catch {
      // leave mode unset →’ NO DATA badge
    }
  }

  async function loadMyAgents() {
    try {
      setLoading(true);
      const res = await fetch('/api/agents?my=true');
      if (res.ok) {
        const data = await res.json();
        const list: Agent[] = data.agents || data || [];
        setAgents(list);
        list.forEach((a) => loadMode(a.id));
      } else {
        toast.error('Unable to load your deployed agents.');
      }
    } catch (err) {
      console.error('Failed to load my agents:', err);
      toast.error('Failed to load your deployed agents.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMyAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreateAgent(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Agent name is required.');
      return;
    }

    setCreating(true);
    setCreateError(null);

    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          capabilities: ['portfolio-rebalance', 'yield-optimizer'],
          allowedProtocols: ['pancakeswap', 'venus'],
          costPerExecution: 0.5,
        }),
      });

      if (!res.ok) {
        // Robustly parse the error body so a non-JSON / undefined body can never crash.
        let message = 'Failed to create agent';
        try {
          const err = await res.json();
          message = err?.error ?? err?.message ?? message;
        } catch {
          // body was not JSON — keep the fallback message
        }
        throw new Error(message);
      }

      setName('');
      setDescription('');
      setActiveTab('DEPLOYED');
      await loadMyAgents();
      toast.success('Agent deployed successfully.');
    } catch (err: any) {
      const msg = err?.message || 'Creation failed';
      setCreateError(msg);
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground font-mono flex flex-col pb-24">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/dashboard')}
            className="w-8 h-8 rounded-lg bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div>
            <div className="text-xs font-bold text-[#F0B90B] tracking-wider uppercase">Operator Center</div>
            <div className="text-lg font-black tracking-tight text-foreground">MY AGENTS</div>
          </div>
        </div>
        <Link
          href="/agents"
          className="px-3 py-1.5 bg-[#F0B90B] text-black text-xs font-black rounded uppercase hover:bg-[#F0B90B]/90 transition-colors"
        >
          + HIRE AGENT
        </Link>
      </div>

      <div className="p-4 space-y-4 max-w-md mx-auto w-full min-w-0 flex-1 overflow-x-hidden">
        <div className="grid grid-cols-2 gap-2 bg-card p-1 rounded-xl border border-border">
          <button
            onClick={() => setActiveTab('DEPLOYED')}
            className={`py-2 text-xs font-bold rounded-lg transition-colors ${
              activeTab === 'DEPLOYED'
                ? 'bg-[#F0B90B] text-black'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            DEPLOYED AGENTS ({agents.length})
          </button>
          <button
            onClick={() => setActiveTab('CREATE')}
            className={`py-2 text-xs font-bold rounded-lg transition-colors ${
              activeTab === 'CREATE'
                ? 'bg-[#F0B90B] text-black'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            + REGISTER NEW
          </button>
        </div>

        {activeTab === 'DEPLOYED' && (
          <div className="space-y-4">
            {loading && (
              <div className="py-12 text-center text-muted-foreground text-sm">
                <div className="inline-block w-6 h-6 border-2 border-[#F0B90B] border-t-transparent rounded-full animate-spin mb-2" />
                <div>Loading your deployed agents...</div>
              </div>
            )}

            {!loading && agents.length === 0 && (
              <div className="dark:bg-card bg-gray-50 rounded-xl p-4 border dark:border-border border-gray-200 text-center py-10">
                <div className="w-14 h-14 mx-auto mb-3 rounded-xl bg-[#F0B90B] flex items-center justify-center">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="8" width="16" height="12" rx="2" /><circle cx="9" cy="13" r="1.5" fill="black" /><circle cx="15" cy="13" r="1.5" fill="black" /><path d="M10 17h4" /><line x1="12" y1="4" x2="12" y2="8" />
                  </svg>
                </div>
                <div className="text-foreground font-bold text-base mb-1">No Active Agents Deployed</div>
                <p className="text-xs text-muted-foreground mb-6 max-w-xs mx-auto">
                  Hire an autonomous trading or yield agent from the marketplace to start executing on BNB Chain.
                </p>
                <div className="flex flex-col gap-2">
                  <Link
                    href="/agents"
                    className="w-full py-3 bg-[#F0B90B] text-black font-black text-xs rounded-xl uppercase tracking-wider text-center"
                  >
                    Browse Agent Marketplace
                  </Link>
                  <button
                    onClick={() => setActiveTab('CREATE')}
                    className="w-full py-2.5 bg-card border border-border text-gray-300 font-bold text-xs rounded-xl"
                  >
                    Register Custom Agent
                  </button>
                </div>
              </div>
            )}

            {!loading &&
              agents.map((agent) => {
                const isActive = agent.status?.toUpperCase() === 'ACTIVE';
                const mode = modeMap[agent.id];
                return (
                  <Link
                    key={agent.id}
                    href={`/my-agents/${agent.id}`}
                    className="dark:bg-card bg-gray-50 hover:bg-gray-100 dark:hover:bg-card/80 border dark:border-border border-gray-200 hover:border-[#F0B90B]/50 rounded-xl p-5 transition-all relative isolate min-w-0 overflow-hidden group shadow-sm hover:shadow-md"
                  >
                    <div className="relative z-10 flex min-w-0 items-start justify-between mb-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-background border border-border flex items-center justify-center">
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#F0B90B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="4" y="8" width="16" height="12" rx="2" /><circle cx="9" cy="13" r="1.5" fill="#F0B90B" /><circle cx="15" cy="13" r="1.5" fill="#F0B90B" /><path d="M10 17h4" /><line x1="12" y1="4" x2="12" y2="8" />
                          </svg>
                        </div>
                        <div className="min-w-0">
                          <div className="text-foreground font-bold text-sm group-hover:text-[#F0B90B] transition-colors flex min-w-0 items-center gap-1.5 truncate">
                            {agent.name}
                          </div>
                          <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                            <span className="text-muted-foreground font-mono">ID: {agent.id.slice(0, 10)}...</span>
                          </div>
                        </div>
                      </div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase flex items-center gap-1 ${
                          isActive
                            ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
                            : 'text-muted-foreground border-gray-500/30 bg-gray-500/10'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'}`} />
                        {agent.status || 'ACTIVE'}
                      </span>
                    </div>

                    {agent.walletAddress && (
                      <div className="relative z-10 mb-3 flex min-w-0 items-center gap-2 overflow-hidden text-[11px] text-muted-foreground">
                        <span className="uppercase text-[9px] font-black text-gray-600 tracking-wider">Wallet</span>
                        <CopyAddress address={agent.walletAddress} />
                        <AgentBalance agentId={agent.id} walletAddress={agent.walletAddress} />
                      </div>
                    )}

                    {agent.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                        {agent.description}
                      </p>
                    )}

                    <div className="relative z-10 grid min-w-0 grid-cols-3 gap-3 bg-background/60 rounded-xl p-3 border border-border text-center mb-4">
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase">Executions</div>
                        <div className="text-xs font-bold text-foreground">{agent.executionCount ?? 0}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase">Chain</div>
                        <div className="text-xs font-bold text-[#F0B90B] flex items-center justify-center gap-1">
                          <CryptoIcon symbol="BNB" size={12} />
                          BNB
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase">Network Mode</div>
                        <NetworkModeBadge mode={mode} />
                      </div>
                    </div>

                    <div className="relative z-10 flex min-w-0 items-center justify-between gap-2 text-xs pt-1 border-t border-[#1a1a1a]">
                      <span className="text-[11px] text-muted-foreground">
                        {agent.lastExecutionAt ? `Last active ${new Date(agent.lastExecutionAt).toLocaleTimeString()}` : 'Ready for execution'}
                      </span>
                      <span className="text-[#F0B90B] font-bold text-xs flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                        MANAGE SESSIONS &amp; LIMITS
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F0B90B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12h14" /><path d="M12 5l7 7-7 7" />
                        </svg>
                      </span>
                    </div>
                  </Link>
                );
              })}
          </div>
        )}

        {activeTab === 'CREATE' && (
          <form
            onSubmit={handleCreateAgent}
            className="dark:bg-card bg-gray-50 rounded-xl p-4 border dark:border-border border-gray-200 space-y-4"
          >
            <div>
              <label className="block text-[10px] font-black text-foreground tracking-widest uppercase mb-1.5">Agent Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder-gray-600 focus:outline-none focus:border-[#F0B90B]"
                placeholder="My custom agent"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black text-muted-foreground tracking-widest uppercase mb-1.5">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder-gray-600 focus:outline-none focus:border-[#F0B90B]"
                placeholder="Describe what this agent does"
              />
            </div>

            {createError && (
              <div className="border-2 border-destructive/40 bg-destructive/10 p-3">
                <p className="text-sm text-destructive">{createError}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={creating}
              className="w-full py-3 bg-[#F0B90B] text-black font-black text-xs rounded-xl uppercase tracking-wider disabled:opacity-60"
            >
              {creating ? 'Creating...' : 'REGISTER AGENT'}
            </button>
          </form>
        )}
      </div>

      <MobileBottomNav />
    </div>
  );
}