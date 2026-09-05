'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { CryptoIcon } from '@/components/crypto-icon';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';
import { useToast } from '@/components/toast-provider';
import { LoadingButton } from '@/components/ui/loading-button';

interface Capability {
  id: string;
  name?: string;
  description?: string;
}

interface AgentDetail {
  id: string;
  name: string;
  description: string;
  type: string;
  strategyId?: string;
  status: string;
  riskLevel?: string;
  walletAddress?: string;
  capabilities: Capability[];
  protocols: string[];
  costPerExecution?: number;
  rating?: number;
  reviewCount?: number;
  ownerId: string;
  createdAt: string;
  chainId?: number;
  aiModel?: string;
  version?: string;
}

interface PerformanceData {
  agentId: string;
  totalTrades: number;
  confirmedCount: number;
  failedCount: number;
  successRate: string;
  totalFeesWei: string;
  avgGasPerTx: string;
  avgExecutionMs: number;
  lastExecutedAt: string | null;
  byStatus: Record<string, number>;
  capitalManagedUsd: string;
  hasPositions: boolean;
  realizedPnlUsd: string | null;
  unrealizedPnlUsd: string | null;
  maxDrawdownUsd: string | null;
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

// Shape of GET /api/protocols →’ { ok, snapshot } (derived from the fail-closed
// @ban/registry registries via buildBnbRegistrySnapshot — never fabricated).
interface RegistryContractEntry {
  id: string;
  address: string;
  protocolId: string;
  name: string;
  verified: boolean;
  enabled: boolean;
  capabilities: string[];
  integrationStatus: string;
  reason: string;
  functions: Array<{ name: string; capability: string }>;
}

interface RegistryProtocolEntry {
  id: string;
  name: string;
  status: string;
  official: boolean;
  priority?: string;
  integrationStatus: string;
  reason: string;
  contracts: RegistryContractEntry[];
}

interface RegistrySnapshot {
  chainId: number;
  generatedAt: string;
  protocols: RegistryProtocolEntry[];
}

const TIMELINE_ICONS: Record<string, React.ReactNode> = {
  OBSERVATION_CREATED: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
  ),
  AI_DECISION_CREATED: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
  ),
  ACTION_PROPOSED: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
  ),
  ACTION_APPROVED: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
  ),
  ACTION_DENIED: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
  ),
  TRANSACTION_SUBMITTED: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
  ),
  TRANSACTION_CONFIRMED: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
  ),
  TRANSACTION_FAILED: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
  ),
  POSITION_UPDATED: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5L8 21l-5-5z" /></svg>
  ),
};

function getTimelineIcon(eventType: string) {
  return TIMELINE_ICONS[eventType] ?? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /></svg>
  );
}

function getTimelineTitle(eventType: string) {
  switch (eventType) {
    case 'OBSERVATION_CREATED': return 'Observed opportunity';
    case 'AI_DECISION_CREATED': return 'AI decision recorded';
    case 'ACTION_PROPOSED': return 'Proposed action';
    case 'ACTION_APPROVED': return 'Policy approved';
    case 'ACTION_DENIED': return 'Policy denied';
    case 'TRANSACTION_SUBMITTED': return 'Transaction submitted';
    case 'TRANSACTION_CONFIRMED': return 'Transaction confirmed';
    case 'TRANSACTION_FAILED': return 'Transaction failed';
    case 'POSITION_UPDATED': return 'Position updated';
    default: return eventType.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

function getTimelineSubtitle(eventType: string, payload: Record<string, unknown>) {
  switch (eventType) {
    case 'TRANSACTION_SUBMITTED':
    case 'TRANSACTION_CONFIRMED':
    case 'TRANSACTION_FAILED': {
      const hash = typeof payload.hash === 'string' ? payload.hash : typeof payload.txHash === 'string' ? payload.txHash : '';
      return hash ? `0x${hash.replace(/^0x/, '').slice(0, 10)}` : 'On-chain transaction recorded';
    }
    default: {
      const entries = Object.entries(payload).filter(([k]) => !['correlationId', 'agentId'].includes(k));
      return entries.slice(0, 1).map(([k, v]) => `${k}: ${String(v)}`).join(', ') || 'Operation recorded';
    }
  }
}

type Tab = 'overview' | 'strategy' | 'activity';

export default function AgentDetailPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const toast = useToast();
  const [mounted, setMounted] = useState(false);
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [performance, setPerformance] = useState<PerformanceData | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [protocolSnapshot, setProtocolSnapshot] = useState<RegistrySnapshot | null>(null);
  const [protocolSnapshotError, setProtocolSnapshotError] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployedAgentId, setDeployedAgentId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { if (mounted && !loading && !user) router.push('/login'); }, [mounted, user, loading, router]);
  useEffect(() => { if (params.id) { fetchAgent(); fetchPerformance(); fetchActivity(); } }, [params.id]);
  useEffect(() => { fetchProtocolSnapshot(); }, []);

  const fetchAgent = async () => {
    try {
      const response = await fetch(`/api/agents/${params.id}`);
      if (response.ok) {
        const data = await response.json();
        setAgent(data.agent);
      } else {
        router.push('/agents');
      }
    } catch (error) {
      console.error('Failed to fetch agent:', error);
    } finally {
      setPageLoading(false);
    }
  };

  const fetchPerformance = async () => {
    try {
      const response = await fetch(`/api/agents/${params.id}/performance`);
      if (response.ok) {
        const data = await response.json();
        setPerformance(data.performance);
      }
    } catch (error) {
      console.error('Failed to fetch performance:', error);
    }
  };

  const fetchActivity = async () => {
    try {
      setActivityError(null);
      const response = await fetch(`/api/agents/${params.id}/activity?limit=30`);
      if (response.ok) {
        const data = await response.json();
        setEvents(data.events ?? []);
        return;
      }
      const data = await response.json().catch(() => null);
      setEvents([]);
      setActivityError(
        data && typeof data.error === 'string'
          ? data.error
          : 'Activity is unavailable for this agent right now.'
      );
    } catch (error) {
      console.error('Failed to fetch activity:', error);
      setActivityError('Failed to load activity. Please try again.');
    }
  };

  // Real protocol registry snapshot (GET /api/protocols →’ buildBnbRegistrySnapshot).
  const fetchProtocolSnapshot = async () => {
    try {
      const response = await fetch('/api/protocols');
      if (response.ok) {
        const data = await response.json();
        if (data?.snapshot) {
          setProtocolSnapshot(data.snapshot as RegistrySnapshot);
          return;
        }
      }
      setProtocolSnapshotError('Protocol state snapshot is unavailable right now.');
    } catch (error) {
      console.error('Failed to fetch protocol snapshot:', error);
      setProtocolSnapshotError('Protocol state snapshot is unavailable right now.');
    }
  };

  const handleDeployAgent = async () => {
    if (!user || !agent) return;
    setDeploying(true);
    try {
      const response = await fetch(`/api/agents/${agent.id}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        const data = await response.json();
        const created = data.agent;
        setDeployedAgentId(created.id);
        toast.success({
          title: 'Agent hired',
          description: 'Your copy is being set up. Head to My Agents to create a task and configure its limits.',
        });
        setTimeout(() => router.push(`/my-agents/${created.id}`), 800);
      } else {
        const error = await response.json();
        toast.error({ title: 'Hire failed', description: error.error || 'An unexpected error occurred.' });
      }
    } catch (error) {
      console.error('Deploy error:', error);
      toast.error({ title: 'Hire failed', description: 'An unexpected error occurred.' });
    } finally {
      setDeploying(false);
    }
  };

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background text-foreground">
        <div className="inline-block animate-spin h-8 w-8 border-4 border-[#F0B90B] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (pageLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background text-foreground">
        <div className="text-center space-y-3">
          <div className="inline-block animate-spin h-8 w-8 border-4 border-[#F0B90B] border-t-transparent rounded-full" />
          <p className="text-xs text-[#F0B90B] font-mono tracking-widest uppercase">Loading Agent...</p>
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="min-h-screen bg-background text-foreground p-6 flex flex-col items-center justify-center">
        <p className="text-muted-foreground mb-4">Agent not found</p>
        <button onClick={() => router.push('/agents')} className="bg-[#F0B90B] text-black text-xs font-black px-4 py-2 uppercase tracking-wider">Return to Marketplace</button>
      </div>
    );
  }

  const primaryProtocol = agent.protocols[0] || null;
  const hasRealPositions = performance?.hasPositions === true;
  const confirmedCount = performance?.confirmedCount ?? 0;
  const capitalUsd = Number(performance?.capitalManagedUsd || '0');
  const tvlValue = hasRealPositions && capitalUsd > 0
    ? `$${capitalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';
  const successRate = confirmedCount > 0 && performance
    ? `${(parseFloat(performance.successRate) * 100).toFixed(0)}%`
    : '—';
  const confirmedDisplay = confirmedCount > 0 ? String(confirmedCount) : 'None yet';
  const capLabel = (c: Capability) => c.name || c.id;

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'strategy', label: 'Strategy' },
    { id: 'activity', label: 'Activity' },
  ];

  // The agent's declared protocols, matched against the live registry snapshot
  // (never fabricated: protocols without a snapshot entry show as unrecognized).
  //
  // Match by registry **id OR display name**, case-insensitive. The snapshot
  // uses ids (`pancakeswap`, `venus`) while agent templates may store display
  // names (`PancakeSwap`, `Venus`) — a strict id-only match made verified
  // protocols render as greyed-out "UNRECOGNIZED" despite being verified.
  const norm = (s: string) => s.toLowerCase().trim();
  const snapshotProtocols = protocolSnapshot?.protocols ?? [];
  const matchesProtocol = (p: { id: string; name: string }, pid: string) =>
    norm(pid) === norm(p.id) || norm(pid) === norm(p.name);
  const agentProtocolState: RegistryProtocolEntry[] = snapshotProtocols.filter((p) =>
    agent.protocols.some((pid) => matchesProtocol(p, pid)),
  );
  const unknownProtocols = agent.protocols.filter(
    (pid) => !snapshotProtocols.some((p) => matchesProtocol(p, pid)),
  );

  const integrationColor = (status: string) => {
    switch (status) {
      case 'EXECUTION_ENABLED': return 'text-green-400 border-green-500/40 bg-green-500/10';
      case 'SIMULATION': return 'text-[#F0B90B] border-[#F0B90B]/40 bg-[#F0B90B]/10';
      case 'READ_ONLY': return 'text-blue-400 border-blue-500/40 bg-blue-500/10';
      default: return 'text-muted-foreground border-gray-600 bg-gray-800/40';
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased pb-28">
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur px-5 py-4 flex items-center justify-between border-b border-[#1A1A1A]">
        <button onClick={() => router.push('/agents')} className="text-foreground hover:text-[#F0B90B] transition flex items-center gap-1" aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="text-sm font-black tracking-widest uppercase text-foreground">AGENT DETAILS</h1>
        <div className="w-5" />
      </header>

      <nav className="px-5 pt-3 flex gap-2 border-b border-[#1A1A1A]">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-3 py-2 text-[11px] font-black uppercase tracking-wider border-b-2 transition ${activeTab === t.id ? 'text-[#F0B90B] border-[#F0B90B]' : 'text-muted-foreground border-transparent hover:text-gray-300'}`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="px-5 pt-4 space-y-4">
        {activeTab === 'overview' && (
          <>
            <div className="bg-card rounded-xl p-5 border border-border">
              <div className="flex items-start gap-4 mb-4">
                <div className="w-14 h-14 rounded-full bg-[#F0B90B] flex items-center justify-center shrink-0 border-2 border-black">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="8" width="16" height="12" rx="2" /><circle cx="9" cy="13" r="1.5" fill="black" /><circle cx="15" cy="13" r="1.5" fill="black" /><path d="M10 17h4" /><line x1="12" y1="4" x2="12" y2="8" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-black text-[#F0B90B] leading-tight truncate">{agent.name}</h2>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="flex items-center gap-1.5 text-xs font-black text-green-400">
                      <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                      {agent.status}
                    </span>
                    {primaryProtocol && <span className="text-xs text-muted-foreground">On {primaryProtocol}</span>}
                    {agent.riskLevel && (
                      <span className="text-[9px] font-black tracking-wider uppercase bg-[#F0B90B]/20 text-[#F0B90B] px-2 py-0.5 rounded">
                        {agent.riskLevel} RISK
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <p className="text-xs text-gray-300 leading-relaxed mb-5">
                {agent.description || 'Autonomous BNB Chain agent registered on BAN.'}
              </p>

              <div className="grid grid-cols-3 gap-2 pt-4 border-t border-border text-center">
                <div>
                  <p className="text-[9px] font-black text-muted-foreground uppercase tracking-wider mb-1">CONFIRMED EXEC</p>
                  <p className="text-base font-black text-foreground">{confirmedDisplay}</p>
                </div>
                <div>
                  <p className="text-[9px] font-black text-muted-foreground uppercase tracking-wider mb-1">CAPITAL MANAGED</p>
                  <p className="text-base font-black text-foreground">{tvlValue}</p>
                </div>
                <div>
                  <p className="text-[9px] font-black text-muted-foreground uppercase tracking-wider mb-1">SUCCESS RATE</p>
                  <p className="text-base font-black text-green-400">{successRate}</p>
                </div>
              </div>

              {performance && (
                <div className="mt-4 pt-3 border-t border-border grid grid-cols-2 gap-2 text-center">
                  <div className="bg-card rounded-lg p-3">
                    <p className="text-[9px] font-black text-muted-foreground uppercase tracking-wider mb-1">Total trades</p>
                    <p className="text-sm font-black text-foreground">{performance.totalTrades}</p>
                  </div>
                  <div className="bg-card rounded-lg p-3">
                    <p className="text-[9px] font-black text-muted-foreground uppercase tracking-wider mb-1">Avg execution</p>
                    <p className="text-sm font-black text-foreground">{performance.avgExecutionMs ? `${performance.avgExecutionMs}ms` : '—'}</p>
                  </div>
                </div>
              )}

              {performance && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
                  <span>Mode</span>
                  <span className="font-black text-[#F0B90B] uppercase">{performance.mode} — {performance.modeReason}</span>
                </div>
              )}
            </div>

            <div className="bg-card rounded-xl p-5 border border-border space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-foreground tracking-widest uppercase">HIRE AGENT</span>
                <span className="text-xs font-mono font-black text-[#F0B90B]">
                  {agent.costPerExecution != null ? `${agent.costPerExecution} Credits / Run` : 'Cost not set'}
                </span>
              </div>

              {deployedAgentId ? (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg space-y-2">
                  <p className="text-xs font-black text-emerald-400 flex items-center gap-1.5">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    Agent Hired!
                  </p>
                  <p className="text-[10px] font-mono text-muted-foreground">Hired Agent ID: {deployedAgentId}</p>
                  <button onClick={() => router.push(`/my-agents/${deployedAgentId}`)} className="w-full mt-2 bg-[#F0B90B] text-black font-black text-xs py-2 uppercase tracking-wider">Go to My Agents</button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Hire this BAN agent to your account to create a task, set its scoped session and spend limits, and let it start executing on BNB Chain.
                </p>
              )}

              {!deployedAgentId && (
                <LoadingButton
                  onClick={handleDeployAgent}
                  loading={deploying}
                  loadingLabel="Hiring..."
                  variant="primary"
                >
                  HIRE AGENT
                </LoadingButton>
              )}
            </div>

            {/* PROTOCOL STATE — real registry snapshot per agent skill (never fabricated). */}
            <div className="bg-card rounded-xl p-5 border border-border space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-foreground tracking-widest uppercase">PROTOCOL STATE</span>
                {protocolSnapshot && (
                  <span className="text-[9px] font-mono text-muted-foreground">
                    BNB {protocolSnapshot.chainId} · registry-derived
                  </span>
                )}
              </div>

              {protocolSnapshotError && (
                <p className="text-xs text-muted-foreground">{protocolSnapshotError} <button type="button" onClick={fetchProtocolSnapshot} className="text-[#F0B90B] font-black uppercase text-[10px]">Retry</button></p>
              )}

              {!protocolSnapshotError && protocolSnapshot == null && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="inline-block animate-spin h-3.5 w-3.5 border-2 border-[#F0B90B] border-t-transparent rounded-full" />
                  Loading protocol state...
                </div>
              )}

              {protocolSnapshot && (
                <>
                  {agentProtocolState.length === 0 && unknownProtocols.length === 0 && (
                    <p className="text-xs text-muted-foreground">This agent does not declare any protocols for on-chain work.</p>
                  )}

                  {agentProtocolState.length > 0 && (
                    <div className="space-y-4">
                      {agentProtocolState.map((p) => (
                        <div key={p.id} className="bg-card rounded-lg border border-[#262626] p-3.5 space-y-2.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2">
                              <CryptoIcon symbol={p.name} size={18} />
                              <span className="text-sm font-black text-foreground">{p.name}</span>
                              {p.priority && (
                                <span className="text-[9px] font-black tracking-wider uppercase bg-[#1A1A1A] border border-border px-1.5 py-0.5 text-muted-foreground">{p.priority}</span>
                              )}
                            </div>
                            <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded border ${integrationColor(p.integrationStatus)}`}>
                              {p.integrationStatus.replace(/_/g, ' ')}
                            </span>
                          </div>

                          <p className="text-[11px] text-muted-foreground leading-relaxed">{p.reason}</p>

                          <div className="space-y-2">
                            {p.contracts.length === 0 ? (
                              <p className="text-[11px] text-gray-600">No verified contracts registered for this protocol on the BAN chain.</p>
                            ) : (
                              p.contracts.map((c) => (
                                <div key={c.id} className="bg-background/40 rounded-md border border-border p-2.5 space-y-1.5">
                                  <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <span className="text-[11px] font-black text-gray-200">{c.name}</span>
                                    <span className="flex items-center gap-1.5">
                                      <span className={`text-[9px] font-black uppercase ${c.verified ? 'text-green-400' : 'text-muted-foreground'}`}>{c.verified ? 'Verified' : 'Unverified'}</span>
                                      <span className={`text-[9px] font-black uppercase ${c.enabled ? 'text-[#F0B90B]' : 'text-muted-foreground'}`}>{c.enabled ? 'Enabled' : 'Not enabled'}</span>
                                    </span>
                                  </div>
                                  <p className="text-[10px] font-mono text-muted-foreground truncate">{c.address}</p>
                                  {c.capabilities.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                      {c.capabilities.map((cap) => (
                                        <span key={cap} className="text-[9px] font-black text-muted-foreground bg-[#1A1A1A] border border-border px-1.5 py-0.5">{cap}</span>
                                      ))}
                                    </div>
                                  )}
                                  {c.functions.length > 0 && (
                                    <div className="flex flex-wrap gap-1 pt-0.5">
                                      {c.functions.map((f) => (
                                        <span
                                          key={f.name}
                                          className={`text-[9px] font-mono px-1.5 py-0.5 border ${f.capability === 'EXECUTE' ? 'text-[#F0B90B] border-[#F0B90B]/40 bg-[#F0B90B]/10' : 'text-blue-400 border-blue-500/30 bg-blue-500/5'}`}
                                        >
                                          {f.name} · {f.capability}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {unknownProtocols.length > 0 && (
                    <div className="space-y-1.5">
                      {unknownProtocols.map((pid) => (
                        <div key={pid} className="flex items-center justify-between text-[11px] bg-card border border-[#262626] rounded-md px-3 py-2">
                          <span className="text-gray-300">{pid}</span>
                          <span className="text-[9px] font-black uppercase text-muted-foreground border border-gray-700 px-1.5 py-0.5 rounded">Unrecognized</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}

        {activeTab === 'strategy' && (
          <>
            <div className="bg-card rounded-xl p-5 border border-border space-y-4">
              <span className="text-[10px] font-black text-foreground tracking-widest uppercase block">STRATEGY</span>
              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Strategy ID</span>
                  <span className="font-mono text-gray-200">{agent.strategyId ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type</span>
                  <span className="text-gray-200 capitalize">{agent.type ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Risk</span>
                  <span className="text-gray-200">{agent.riskLevel ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cost / Run</span>
                  <span className="text-gray-200 font-mono">{agent.costPerExecution != null ? `${agent.costPerExecution} credits` : '—'}</span>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-xl p-5 border border-border space-y-3">
              <span className="text-[10px] font-black text-foreground tracking-widest uppercase block">PROTOCOLS</span>
              {agent.protocols && agent.protocols.length > 0 ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {agent.protocols.map((p) => (
                    <span key={p} className="flex items-center gap-2 text-[10px] font-black text-[#F0B90B] bg-[#1A1A1A] border border-border px-2.5 py-1">
                      <CryptoIcon symbol={p} size={18} />
                      {p}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No protocols specified for this agent.</p>
              )}
            </div>

            <div className="bg-card rounded-xl p-5 border border-border space-y-3">
              <span className="text-[10px] font-black text-foreground tracking-widest uppercase block">CAPABILITIES</span>
              {agent.capabilities && agent.capabilities.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {agent.capabilities.map((c) => (
                    <span key={capLabel(c)} className="text-[10px] font-black text-[#F0B90B] bg-[#1A1A1A] border border-border px-2.5 py-1">{capLabel(c)}</span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No capabilities specified.</p>
              )}
            </div>

            <div className="bg-card rounded-xl p-5 border border-border space-y-2.5 text-xs">
              <span className="text-[10px] font-black text-foreground tracking-widest uppercase block mb-1">AGENT INFO</span>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Agent ID</span>
                <span className="font-mono text-gray-200">{agent.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span className="text-gray-200">{new Date(agent.createdAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Chain</span>
                <span className="text-gray-200 font-mono">{agent.chainId ? `BNB ${agent.chainId}` : 'BNB Chain'}</span>
              </div>
              {agent.walletAddress && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Wallet</span>
                  <span className="text-gray-200 font-mono">{agent.walletAddress}</span>
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === 'activity' && (
          <div className="bg-card rounded-xl p-5 border border-border">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-black text-foreground tracking-widest uppercase">ACTIVITY</span>
              {confirmedCount > 0 && (
                <button type="button" onClick={() => setActiveTab('overview')} className="text-[10px] font-black text-[#F0B90B] tracking-wider uppercase flex items-center gap-1">
                  VIEW PERFORMANCE
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F0B90B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7" /><path d="M7 7h10v10" /></svg>
                </button>
              )}
            </div>

            <div className="space-y-4">
              {events.length === 0 ? (
                <div className="text-center py-8">
                  {activityError ? (
                  <div className="space-y-3">
                    <p className="text-sm font-black text-[#F0B90B] uppercase tracking-wider">Activity restricted</p>
                    <p className="text-xs text-muted-foreground leading-relaxed max-w-sm mx-auto">{activityError}</p>
                    <p className="text-[11px] text-muted-foreground max-w-sm mx-auto">
                      Live activity is only visible to the account that hired this agent. Hire it to see its audit trail, or sign in with the owning account.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm font-black text-muted-foreground mb-1">No activity events yet</p>
                )}
                  <p className="text-xs text-muted-foreground">Events will appear here once this agent records its first on-chain activity (e.g. AI decisions, submissions, confirmations).</p>
                </div>
              ) : (
                events.slice(0, 8).map((ev) => (
                  <div key={ev.id} className="flex items-start gap-3 text-xs">
                    <div className="w-7 h-7 rounded-full bg-[#1A1A1A] border border-border flex items-center justify-center text-[#F0B90B] shrink-0">
                      {getTimelineIcon(ev.eventType)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline mb-0.5">
                        <p className="font-black text-gray-200">{getTimelineTitle(ev.eventType)}</p>
                        <span className="text-[10px] font-mono text-muted-foreground">{new Date(ev.createdAt).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <p className="text-muted-foreground text-[11px] truncate">{getTimelineSubtitle(ev.eventType, ev.payload)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <MobileBottomNav />
    </div>
  );
}