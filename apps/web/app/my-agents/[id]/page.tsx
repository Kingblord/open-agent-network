'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';
import { useToast } from '@/components/toast-provider';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { LoadingButton } from '@/components/ui/loading-button';

interface Session {
  sessionId: string;
  status: string;
  walletAddress: string;
  allowedContracts: string[];
  allowedFunctions: string[];
  allowedTokens: string[];
  spendCap: string;
  perTransactionCap: string;
  expiresAt: string;
  createdAt: string;
}

interface AgentDetail {
  id: string;
  name: string;
  description: string;
  type: string;
  strategyId?: string;
  status: string;
  riskLevel: string;
  walletAddress?: string;
  capabilities: { id: string; name: string; description?: string }[];
  protocols: string[];
  costPerExecution?: number;
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

type LifecycleAction = 'activate' | 'pause' | 'revoke';

const TIMELINE_ICONS: Record<string, React.ReactNode> = {
  OBSERVATION_CREATED: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
    </svg>
  ),
  AI_DECISION_CREATED: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  ),
  ACTION_PROPOSED: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
  ACTION_APPROVED: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  ACTION_DENIED: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  TRANSACTION_SUBMITTED: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  ),
  TRANSACTION_CONFIRMED: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  TRANSACTION_FAILED: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  POSITION_UPDATED: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 3h5v5L8 21l-5-5z" />
    </svg>
  ),
};

function getTimelineIcon(eventType: string) {
  return TIMELINE_ICONS[eventType] ?? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
    </svg>
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
  // Only surface real payload fields — never substitute fabricated values.
  switch (eventType) {
    case 'TRANSACTION_SUBMITTED':
    case 'TRANSACTION_CONFIRMED':
    case 'TRANSACTION_FAILED': {
      const hash = typeof payload.hash === 'string' ? payload.hash : typeof payload.txHash === 'string' ? payload.txHash : '';
      return hash ? `0x${hash.replace(/^0x/, '').slice(0, 10)}` : 'On-chain transaction recorded';
    }
    case 'POSITION_UPDATED': {
      const symbol = typeof payload.symbol === 'string' ? payload.symbol : '';
      const amount = typeof payload.amount === 'string' ? payload.amount : '';
      return symbol && amount ? `${amount} ${symbol}` : 'Position record updated';
    }
    default: {
      const entries = Object.entries(payload).filter(([k]) => !['correlationId', 'agentId'].includes(k));
      return entries.slice(0, 1).map(([k, v]) => `${k}: ${String(v)}`).join(', ') || 'Operation recorded';
    }
  }
}

function renderUsdc(value: number, fractionDigits = 2): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
}

export default function MyAgentDetailPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const toast = useToast();
  const [mounted, setMounted] = useState(false);
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [performance, setPerformance] = useState<PerformanceData | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [activeViewTab, setActiveViewTab] = useState<'overview' | 'analytics'>('overview');
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [sessionForm, setSessionForm] = useState({
    walletAddress: '',
    spendCap: '1000000000000000000',
    perTransactionCap: '100000000000000000',
    allowedContracts: '',
    allowedFunctions: 'deposit, withdraw, swap',
    allowedTokens: 'USDT, BNB, CAKE',
    expiresAtDays: 30,
  });

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { if (mounted && !loading && !user) router.push('/login'); }, [mounted, user, loading, router]);
  useEffect(() => {
    if (user && params.id) {
      fetchAgent();
      fetchSessions();
      fetchActivity();
      fetchPerformance();
    }
  }, [user, params.id]);

  const fetchAgent = async () => {
    try {
      const response = await fetch(`/api/agents/${params.id}`);
      if (response.ok) {
        const data = await response.json();
        setAgent(data.agent);
      } else {
        router.push('/my-agents');
      }
    } catch (error) {
      console.error('Failed to fetch agent:', error);
    } finally {
      setPageLoading(false);
    }
  };

  const fetchSessions = async () => {
    try {
      const response = await fetch(`/api/agents/${params.id}/sessions`);
      if (response.ok) {
        const data = await response.json();
        setSessions(data.sessions ?? []);
      }
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
    }
  };

  const fetchActivity = async () => {
    try {
      const response = await fetch(`/api/agents/${params.id}/activity?limit=50`);
      if (response.ok) {
        const data = await response.json();
        setEvents(data.events ?? []);
      }
    } catch (error) {
      console.error('Failed to fetch activity:', error);
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

  const handleLifecycle = async (action: LifecycleAction) => {
    setActionLoading(action);
    try {
      const response = await fetch(`/api/agents/${params.id}/lifecycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (response.ok) {
        const data = await response.json();
        setAgent(data.agent);
        fetchActivity();
        const label = action === 'activate' ? 'Agent activated' : action === 'pause' ? 'Agent paused' : 'Agent revoked';
        toast.success({
          title: label,
          description:
            action === 'activate'
              ? 'Your agent is now active and can execute within its session limits.'
              : action === 'pause'
                ? 'Your agent has been paused and will not execute new actions.'
                : 'Access has been permanently revoked.',
        });
      } else {
        const error = await response.json();
        toast.error({ title: 'Action failed', description: error.error || 'An unexpected error occurred.' });
      }
    } catch (error) {
      console.error('Lifecycle error:', error);
      toast.error({ title: 'Action failed', description: 'An unexpected error occurred.' });
    } finally {
      setActionLoading(null);
      setRevokeOpen(false);
    }
  };

  const handleRunCycle = async () => {
    setActionLoading('run');
    try {
      const response = await fetch(`/api/agents/${params.id}/run`, { method: 'POST' });
      if (response.ok) {
        const data = await response.json();
        const stage = data.result?.stage ?? 'unknown';
        const ok = !!data.ok;
        const messages: Record<string, string> = {
          observed: 'Observation complete (no action needed).',
          decided: 'Cycle complete — agent passed.',
          awaited: 'Agent is awaiting execution (ensure an ACTIVE session and funded wallet).',
          confirmed: 'Trade confirmed on-chain!',
        };
        if (ok) {
          toast.success({
            title: 'Cycle complete',
            description: messages[stage] || 'Closed-loop cycle finished.',
          });
        } else {
          toast.error({
            title: 'Cycle result',
            description: data.result?.reason || 'The cycle did not complete successfully.',
          });
        }
        fetchActivity();
        fetchPerformance();
        fetchSessions();
      } else {
        const error = await response.json();
        toast.error({ title: 'Run failed', description: error.error || 'An unexpected error occurred.' });
      }
    } catch (error) {
      console.error('Run cycle error:', error);
      toast.error({ title: 'Run failed', description: 'An unexpected error occurred.' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateSession = async () => {
    setSessionLoading(true);
    try {
      const body = {
        walletAddress: sessionForm.walletAddress || agent?.walletAddress || '',
        spendCap: sessionForm.spendCap,
        perTransactionCap: sessionForm.perTransactionCap,
        allowedContracts: sessionForm.allowedContracts
          ? sessionForm.allowedContracts.split(',').map((s) => s.trim()).filter(Boolean)
          : [],
        allowedFunctions: sessionForm.allowedFunctions
          ? sessionForm.allowedFunctions.split(',').map((s) => s.trim()).filter(Boolean)
          : [],
        allowedTokens: sessionForm.allowedTokens
          ? sessionForm.allowedTokens.split(',').map((s) => s.trim()).filter(Boolean)
          : [],
        expiresAtMs: Date.now() + sessionForm.expiresAtDays * 24 * 60 * 60 * 1000,
      };

      const response = await fetch(`/api/agents/${params.id}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        await fetchSessions();
        await fetchActivity();
        setShowSessionModal(false);
        toast.success({
          title: 'Session created',
          description: 'Your scoped session and limits have been saved.',
        });
      } else {
        const error = await response.json();
        toast.error({ title: 'Session failed', description: error.error || 'An unexpected error occurred.' });
      }
    } catch (error) {
      console.error('Session creation error:', error);
      toast.error({ title: 'Session failed', description: 'An unexpected error occurred.' });
    } finally {
      setSessionLoading(false);
    }
  };

  const formatEventTimestamp = (iso: string) => {
    const d = new Date(iso);
    return d.toTimeString().split(' ')[0];
  };

  const timeAgo = (iso: string | null) => {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const fetchSuccess = () => fetchActivity();

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black text-white">
        <div className="inline-block animate-spin h-8 w-8 border-4 border-[#F0B90B] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (pageLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black text-white">
        <div className="text-center space-y-3">
          <div className="inline-block animate-spin h-8 w-8 border-4 border-[#F0B90B] border-t-transparent rounded-full" />
          <p className="text-xs text-[#F0B90B] font-mono tracking-widest uppercase">Loading Agent Details...</p>
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="min-h-screen bg-black text-white p-6 flex flex-col items-center justify-center">
        <p className="text-gray-400 mb-4">Agent not found</p>
        <button onClick={() => router.push('/my-agents')} className="bg-[#F0B90B] text-black text-xs font-black px-4 py-2 uppercase tracking-wider">Return to My Agents</button>
      </div>
    );
  }

  const primaryProtocol = agent.protocols[0] || null;

  // ---- Real operational metrics only (no fabricated fallbacks) ----
  const confirmedCount = performance?.confirmedCount ?? 0;
  const successRateText = confirmedCount > 0 && performance
    ? `${(parseFloat(performance.successRate) * 100).toFixed(0)}%`
    : null;
  const capitalUsd = Number(performance?.capitalManagedUsd || '0');
  const hasRealPositions = performance?.hasPositions === true;
  const tvlDisplay = hasRealPositions && capitalUsd > 0 ? `$${renderUsdc(capitalUsd)}` : null;
  const realizedPnlUsd = performance?.realizedPnlUsd ? Number(performance.realizedPnlUsd) : null;
  const lastExecutedAt = performance?.lastExecutedAt ?? null;

  // ---- Real session-driven permissions (no invented spend numbers) ----
  const activeSession = sessions.find((s) => s.status === 'ACTIVE') || sessions[0] || null;
  const sessionSpendCapWei = activeSession && Number(activeSession.spendCap) > 0 ? Number(activeSession.spendCap) : null;
  const spendLimitMax = sessionSpendCapWei ? sessionSpendCapWei / 1e18 : null;
  const perTxCap = activeSession && Number(activeSession.perTransactionCap) > 0
    ? Number(activeSession.perTransactionCap) / 1e18
    : null;

  // Count actual failure/denial events from the live event feed.
  const failedEvents = events.filter((e) => e.eventType === 'TRANSACTION_FAILED' || e.eventType === 'ACTION_DENIED').length;

  return (
    <div className="min-h-screen bg-black text-white font-sans antialiased pb-28">
      <header className="sticky top-0 z-40 bg-black/95 backdrop-blur px-5 py-4 flex items-center justify-between border-b border-[#1A1A1A]">
        <button onClick={() => router.push('/my-agents')} className="text-white hover:text-[#F0B90B] transition" aria-label="Back">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="text-sm font-black tracking-[0.2em] uppercase text-white">AGENT DETAILS</h1>
        <button onClick={() => setActiveViewTab(activeViewTab === 'overview' ? 'analytics' : 'overview')} className="text-[10px] font-black text-[#F0B90B] border border-[#333] px-2.5 py-1.5 bg-[#111]">
          {activeViewTab === 'overview' ? 'ANALYTICS' : 'OVERVIEW'}
        </button>
      </header>

      <div className="px-5 pt-4 space-y-4">
        {activeViewTab === 'overview' ? (
          <>
            <div className="bg-[#111] rounded-xl p-5 border border-[#222]">
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
                    {primaryProtocol && <span className="text-xs text-gray-400">On {primaryProtocol}</span>}
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

              <div className="grid grid-cols-3 gap-2 pt-4 border-t border-[#222] text-center">
                <div>
                  <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mb-1">CONFIRMED EXEC</p>
                  <p className="text-base font-black text-white">{confirmedCount > 0 ? confirmedCount : 'None yet'}</p>
                </div>
                <div>
                  <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mb-1">CAPITAL MANAGED</p>
                  <p className="text-base font-black text-white">{tvlDisplay ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mb-1">SUCCESS RATE</p>
                  <p className={successRateText ? 'text-base font-black text-emerald-400' : 'text-base font-black text-gray-400'}>{successRateText ?? '—'}</p>
                </div>
              </div>

              {performance && (
                <div className="mt-4 pt-3 border-t border-[#222] grid grid-cols-2 gap-2 text-center">
                  <div className="bg-[#161616] rounded-lg p-3">
                    <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mb-1">Total trades</p>
                    <p className="text-sm font-black text-white">{performance.totalTrades}</p>
                  </div>
                  <div className="bg-[#161616] rounded-lg p-3">
                    <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mb-1">Avg execution</p>
                    <p className="text-sm font-black text-white">{performance.avgExecutionMs ? `${performance.avgExecutionMs}ms` : '—'}</p>
                  </div>
                </div>
              )}

              {performance && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-gray-500">
                  <span>Mode</span>
                  <span className="font-black text-[#F0B90B] uppercase">{performance.mode} — {performance.modeReason}</span>
                </div>
              )}
            </div>

            <div className="bg-[#111] rounded-xl p-5 border border-[#222] space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-white tracking-widest uppercase">PERMISSIONS & LIMITS</span>
                <button type="button" onClick={() => setShowSessionModal(true)} className="bg-[#1A1A1A] text-[10px] text-gray-300 font-black px-2.5 py-1 border border-[#333] hover:text-white">EDIT SESSION</button>
              </div>

              {activeSession ? (
                <>
                  <div>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-gray-400">Spend Cap</span>
                      <span className="text-white font-black font-mono">
                        {spendLimitMax != null ? `${renderUsdc(spendLimitMax)} BNB` : '—'}
                      </span>
                    </div>
                    <div className="h-1.5 bg-[#222] rounded-full overflow-hidden" />
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">Max Tx / Session</span>
                    <span className="text-white font-black font-mono">
                      {perTxCap != null ? `${renderUsdc(perTxCap)} BNB` : '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-gray-400 block mb-1">Session</span>
                    <span className="text-white font-black font-mono">{activeSession.sessionId.slice(0, 10)}...</span>
                    <span className="text-xs text-gray-500 ml-2">({activeSession.status})</span>
                  </div>
                  {activeSession.allowedFunctions && activeSession.allowedFunctions.length > 0 && (
                    <div>
                      <span className="text-xs text-gray-400 block mb-1.5">Allowed Functions</span>
                      <div className="flex flex-wrap gap-1.5">
                        {activeSession.allowedFunctions.map((fn) => (
                          <span key={fn} className="text-[10px] font-black text-[#F0B90B] bg-[#1A1A1A] border border-[#333] px-2 py-0.5">{fn}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="pt-2 pb-1">
                  <p className="text-sm font-black text-gray-400 mb-1">No active session</p>
                  <p className="text-xs text-gray-500">Create a scoped session to set spend caps and allowed functions.</p>
                </div>
              )}

              {failedEvents > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Failed / denied events</span>
                  <span className="text-red-400 font-black">{failedEvents}</span>
                </div>
              )}

              <div className="pt-2 space-y-2">
                {agent.status === 'ACTIVE' ? (
                  <LoadingButton
                    onClick={() => handleLifecycle('pause')}
                    loading={actionLoading === 'pause'}
                    loadingLabel="Pausing..."
                    variant="primary"
                  >
                    PAUSE AGENT
                  </LoadingButton>
                ) : agent.status === 'REVOKED' ? (
                  <button type="button" disabled className="w-full bg-[#1A1A1A] border border-[#333] text-gray-500 font-black text-xs py-3.5 tracking-[0.15em] uppercase cursor-not-allowed">
                    REVOKED (TERMINAL)
                  </button>
                ) : (
                  <LoadingButton
                    onClick={() => handleLifecycle('activate')}
                    loading={actionLoading === 'activate'}
                    loadingLabel="Activating..."
                    variant="primary"
                  >
                    ACTIVATE AGENT
                  </LoadingButton>
                )}
                {/* Manual closed-loop trigger (M18) — safe: never fabricates a receipt. */}
                <LoadingButton
                  onClick={handleRunCycle}
                  loading={actionLoading === 'run'}
                  loadingLabel="Running..."
                  variant="outline"
                  disabled={agent.status !== 'ACTIVE'}
                >
                  RUN CYCLE NOW
                </LoadingButton>
                {agent.status !== 'REVOKED' && (
                  <button type="button" onClick={() => setRevokeOpen(true)} disabled={actionLoading === 'revoke'} className="w-full bg-[#1A1A1A] border border-[#333] text-red-400 font-black text-xs py-3.5 tracking-[0.15em] uppercase hover:border-red-500/50 transition disabled:opacity-60">
                    {actionLoading === 'revoke' ? 'REVOKING...' : 'REVOKE ACCESS'}
                  </button>
                )}
              </div>
            </div>

            <div className="bg-[#111] rounded-xl p-5 border border-[#222]">
              <div className="flex items-center justify-between mb-4">
                <span className="text-[10px] font-black text-white tracking-widest uppercase">LIVE ACTIVITY</span>
                <button type="button" onClick={() => setActiveViewTab('analytics')} className="text-[10px] font-black text-[#F0B90B] tracking-wider uppercase flex items-center gap-1">
                  VIEW ALL ANALYTICS
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F0B90B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7" /><path d="M7 7h10v10" /></svg>
                </button>
              </div>

              <div className="space-y-4">
                {events.length === 0 ? (
                  <p className="text-xs text-gray-500 py-2">No activity events recorded yet.</p>
                ) : (
                  events.slice(0, 6).map((ev) => (
                    <div key={ev.id} className="flex items-start gap-3 text-xs">
                      <div className="w-7 h-7 rounded-full bg-[#1A1A1A] border border-[#333] flex items-center justify-center text-[#F0B90B] shrink-0">
                        {getTimelineIcon(ev.eventType)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-baseline mb-0.5">
                          <p className="font-black text-gray-200">{getTimelineTitle(ev.eventType)}</p>
                          <span className="text-[10px] font-mono text-gray-500">{formatEventTimestamp(ev.createdAt)}</span>
                        </div>
                        <p className="text-gray-400 text-[11px] truncate">{getTimelineSubtitle(ev.eventType, ev.payload)}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="bg-[#111] rounded-xl p-5 border border-[#222]">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-black text-white tracking-widest uppercase">PERFORMANCE</span>
              </div>

              <div className="mb-2">
                <p className="text-[9px] text-gray-500 font-black uppercase tracking-wider">REALIZED P&L</p>
                <p className={realizedPnlUsd != null ? `text-2xl font-black ${realizedPnlUsd >= 0 ? 'text-green-400' : 'text-red-400'}` : 'text-2xl font-black text-gray-400'}>
                  {realizedPnlUsd != null ? `$${renderUsdc(realizedPnlUsd)}` : 'Not available'}
                </p>
                <p className="text-[10px] text-gray-500 mt-1">
                  {realizedPnlUsd != null
                    ? 'Derived from signed on-chain position records.'
                    : 'P&L appears once BAN records a closed on-chain position for this agent.'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-4 pt-3 border-t border-[#222]">
                <div>
                  <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mb-1">Confirmed</p>
                  <p className="text-sm font-black text-white">{performance?.confirmedCount ?? 0}</p>
                </div>
                <div>
                  <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mb-1">Failed</p>
                  <p className="text-sm font-black text-red-400">{performance?.failedCount ?? 0}</p>
                </div>
                <div>
                  <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mb-1">Gas (BNB)</p>
                  <p className="text-sm font-black text-white font-mono">{performance && Number(performance.totalFeesWei) > 0 ? (Number(performance.totalFeesWei) / 1e18).toFixed(6) : '—'}</p>
                </div>
                <div>
                  <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mb-1">Last executed</p>
                  <p className="text-sm font-black text-white">{timeAgo(lastExecutedAt)}</p>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="bg-[#111] rounded-xl p-5 border border-[#222]">
              <span className="text-[10px] font-black text-white tracking-widest uppercase block mb-4">ALLOCATION</span>
              {hasRealPositions && capitalUsd > 0 ? (
                <p className="text-xs text-gray-400">
                  Capital managed: ${renderUsdc(capitalUsd)}. Per-asset allocation is derived from on-chain position records.
                </p>
              ) : (
                <div className="py-3">
                  <p className="text-sm font-black text-gray-400">No allocation data</p>
                  <p className="text-xs text-gray-500 mt-1">
                    This agent has no recorded positions, so there is no allocation breakdown to show.
                  </p>
                </div>
              )}
            </div>

            <div className="bg-[#111] rounded-xl p-5 border border-[#222]">
              <span className="text-[10px] font-black text-white tracking-widest uppercase block mb-3">HOLDINGS</span>
              {hasRealPositions && capitalUsd > 0 ? (
                <p className="text-xs text-gray-400">
                  ${renderUsdc(capitalUsd)} capital managed. Individual token holdings are listed from position records.
                </p>
              ) : (
                <div className="text-center py-6">
                  <p className="text-sm font-black text-gray-400">No holdings</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Holdings are shown only when on-chain position records exist for this agent.
                  </p>
                </div>
              )}
            </div>

            <div className="bg-[#111] rounded-xl p-5 border border-[#222] space-y-3">
              <span className="text-[10px] font-black text-white tracking-widest uppercase block">AI REASONING (LATEST)</span>
              {(() => {
                const decision = events.find((e) => e.eventType === 'AI_DECISION_CREATED');
                if (!decision) {
                  return (
                    <div className="text-center py-4">
                      <p className="text-sm font-black text-gray-400">Not available</p>
                      <p className="text-xs text-gray-500 mt-1">
                        An AI reasoning record will appear the next time BAN records an AI decision event for this agent.
                      </p>
                    </div>
                  );
                }
                const payloadEntries = Object.entries(decision.payload);
                const summary = payloadEntries.length
                  ? payloadEntries.map(([k, v]) => `${k}: ${String(v)}`).join(' · ')
                  : 'AI decision recorded.';
                return (
                  <blockquote className="text-xs text-gray-300 italic bg-[#161616] p-3.5 border-l-2 border-[#F0B90B] leading-relaxed">
                    {summary}
                  </blockquote>
                );
              })()}
            </div>

            <div className="bg-[#111] rounded-xl p-5 border border-[#222] space-y-2.5 text-xs">
              <span className="text-[10px] font-black text-white tracking-widest uppercase block mb-1">AGENT INFO</span>
              <div className="flex justify-between">
                <span className="text-gray-500">Agent ID</span>
                <span className="font-mono text-gray-200">{agent.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Created</span>
                <span className="text-gray-200">{new Date(agent.createdAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Last executed</span>
                <span className="text-gray-200">{timeAgo(lastExecutedAt)}</span>
              </div>
              {agent.aiModel && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Model</span>
                  <span className="text-gray-200 font-mono">{agent.aiModel}</span>
                </div>
              )}
              {agent.version && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Version</span>
                  <span className="text-gray-200 font-mono">{agent.version}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Status</span>
                <span className="text-emerald-400 font-black">{agent.status}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Chain</span>
                <span className="text-gray-200 font-mono">{agent.chainId ? `BNB ${agent.chainId}` : 'BNB Chain'}</span>
              </div>
            </div>

            <div className="bg-[#111] rounded-xl p-5 border border-[#222] space-y-3">
              <span className="text-[10px] font-black text-white tracking-widest uppercase block">RELATED</span>
              <div className="space-y-2 text-xs">
                <button type="button" onClick={() => window.open(`https://bscscan.com/address/${agent.walletAddress || ''}`, '_blank')} className="w-full flex items-center justify-between text-gray-300 hover:text-[#F0B90B] transition">
                  <span>{agent.walletAddress ? 'View on BscScan' : 'No wallet linked'}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F0B90B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7" /><path d="M7 7h10v10" /></svg>
                </button>
                <button type="button" onClick={() => router.push('/history')} className="w-full flex items-center justify-between text-gray-300 hover:text-[#F0B90B] transition">
                  <span>View Transactions</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F0B90B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7" /><path d="M7 7h10v10" /></svg>
                </button>
                <button type="button" onClick={() => router.push('/agents')} className="w-full flex items-center justify-between text-gray-300 hover:text-[#F0B90B] transition">
                  <span>Agent Marketplace</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F0B90B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7" /><path d="M7 7h10v10" /></svg>
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {showSessionModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#111] border border-[#333] rounded-xl p-6 w-full max-w-md space-y-4">
            <h3 className="text-base font-black text-[#F0B90B] uppercase">Configure Session Limits</h3>
            <div>
              <label className="block text-xs font-black text-gray-400 mb-1">Spend Cap (wei)</label>
              <input type="text" value={sessionForm.spendCap} onChange={(e) => setSessionForm({ ...sessionForm, spendCap: e.target.value })} className="w-full bg-black border border-[#333] px-3 py-2 text-xs font-mono text-white rounded" />
            </div>
            <div>
              <label className="block text-xs font-black text-gray-400 mb-1">Allowed Functions</label>
              <input type="text" value={sessionForm.allowedFunctions} onChange={(e) => setSessionForm({ ...sessionForm, allowedFunctions: e.target.value })} className="w-full bg-black border border-[#333] px-3 py-2 text-xs font-mono text-white rounded" />
            </div>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setShowSessionModal(false)} disabled={sessionLoading} className="flex-1 bg-[#222] text-white text-xs font-black py-2.5 uppercase disabled:opacity-60">Cancel</button>
              <LoadingButton onClick={handleCreateSession} loading={sessionLoading} loadingLabel="Saving..." variant="primary">Save Session</LoadingButton>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={revokeOpen}
        title="Revoke agent access?"
        description="Revoking is permanent. The agent will no longer be able to execute on your behalf, and its sessions will be terminated. This cannot be undone."
        confirmLabel="Revoke access"
        cancelLabel="Cancel"
        dangerous
        loading={actionLoading === 'revoke'}
        onConfirm={() => handleLifecycle('revoke')}
        onCancel={() => setRevokeOpen(false)}
      />

      <MobileBottomNav />
    </div>
  );
}