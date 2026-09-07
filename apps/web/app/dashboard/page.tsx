'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';
import { ThemeToggle } from '@/components/theme-toggle';
import { PieChart, PieLegend, BarChart, CollapsibleSection, StatCard } from '@/components/charts';

interface Agent {
  id: string;
  name: string;
  description?: string;
  type?: string;
  strategyId?: string;
  status: string;
  riskLevel?: string;
  capabilities?: { id: string; name: string }[];
  protocols?: string[];
  ownerId?: string;
  createdAt: string;
}

interface PerformanceData {
  agentId: string;
  totalTrades: number;
  confirmedCount: number;
  failedCount: number;
  successRate: string;
  totalFeesWei: string;
  avgExecutionMs: number;
  lastExecutedAt: string | null;
  capitalManagedUsd: string;
  hasPositions: boolean;
  realizedPnlUsd: string | null;
  unrealizedPnlUsd: string | null;
  mode: string;
  modeReason: string;
}

interface ActivityEvent {
  id: string;
  eventType: string;
  agentId: string;
  correlationId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [performanceMap, setPerformanceMap] = useState<Record<string, PerformanceData>>({});
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (mounted && !loading && !user) router.push('/login');
  }, [mounted, user, loading, router]);

  const loadDashboard = useCallback(async () => {
    if (!user) return;
    setDataLoading(true);
    setDataError(null);
    try {
      // FIRESTORE QUOTA: one aggregate endpoint instead of a per-agent fan-out
      // of performance + activity calls (which cost 150-500 reads per agent per
      // poll and drained the 20k/day quota). The summary caps total reads at
      // ~4 queries regardless of agent count.
      const res = await fetch('/api/dashboard/summary');
      if (!res.ok) {
        setDataError('Unable to load your agents.');
        setDataLoading(false);
        return;
      }
      const data = await res.json();
      const mine: Agent[] = data.agents || [];
      setAgents(mine);

      // Lightweight per-agent execution stats from the summary (no fabricated
      // fields — anything the summary does not carry renders as its empty value).
      const map: Record<string, PerformanceData> = {};
      for (const a of mine) {
        const exec = (data.executions as Record<string, {
          confirmedCount: number;
          totalTrades: number;
          feesWei: number;
          lastExecutedAt: string | null;
        }> | undefined)?.[a.id];
        const posCents = Number((data.positionValueUsdCents as Record<string, string> | undefined)?.[a.id] ?? '0') || 0;
        map[a.id] = {
          agentId: a.id,
          totalTrades: exec?.totalTrades ?? 0,
          confirmedCount: exec?.confirmedCount ?? 0,
          failedCount: Math.max(0, (exec?.totalTrades ?? 0) - (exec?.confirmedCount ?? 0)),
          successRate: exec && exec.totalTrades > 0
            ? `${Math.round((exec.confirmedCount / exec.totalTrades) * 100)}`
            : '0',
          totalFeesWei: String(exec?.feesWei ?? 0),
          avgExecutionMs: 0,
          lastExecutedAt: exec?.lastExecutedAt ?? null,
          // Position-based capital in USD CENTS (consistent with perf-engine).
          capitalManagedUsd: posCents > 0 ? posCents.toFixed(0) : '0',
          hasPositions: posCents > 0,
          realizedPnlUsd: null,
          unrealizedPnlUsd: null,
          mode: 'LIVE',
          modeReason: 'Aggregate from on-chain-scoped executions',
        };
      }
      setPerformanceMap(map);

      // Latest activity across owned agents (from the same summary response).
      const events: ActivityEvent[] = (data.activity || []).map((e: {
        id: string; agentId: string; eventType: string; severity: string;
        createdAt: string; detail: Record<string, unknown>;
      }) => ({
        id: e.id,
        eventType: e.eventType,
        agentId: e.agentId,
        correlationId: '',
        payload: e.detail,
        createdAt: e.createdAt,
      }));
      setActivity(events);

      // Fetch agent wallet balances for allocation display (BNB + USDT + USDC)
      const allocEntries: { agentId: string; name: string; totalUsd: number; bnb: number; usdt: number; usdc: number; bnbPrice: number }[] = [];
      let allocTotal = 0;
      for (const a of mine.slice(0, 20)) {
        try {
          const r = await fetch(`/api/agents/${a.id}/balance`);
          if (r.ok) {
            const bd = await r.json();
            const bnbBal = Number(bd.balanceBnb || 0);
            const usdtBal = Number(bd.balanceUsdt || 0);
            const usdcBal = Number(bd.balanceUsdc || 0);
            const price = bd.usdPrice || 600;
            const usdVal = bnbBal * price + usdtBal + usdcBal;
            if (usdVal > 0) {
              allocEntries.push({ agentId: a.id, name: a.name, totalUsd: usdVal, bnb: bnbBal, usdt: usdtBal, usdc: usdcBal, bnbPrice: price });
              allocTotal += usdVal;
            }
          }
        } catch { /* ignore */ }
      }
      setAgentAllocations(allocEntries);
      setAllocationTotalUsd(allocTotal);
    } catch (err) {
      console.error('Failed to load dashboard:', err);
      setDataError('Failed to load your dashboard data.');
    } finally {
      setDataLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) loadDashboard();
  }, [user, loadDashboard]);

  // REALTIME: light poll so capital allocation, activity and agent balances
  // stay live without manual refresh. 90s cadence: each pass reads perf +
  // activity + balance per agent (the heaviest page in the app).
  useEffect(() => {
    if (!user) return;
    const t = setInterval(() => { loadDashboard(); }, 90000);
    return () => clearInterval(t);
  }, [user, loadDashboard]);

  const activeAgentCount = agents.filter((a) => a.status === 'ACTIVE').length;
  const deployedCount = agents.filter((a) => a.status !== 'REVOKED').length;

  // Sum of confirmed transactions across owned agents (real).
  const totalConfirmed = agents.reduce((sum, a) => sum + (performanceMap[a.id]?.confirmedCount ?? 0), 0);
  // Total fees paid in wei →’ displayed only when > 0.
  const totalFeesWei = agents.reduce((sum, a) => sum + Number(performanceMap[a.id]?.totalFeesWei ?? '0'), 0);
  const feesPresent = totalFeesWei > 0;
  const feesDisplay = feesPresent ? `${(totalFeesWei / 1e18).toFixed(4)} BNB` : '—';

  // Portfolio value: agent-managed positions + agent wallet balances
  const anyRealPositions = agents.some((a) => performanceMap[a.id]?.hasPositions);
  const portfolioValueUsd = agents.reduce((sum, a) => sum + (Number(performanceMap[a.id]?.capitalManagedUsd || '0') || 0), 0);
  const [agentAllocations, setAgentAllocations] = useState<{ agentId: string; name: string; totalUsd: number; bnb: number; usdt: number; usdc: number; bnbPrice: number }[]>([]);
  const [allocationTotalUsd, setAllocationTotalUsd] = useState(0);
  const [userWalletBalance, setUserWalletBalance] = useState<{ bnb: number; usdt: number; usdc: number; totalUsd: number } | null>(null);

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen dark:bg-background dark:text-foreground bg-white text-black">
        <div className="text-center">
          <div className="inline-block animate-spin mb-4"><div className="h-8 w-8 border-4 border-[#F0B90B] border-t-transparent rounded-full" /></div>
          <p className="text-[#F0B90B] font-mono text-xs uppercase tracking-widest">Loading network...</p>
        </div>
      </div>
    );
  }

  const STRATEGY_ICONS: Record<string, React.ReactNode> = {
    yield: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v20M2 12h20" />
      </svg>
    ),
    health: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
    lp: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36a9 9 0 0 0 14.85-3.36" />
      </svg>
    ),
    grid: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
      </svg>
    ),
  };

  return (
    <div className="min-h-screen dark:bg-background dark:text-foreground bg-white text-black font-sans antialiased transition-colors duration-200">
      <div className="pb-20">
        <header className="dark:bg-background bg-white px-5 pt-6 pb-4 flex items-center justify-between border-b dark:border-[#1A1A1A] border-gray-200">
          <div>
            <h1 className="text-[28px] font-black leading-none tracking-tight text-[#F0B90B]">BAN</h1>
            <div className="text-[10px] font-bold leading-tight text-[#F0B90B] tracking-wider mt-0.5">
              <span>BNB AGENT</span><br /><span>NETWORK</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link href="/notifications" className="relative" aria-label="Notifications">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F0B90B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </Link>
          </div>
        </header>

        <section className="bg-[#F0B90B] px-5 pt-5 pb-6 w-full">
          <div className="flex items-start justify-between mb-2">
            <span className="text-[10px] font-black text-black tracking-widest uppercase">Active agents</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="black">
              <rect x="2" y="2" width="5" height="5" /><rect x="9.5" y="2" width="5" height="5" /><rect x="17" y="2" width="5" height="5" />
              <rect x="2" y="9.5" width="5" height="5" /><rect x="9.5" y="9.5" width="5" height="5" /><rect x="17" y="9.5" width="5" height="5" />
            </svg>
          </div>
          <div className="flex items-start gap-3 mb-3">
            <span className="text-[80px] font-black leading-[0.85] text-black">{activeAgentCount}</span>
            <div className="pt-1">
              <p className="text-[21px] font-black leading-[1.05] text-black">AUTONOMOUS</p>
              <p className="text-[21px] font-black leading-[1.05] text-black">AGENTS WORKING</p>
              <p className="text-[21px] font-black leading-[1.05] text-black">FOR YOU.</p>
            </div>
          </div>
          <p className="text-[11px] font-black text-black tracking-wider mb-5">24/7 ONCHAIN. ALWAYS EXECUTING.</p>

          {/* Deployed agents + Gas used, moved into the yellow card */}
          <div className="grid grid-cols-2 gap-3 border-t border-black/30 pt-4 mb-5">
            <div>
              <p className="text-[10px] font-black text-black/70 tracking-widest uppercase mb-1">Deployed agents</p>
              <p className="text-3xl font-black leading-none text-black">{deployedCount}</p>
            </div>
            <div>
              <p className="text-[10px] font-black text-black/70 tracking-widest uppercase mb-1">Gas used</p>
              <p className="text-3xl font-black leading-none text-black">{feesDisplay}</p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <button type="button" onClick={() => router.push('/agents')} className="bg-background text-foreground text-[11px] font-black tracking-widest uppercase px-5 py-3 flex items-center gap-1.5">
              <span className="text-[#F0B90B] text-base leading-none">+</span> Hire agent
            </button>
            <button type="button" onClick={() => router.push('/my-agents')} className="text-black text-[11px] font-black tracking-wider uppercase flex items-center gap-1.5">
              View all agents
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17L17 7" /><path d="M7 7h10v10" />
              </svg>
            </button>
          </div>
        </section>

        <div className="mx-5 mt-5 dark:bg-card bg-gray-50 rounded-xl p-4 border dark:border-border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-black dark:text-foreground text-black tracking-widest uppercase">Portfolio overview</span>
            <button type="button" onClick={() => router.push('/portfolio')} className="dark:bg-[#1A1A1A] bg-white text-[10px] dark:text-foreground text-black font-bold px-2.5 py-1.5 flex items-center gap-1 border dark:border-border border-gray-300">
              Total value
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 4l2 2 2-2" /></svg>
            </button>
          </div>
          {anyRealPositions || agentAllocations.length > 0 ? (
            <>
              <div className="flex items-end justify-between mb-4">
                <div>
                  <p className="text-[32px] font-black leading-none dark:text-foreground text-black">
                    ${(allocationTotalUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <p className="text-sm font-bold text-[#F0B90B] mt-1">
                    {agentAllocations.length} agent{agentAllocations.length !== 1 ? 's' : ''} funded
                  </p>
                </div>
              </div>
              <div className="flex flex-col md:flex-row items-center gap-4">
                <PieChart
                  segments={[
                    { label: 'Agent Wallets', value: allocationTotalUsd, color: '#F0B90B' },
                    { label: 'Managed Positions', value: portfolioValueUsd, color: '#10b981' },
                  ]}
                  centerValue={`$${allocationTotalUsd.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
                  centerLabel="TOTAL"
                />
                <div className="flex-1 w-full">
                  <PieLegend
                    segments={[
                      { label: 'Agent Wallets (in use)', value: allocationTotalUsd, color: '#F0B90B' },
                      { label: 'Managed Positions', value: portfolioValueUsd, color: '#10b981' },
                    ]}
                    total={allocationTotalUsd + portfolioValueUsd}
                  />
                  {agentAllocations.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <BarChart
                        items={agentAllocations.slice(0, 4).map((a) => ({
                          label: a.name.length > 15 ? a.name.slice(0, 15) + '…' : a.name,
                          value: a.totalUsd,
                          color: '#F0B90B',
                        }))}
                      />
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="py-2">
              <p className="text-base font-black text-muted-foreground">No positions yet</p>
              <p className="text-xs dark:text-muted-foreground text-muted-foreground mt-1">
                Portfolio metrics will appear after BAN records its first position.
              </p>
            </div>
          )}
        </div>

        <div className="mx-5 mt-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-[#F0B90B] tracking-widest uppercase">SMART MONEY</span>
              <span className="text-[9px] dark:text-muted-foreground text-muted-foreground">by BAN</span>
            </div>
            <button type="button" onClick={() => router.push('/my-agents')} className="text-[10px] font-black dark:text-muted-foreground text-muted-foreground tracking-wider uppercase flex items-center gap-1 hover:text-[#F0B90B] transition-colors">
              View all
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" /><path d="M12 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Stat cards row */}
        <div className="mx-5 grid grid-cols-3 gap-2.5 mt-3">
          <StatCard
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F0B90B" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>}
            value={String(deployedCount)}
            label="Deployed"
          />
          <StatCard
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>}
            value={String(totalConfirmed)}
            label="Confirmed"
          />
          <StatCard
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F0B90B" strokeWidth="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>}
            value={feesPresent ? feesDisplay : '—'}
            label="Gas used"
          />
        </div>

        {dataLoading ? (
          <div className="mx-5 mt-5 text-center text-xs text-muted-foreground py-6">
            Loading your agents...
          </div>
        ) : agents.filter((a) => a.status !== 'REVOKED').length === 0 || dataError ? (
          <div className="mx-5 mt-5 dark:bg-card bg-gray-50 rounded-xl p-6 border dark:border-border border-gray-200 text-center">
            <p className="text-sm font-black text-muted-foreground">{dataError || 'No active agents deployed'}</p>
            <p className="text-xs dark:text-muted-foreground text-muted-foreground mt-1 mb-4">
              {dataError
                ? 'Please check your connection and try again.'
                : 'Hire or register an autonomous agent to start securing BNB Chain positions.'}
            </p>
            {!dataError && (
              <button type="button" onClick={() => router.push('/agents')} className="bg-[#F0B90B] text-black text-[11px] font-black tracking-widest uppercase px-5 py-3">
                Browse marketplace
              </button>
            )}
          </div>
        ) : (
          <div className="mx-5 mt-5">
            <CollapsibleSection title="MY AGENTS" badge={`${agents.filter((a) => a.status !== 'REVOKED').length}`} defaultOpen={true}>
              <div className="grid grid-cols-2 gap-3">
                {agents.filter((a) => a.status !== 'REVOKED').map((ag) => {
                  const key = (ag.strategyId || ag.type || 'yield').toLowerCase();
                  const isActive = ag.status === 'ACTIVE';
                  const perf = performanceMap[ag.id];
                  const metricValue =
                    typeof perf?.successRate === 'string' && perf.confirmedCount > 0
                      ? `${(parseFloat(perf.successRate) * 100).toFixed(0)}%`
                      : null;
                  return (
                    <button
                      key={ag.id}
                      type="button"
                      onClick={() => ag && router.push(`/my-agents/${ag.id}`)}
                      className="relative dark:bg-card bg-gray-50 border dark:border-border border-gray-200 rounded-xl p-4 text-left active:scale-[0.98] transition-transform"
                    >
                      <div className="w-10 h-10 bg-[#F0B90B] flex items-center justify-center mb-3">{STRATEGY_ICONS[key] || null}</div>
                      <p className="text-[11px] font-black dark:text-foreground text-black tracking-wider mb-2">{ag.name}</p>
                      <div className="flex items-center gap-1.5 mb-3">
                        <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-green-400' : 'bg-gray-400'}`} />
                        <span className="text-[9px] font-bold dark:text-muted-foreground text-muted-foreground uppercase">{ag.status}</span>
                      </div>
                      <p className="text-[9px] font-bold dark:text-muted-foreground text-muted-foreground uppercase tracking-wider">Success rate</p>
                      <p className={`text-lg font-black ${metricValue ? 'dark:text-foreground text-black' : 'text-muted-foreground'}`}>
                        {metricValue || '—'}
                      </p>
                      {isActive && (
                        <div className="absolute bottom-0 right-0 w-8 h-8 bg-[#F0B90B] flex items-center justify-center">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M7 17L17 7" /><path d="M7 7h10v10" />
                          </svg>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </CollapsibleSection>
          </div>
        )}

        <div className="mx-5 mt-5 mb-6">
          <CollapsibleSection title="LATEST ACTIVITY" badge={`${activity.length}`} defaultOpen={true}>
            <div className="space-y-3">
              {activity.length === 0 ? (
                <p className="text-xs dark:text-muted-foreground text-muted-foreground py-2">
                  No activity recorded yet. Agent actions will appear here.
                </p>
              ) : (
                activity.slice(0, 3).map((event, idx, arr) => (
                  <div key={event.id} className={`flex items-start gap-3 ${idx < arr.length - 1 ? 'pb-3 border-b dark:border-border border-gray-200' : ''}`}>
                    <div className="w-9 h-9 bg-[#F0B90B] flex items-center justify-center shrink-0">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M7 17L17 7" /><path d="M7 7h10v10" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black capitalize text-black">{event.eventType.replace(/_/g, ' ')}</p>
                      <p className="text-xs dark:text-muted-foreground text-muted-foreground mt-0.5">{formatActivityPayload(event.payload)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-muted-foreground mb-1">{timeAgo(event.createdAt)}</p>
                      <span className="bg-[#F0B90B] text-black text-[9px] font-black uppercase px-2 py-0.5">LOG</span>
                    </div>
                  </div>
                ))
              )}
            </div>
            {activity.length > 3 && (
              <div className="mt-3 text-center">
                <button type="button" onClick={() => router.push('/history')} className="text-[10px] font-black text-[#F0B90B] tracking-wider uppercase">
                  View all {activity.length} events →
                </button>
              </div>
            )}
          </CollapsibleSection>
        </div>
      </div>

      <MobileBottomNav />
    </div>
  );
}

function formatActivityPayload(payload: Record<string, unknown>): string {
  const entries = Object.entries(payload);
  if (entries.length === 0) return 'Event recorded';
  return entries.slice(0, 2).map(([k, v]) => `${k}: ${String(v)}`).join(', ');
}