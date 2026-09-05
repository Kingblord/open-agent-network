'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';
import { useToast } from '@/components/toast-provider';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { LoadingButton } from '@/components/ui/loading-button';
import { TransactionConfirmModal } from '@/components/ui/transaction-confirm-modal';
import { useSendTransaction, useActiveAccount } from 'thirdweb/react';
import { parseEther, encodeFunctionData, parseUnits } from 'viem';
import { getThirdwebClient, bnbChainDef } from '@/lib/thirdweb';
import { useWallet } from '@/lib/wallet-context';
import { LiveRuntimeTerminal } from '@/components/live-runtime-terminal';
import { PermissionCards } from '@/components/permission-cards';

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

interface TaskRecord {
  taskId: string;
  agentId: string;
  ownerId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  config: {
    network: string;
    chainId: number;
    maxTxUsd: string;
    dailyLimitUsd: string;
    maxTxWei: string;
    dailyWei: string;
    allowedTokens: string[];
    allowedProtocols: string[];
    allowedFunctions: string[];
    riskLevel: string;
    expiresAtMs: number;
  };
  sessionId: string | null;
  lastRun: { at: string; result: Record<string, unknown> } | null;
  createdAt: string;
  updatedAt: string;
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
  AGENT_TICK: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
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
    case 'AGENT_TICK': return 'Scheduled cycle (Inngest cron)';
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
    case 'POSITION_UPDATED': {
      const symbol = typeof payload.symbol === 'string' ? payload.symbol : '';
      const amount = typeof payload.amount === 'string' ? payload.amount : '';
      return symbol && amount ? `${amount} ${symbol}` : 'Position record updated';
    }
    case 'AGENT_TICK': {
      const cr = (payload.cycleResult ?? {}) as Record<string, unknown>;
      const stage = typeof cr.stage === 'string' ? cr.stage : '';
      if (stage === 'confirmed') return 'Cycle confirmed an on-chain transaction';
      if (stage === 'awaited') return 'Cycle complete — awaiting execution (session/wallet)';
      if (stage === 'decided') return 'Cycle complete — agent passed (no action)';
      return stage ? `Cycle finished at stage: ${stage}` : 'Scheduler heartbeat recorded';
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

// mustflow §6 bounded-authority options (client-side lists; server resolves
// them through the fail-closed BAN registries into canonical addresses).
const TOKEN_OPTIONS = [
  { symbol: 'BNB', label: 'BNB (native)' },
  { symbol: 'WBNB', label: 'WBNB' },
  { symbol: 'USDT', label: 'USDT' },
  { symbol: 'USDC', label: 'USDC' },
];

// mustflow §10-§13: protocol selectability is derived from the LIVE registry
// snapshot (GET /api/protocols →’ buildBnbRegistrySnapshot). This used to be
// hardcoded verified:false — which greyed out PancakeSwap/Venus even though the
// registry marks them verified + EXECUTION_ENABLED. We now fall back to
// enabled-by-default only when the snapshot cannot be loaded; the server's
// fail-closed resolution is always the real gate (unverified →’ CONTRACT_NOT_ALLOWED).
const FALLBACK_PROTOCOL_OPTIONS = [
  { id: 'pancakeswap', label: 'PancakeSwap', verified: true },
  { id: 'venus', label: 'Venus', verified: true },
];

const RISK_OPTIONS = ['LOW', 'MEDIUM', 'HIGH'];

const REGISTRY_ERROR_CODES = new Set([
  'ERR_CONTRACT_NOT_ALLOWED',
  'ERR_TOKEN_NOT_ALLOWED',
  'ERR_SPEND_LIMIT_EXCEEDED',
]);

export default function MyAgentDetailPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const toast = useToast();
  const wallet = useWallet();
  const activeAccount = useActiveAccount();
  const thirdwebClient = useMemo(() => getThirdwebClient(), []);
  const { mutateAsync: sendTransactionTx } = useSendTransaction();
  const [mounted, setMounted] = useState(false);
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [performance, setPerformance] = useState<PerformanceData | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [activeViewTab, setActiveViewTab] = useState<'overview' | 'analytics'>('overview');
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [gasUsd, setGasUsd] = useState('0.50');
  const [showGasEdit, setShowGasEdit] = useState(false);
  const [showTaskConfirm, setShowTaskConfirm] = useState(false);
  const [taskConfirmData, setTaskConfirmData] = useState<{
    walletAddress: string;
    amountBnb: string;
    depositToken: string;
    depositUsd: string;
  } | null>(null);
  const [topupOpen, setTopupOpen] = useState(false);
  const [topupLoading, setTopupLoading] = useState(false);
  const [topupAmount, setTopupAmount] = useState('0.01');
  const [topupResult, setTopupResult] = useState<{
    topupRequestId: string;
    walletAddress: string;
    amountBnb: string;
    network: string;
    chainId: number;
    note: string;
    status?: string;
    txHash?: string | null;
  } | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawToken, setWithdrawToken] = useState<'BNB' | 'USDT' | 'USDC'>('BNB');
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawResult, setWithdrawResult] = useState<{ txHash: string; amount: string; token: string; to: string } | null>(null);
  const [balance, setBalance] = useState<{
    ok: boolean;
    address: string | null;
    balanceBnb: string | null;
    balanceUsd: string | null;
    usdPrice: number | null;
    updatedAt: string;
  } | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [sessionForm, setSessionForm] = useState({
    network: 'BNB Smart Chain (56)',
    maxTxUsd: '100',
    dailyLimitUsd: '500',
    depositUsd: '10',
    depositToken: 'BNB' as 'BNB' | 'USDT' | 'USDC',
    allowedTokens: [] as string[],
    allowedProtocols: [] as string[],
    allowedFunctions: 'deposit, withdraw, swap',
    riskLevel: 'LOW',
    expiresAtDays: 30,
  });
  const [bnbUsdPrice, setBnbUsdPrice] = useState<number | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [protocolSnapshot, setProtocolSnapshot] = useState<RegistrySnapshot | null>(null);
  const [protocolSnapshotError, setProtocolSnapshotError] = useState<string | null>(null);
  const [editSessionOpen, setEditSessionOpen] = useState(false);
  const [editSessionTarget, setEditSessionTarget] = useState<Session | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    maxTxUsd: '1',
    dailyLimitUsd: '5',
    allowedTokens: [] as string[],
    allowedProtocols: [] as string[],
    allowedFunctions: '',
    riskLevel: 'LOW',
    expiresAtDays: 30,
  });

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { if (mounted && !loading && !user) router.push('/login'); }, [mounted, user, loading, router]);
  useEffect(() => {
    if (user && params.id) {
      fetchAgent();
      fetchSessions();
      fetchTasks();
      fetchActivity();
      fetchPerformance();
      fetchBalance();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, params.id]);

  useEffect(() => { fetchProtocolSnapshot(); }, []);

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

  const fetchTasks = async () => {
    try {
      const response = await fetch(`/api/agents/${params.id}/tasks`);
      if (response.ok) {
        const data = await response.json();
        setTasks(data.tasks ?? []);
      }
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
    }
  };

  const fetchActivity = async () => {
    try {
      setActivityError(null);
      const response = await fetch(`/api/agents/${params.id}/activity?limit=50`);
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

  const fetchBalance = async (force = false) => {
    if (balanceLoading) return;
    if (!force && balance) return;
    setBalanceLoading(true);
    try {
      const response = await fetch(`/api/agents/${params.id}/balance`);
      if (response.ok) {
        const data = await response.json();
        setBalance(data);
      }
    } catch (error) {
      console.error('Failed to fetch balance:', error);
    } finally {
      setBalanceLoading(false);
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

  const fetchBnbPrice = async (force = false) => {
    if (priceLoading) return;
    if (!force && bnbUsdPrice != null) return;
    setPriceLoading(true);
    try {
      const response = await fetch('/api/prices/bnb');
      if (response.ok) {
        const data = await response.json();
        setBnbUsdPrice(data.usd ?? null);
      }
    } catch (error) {
      console.error('Failed to fetch BNB price:', error);
    } finally {
      setPriceLoading(false);
    }
  };

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

  const handleCreateTask = async () => {
    setTaskError(null);
    if (!bnbUsdPrice) {
      toast.error({ title: 'Price not available', description: 'Unable to convert USD limits to BNB. Try again.' });
      return;
    }
    if (sessionForm.allowedTokens.length === 0 && sessionForm.allowedProtocols.length === 0) {
      setTaskError('Select at least one allowed token or protocol so the agent has bounded authority to act.');
      return;
    }

    const depositUsd = sessionForm.depositUsd;
    const depositToken = sessionForm.depositToken;
    const hasDeposit = depositUsd && Number(depositUsd) > 0 && bnbUsdPrice != null;

    if (hasDeposit) {
      // Get topup instruction first to validate
      const gasBnb = Number(gasUsd) / bnbUsdPrice;
      const totalBnb = depositToken === 'BNB'
        ? ((Number(depositUsd) / bnbUsdPrice) + gasBnb)
        : gasBnb;

      const topupRes = await fetch('/api/developers/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: agent!.id, amountBnb: totalBnb }),
      });
      const topupData = await topupRes.json().catch(() => null);
      if (!(topupRes.ok && topupData?.ok)) {
        setTaskError(topupData?.error || 'Top-up failed');
        return;
      }

      // Show confirmation modal before sending
      setTaskConfirmData({
        walletAddress: topupData.walletAddress,
        amountBnb: totalBnb.toFixed(6),
        depositToken,
        depositUsd,
      });
      setShowTaskConfirm(true);
      return;
    }

    // No deposit — create task directly
    await executeCreateTask();
  };

  /** Execute deposit + create task after user confirms in modal */
  const handleTaskConfirm = async () => {
    if (!taskConfirmData) return;
    setShowTaskConfirm(false);
    setTaskLoading(true);
    try {
      if (taskConfirmData.depositToken === 'BNB') {
        // Send BNB to agent wallet
        let value: bigint;
        try { value = parseEther(taskConfirmData.amountBnb as `${number}`); }
        catch { setTaskError('Invalid BNB amount'); setTaskLoading(false); return; }

        const txResult = await sendTransactionTx({
          to: taskConfirmData.walletAddress as `0x${string}`,
          value,
          chain: wallet.chain,
          client: thirdwebClient,
        });
        const txHash = typeof txResult?.transactionHash === 'string' ? txResult.transactionHash : '';
        if (!txHash) {
          setTaskError('Deposit was not confirmed. Task creation cancelled.');
          setTaskLoading(false);
          return;
        }
      } else {
        // USDT/USDC: send BNB gas first, then send token transfer
        const gasBnb = (Number(gasUsd) / (bnbUsdPrice ?? 600)).toFixed(6);
        if (Number(gasBnb) > 0) {
          let gasValue: bigint;
          try { gasValue = parseEther(gasBnb as `${number}`); }
          catch { setTaskError('Invalid gas amount'); setTaskLoading(false); return; }

          const gasResult = await sendTransactionTx({
            to: taskConfirmData.walletAddress as `0x${string}`,
            value: gasValue,
            chain: wallet.chain,
            client: thirdwebClient,
          });
          const gasHash = typeof gasResult?.transactionHash === 'string' ? gasResult.transactionHash : '';
          if (!gasHash) {
            setTaskError('Gas deposit cancelled.');
            setTaskLoading(false);
            return;
          }
        }

        // Send the token (USDT/USDC) via ERC-20 transfer
        const token = taskConfirmData.depositToken;
        const tokenAddr = token === 'USDT'
          ? '0x55d398326f99059fF775485246999027B3197955'
          : '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';
        const amountWei = parseUnits(taskConfirmData.depositUsd as `${number}`, 18);

        // Encode ERC-20 transfer(to, amount)
        const transferData = encodeFunctionData({
          abi: [{
            name: 'transfer',
            type: 'function',
            inputs: [
              { name: 'to', type: 'address' },
              { name: 'amount', type: 'uint256' },
            ],
            outputs: [{ name: '', type: 'bool' }],
          }],
          functionName: 'transfer',
          args: [taskConfirmData.walletAddress as `0x${string}`, amountWei],
        });

        const tokenResult = await sendTransactionTx({
          to: tokenAddr as `0x${string}`,
          data: transferData,
          value: 0n,
          chain: wallet.chain,
          client: thirdwebClient,
        });
        const tokenHash = typeof tokenResult?.transactionHash === 'string' ? tokenResult.transactionHash : '';
        if (!tokenHash) {
          setTaskError(`${token} transfer was not confirmed. Task creation cancelled.`);
          setTaskLoading(false);
          return;
        }
      }

      toast.success({
        title: 'Agent funded',
        description: `${taskConfirmData.depositUsd} ${taskConfirmData.depositToken} sent. Creating task now...`,
      });

      // Now create the task
      await executeCreateTask();
    } catch (error) {
      console.error('Task deposit error:', error);
      setTaskError(error instanceof Error ? error.message : 'Deposit failed');
      setTaskLoading(false);
    }
  };

  /** Create the task on the server (no deposit) */
  const executeCreateTask = async () => {
    setTaskError(null);
    if (!bnbUsdPrice) return;
    setTaskLoading(true);
    try {
      const maxTxWei = Math.floor((Number(sessionForm.maxTxUsd) / bnbUsdPrice) * 1e18).toString();
      const dailyWei = Math.floor((Number(sessionForm.dailyLimitUsd) / bnbUsdPrice) * 1e18).toString();

      const body = {
        maxTxUsd: sessionForm.maxTxUsd,
        dailyLimitUsd: sessionForm.dailyLimitUsd,
        maxTxWei,
        dailyWei,
        allowedTokens: sessionForm.allowedTokens,
        allowedProtocols: sessionForm.allowedProtocols,
        allowedFunctions: sessionForm.allowedFunctions
          ? sessionForm.allowedFunctions.split(',').map((s) => s.trim()).filter(Boolean)
          : [],
        riskLevel: sessionForm.riskLevel,
        expiresAtMs: Date.now() + sessionForm.expiresAtDays * 24 * 60 * 60 * 1000,
      };

      const response = await fetch(`/api/agents/${params.id}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const code = typeof data?.code === 'string' ? data.code : undefined;
        const message = typeof data?.error === 'string' ? data.error : 'Task creation failed';
        if (code && REGISTRY_ERROR_CODES.has(code)) {
          setTaskError(message);
        } else {
          toast.error({ title: 'Task failed', description: message });
        }
        setTaskLoading(false);
        return;
      }

      const data = await response.json();
      toast.success({
        title: 'Task created',
        description: data.task?.sessionId
          ? `Task ${data.task.taskId.slice(0, 12)} is running with session ${data.task.sessionId.slice(0, 12)}.`
          : `Task ${data.task?.taskId ?? ''} created and is running.`,
      });
      setShowTaskModal(false);
      setTaskConfirmData(null);
      await fetchTasks();
      await fetchSessions();
      await fetchActivity();
      fetchBalance(true);
    } catch (error) {
      console.error('Task creation error:', error);
      toast.error({ title: 'Task failed', description: error instanceof Error ? error.message : 'An unexpected error occurred.' });
    } finally {
      setTaskLoading(false);
    }
  };

  const openEditSession = () => {
    const target = sessions.find((s) => s.status === 'ACTIVE') || sessions[0] || null;
    if (!target) {
      toast.error({ title: 'No session', description: 'Create a task first so there is a session to edit.' });
      setTaskError('Create a task first so there is a session to edit.');
      setShowTaskModal(true);
      return;
    }
    setEditSessionTarget(target);
    const spendBNB = Number(target.spendCap) > 0 ? Number(target.spendCap) / 1e18 : 5;
    const perTxBNB = Number(target.perTransactionCap) > 0 ? Number(target.perTransactionCap) / 1e18 : 1;
    const days = Math.max(1, Math.ceil((new Date(target.expiresAt).getTime() - Date.now()) / 86400000));
    setEditForm({
      dailyLimitUsd: String(spendBNB),
      maxTxUsd: String(perTxBNB),
      allowedTokens: Array.isArray(target.allowedTokens) ? target.allowedTokens : [],
      allowedProtocols: [],
      allowedFunctions: (target.allowedFunctions ?? []).join(', '),
      riskLevel: 'LOW',
      expiresAtDays: days,
    });
    setEditError(null);
    setEditSessionOpen(true);
  };

  const handleEditSession = async () => {
    if (!editSessionTarget) return;
    setEditError(null);
    const perTxBNB = Number(editForm.maxTxUsd);
    const dailyBNB = Number(editForm.dailyLimitUsd);
    if (!Number.isFinite(perTxBNB) || perTxBNB <= 0 || !Number.isFinite(dailyBNB) || dailyBNB <= 0 || perTxBNB > dailyBNB) {
      setEditError('Max per transaction must be > 0 and not exceed the daily spend cap.');
      return;
    }
    const perTransactionCap = Math.floor(perTxBNB * 1e18).toString();
    const spendCap = Math.floor(dailyBNB * 1e18).toString();
    const allowedFunctions = editForm.allowedFunctions
      ? editForm.allowedFunctions.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    setEditSaving(true);
    try {
      const res = await fetch(`/api/agents/${params.id}/sessions/${editSessionTarget.sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spendCap,
          perTransactionCap,
          allowedTokens: editForm.allowedTokens,
          allowedProtocols: editForm.allowedProtocols,
          // Preserve existing canonical contracts unless the user changed protocols.
          allowedContracts: editSessionTarget.allowedContracts ?? [],
          allowedFunctions,
          riskLevel: editForm.riskLevel,
          expiresAtMs: Date.now() + editForm.expiresAtDays * 24 * 60 * 60 * 1000,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setEditError(data?.error || 'Failed to update session.');
        return;
      }
      toast.success({
        title: 'Session updated',
        description: data.reRegistered ? 'Session limits and authority re-registered live.' : 'Session configuration saved.',
      });
      setEditSessionOpen(false);
      await fetchSessions();
      await fetchTasks();
    } catch (err) {
      console.error('Edit session error:', err);
      setEditError('An unexpected error occurred.');
    } finally {
      setEditSaving(false);
    }
  };

  const handleTopupConfirm = async () => {
    if (!agent || !topupAmount) return;
    setTopupLoading(true);
    try {
      const amount = Number(topupAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        toast.error({ title: 'Invalid amount', description: 'Enter a positive BNB amount.' });
        setTopupLoading(false);
        return;
      }
      if (amount > 1000) {
        toast.error({ title: 'Invalid amount', description: 'Amount exceeds the 1000 BNB sanity limit.' });
        setTopupLoading(false);
        return;
      }
      // 1) Server-side validation + honest deposit instruction (intent record).
      const response = await fetch('/api/developers/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: agent.id, amountBnb: amount }),
      });
      const data = await response.json().catch(() => null);
      if (!(response.ok && data?.ok)) {
        const message = data?.error || 'Unable to create top-up instruction.';
        toast.error({ title: 'Top-up failed', description: message });
        setTopupLoading(false);
        return;
      }

      // 2) One-click send from the CONNECTED wallet (popup -> sign -> broadcast -> wait for hash).
      let value: bigint;
      try {
        value = parseEther(topupAmount);
      } catch {
        toast.error({ title: 'Invalid amount', description: 'Enter a valid BNB amount.' });
        setTopupLoading(false);
        return;
      }
      const txResult = await sendTransactionTx({
        to: data.walletAddress,
        value,
        chain: wallet.chain,
        client: thirdwebClient,
      });
      const txHash = typeof txResult?.transactionHash === 'string' ? txResult.transactionHash : '';

      setTopupResult({
        ...data,
        status: txHash ? 'SENT' : data.status,
        txHash: txHash || null,
      });
      toast.success({
        title: txHash ? 'Transaction sent' : 'Deposit instruction ready',
        description: txHash
          ? 'Sent ' + amount + ' BNB to the agent wallet. It counts once confirmed on-chain.'
          : 'Send the BNB to the agent wallet shown. BAN counts it once confirmed on-chain.',
      });
      setTopupOpen(false);
      fetchBalance(true);
    } catch (error) {
      console.error('Topup error:', error);
      toast.error({ title: 'Top-up failed', description: 'Transaction was cancelled or failed in your wallet.' });
    } finally {
      setTopupLoading(false);
    }
  };

  const toggleToken = (sym: string) => {
    setSessionForm((f) => ({
      ...f,
      allowedTokens: f.allowedTokens.includes(sym)
        ? f.allowedTokens.filter((t) => t !== sym)
        : [...f.allowedTokens, sym],
    }));
  };

  // Protocol options derived from the REAL registry snapshot (fallback = enabled,
  // server remains the fail-closed gate). verified === integrationStatus is not
  // DISCOVERY_ONLY: PancakeSwap/Venus resolve to EXECUTION_ENABLED in the registry.
  const protocolOptions = useMemo(() => {
    const snap = protocolSnapshot?.protocols ?? [];
    if (snap.length === 0) return FALLBACK_PROTOCOL_OPTIONS;
    return snap.map((p) => ({
      id: p.id,
      label: p.name || p.id,
      verified: p.integrationStatus !== 'DISCOVERY_ONLY',
      integrationStatus: p.integrationStatus,
    }));
  }, [protocolSnapshot]);

  const toggleProtocol = (id: string) => {
    const option = protocolOptions.find((p) => p.id === id);
    if (option && !option.verified) {
      setTaskError(
        `${option.label} is recognized but not yet verified for autonomous execution (verified â‰  enabled). Remove it or try again later.`
      );
      return;
    }
    setSessionForm((f) => ({
      ...f,
      allowedProtocols: f.allowedProtocols.includes(id)
        ? f.allowedProtocols.filter((p) => p !== id)
        : [...f.allowedProtocols, id],
    }));
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
          <p className="text-xs text-[#F0B90B] font-mono tracking-widest uppercase">Loading Agent Details...</p>
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="min-h-screen bg-background text-foreground p-6 flex flex-col items-center justify-center">
        <p className="text-muted-foreground mb-4">Agent not found</p>
        <button onClick={() => router.push('/my-agents')} className="bg-[#F0B90B] text-black text-xs font-black px-4 py-2 uppercase tracking-wider">Return to My Agents</button>
      </div>
    );
  }

  const primaryProtocol = agent.protocols[0] || null;

  // Agent's declared protocols matched against the live registry snapshot by id
  // OR display name (case-insensitive) so verified protocols never render greyed.
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
  const primaryProtocolLabel =
    primaryProtocol
      ? snapshotProtocols.find((p) => matchesProtocol(p, primaryProtocol))?.name ?? primaryProtocol
      : null;
  const integrationColor = (status: string) => {
    switch (status) {
      case 'EXECUTION_ENABLED': return 'text-green-400 border-green-500/40 bg-green-500/10';
      case 'SIMULATION': return 'text-[#F0B90B] border-[#F0B90B]/40 bg-[#F0B90B]/10';
      case 'READ_ONLY': return 'text-blue-400 border-blue-500/40 bg-blue-500/10';
      default: return 'text-muted-foreground border-gray-600 bg-gray-800/40';
    }
  };

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

  const failedEvents = events.filter((e) => e.eventType === 'TRANSACTION_FAILED' || e.eventType === 'ACTION_DENIED').length;

  const latestTick = events.find((e) => e.eventType === 'AGENT_TICK') ?? null;
  const tickStage =
    latestTick && typeof (latestTick.payload.cycleResult as Record<string, unknown> | undefined)?.stage === 'string'
      ? String((latestTick.payload.cycleResult as Record<string, unknown>).stage)
      : null;
  const tickStageLabel =
    tickStage === 'confirmed' ? 'Confirmed on-chain'
      : tickStage === 'awaited' ? 'Awaiting execution'
        : tickStage === 'decided' ? 'Agent passed'
          : tickStage ? 'Observed' : null;

  const balanceBnb = balance && balance.balanceBnb != null ? Number(balance.balanceBnb) : null;

  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased pb-28">
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur px-5 py-4 flex items-center justify-between border-b border-[#1A1A1A]">
        <button onClick={() => router.push('/my-agents')} className="text-foreground hover:text-[#F0B90B] transition" aria-label="Back">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="text-sm font-black tracking-[0.2em] uppercase text-foreground">AGENT DETAILS</h1>
        <button onClick={() => setActiveViewTab(activeViewTab === 'overview' ? 'analytics' : 'overview')} className="text-[10px] font-black text-[#F0B90B] border border-border px-2.5 py-1.5 bg-card">
          {activeViewTab === 'overview' ? 'ANALYTICS' : 'OVERVIEW'}
        </button>
      </header>

      <div className="px-5 pt-4 space-y-4">
        {/* Hero card (same as before) */}
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
                {primaryProtocol && <span className="text-xs text-muted-foreground">On {primaryProtocolLabel}</span>}
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
              <p className="text-base font-black text-foreground">{confirmedCount > 0 ? confirmedCount : 'None yet'}</p>
            </div>
            <div>
              <p className="text-[9px] font-black text-muted-foreground uppercase tracking-wider mb-1">CAPITAL MANAGED</p>
              <p className="text-base font-black text-foreground">{tvlDisplay ?? '—'}</p>
            </div>
            <div>
              <p className="text-[9px] font-black text-muted-foreground uppercase tracking-wider mb-1">SUCCESS RATE</p>
              <p className={successRateText ? 'text-base font-black text-emerald-400' : 'text-base font-black text-muted-foreground'}>{successRateText ?? '—'}</p>
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

        {/* WALLET + TOP UP (with transaction confirmation gate) */}
        <div className="bg-card rounded-xl p-5 border border-border space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black text-foreground tracking-widest uppercase">AGENT WALLET</span>
            <span className="text-[9px] font-mono text-muted-foreground">BNB 56</span>
          </div>

          {agent.walletAddress ? (
            <>
              <div>
                <p className="text-[9px] font-black text-muted-foreground uppercase tracking-wider mb-1">Address</p>
                <p className="text-xs font-mono text-[#F0B90B] break-all">{agent.walletAddress}</p>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Balance</span>
                <span className="text-lg font-black text-foreground font-mono">
                  {balanceLoading && balance == null ? (
                    <span className="inline-block animate-spin h-4 w-4 border-2 border-[#F0B90B] border-t-transparent rounded-full" />
                  ) : balanceBnb != null ? (
                    `${renderUsdc(balanceBnb!, 6)} BNB`
                  ) : (
                    '—'
                  )}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => { setTopupAmount('0.01'); setTopupResult(null); setTopupOpen(true); }}
                  className="w-full bg-[#F0B90B] text-black font-black text-xs py-3.5 tracking-[0.15em] uppercase hover:bg-yellow-400 transition"
                >
                  TOP UP
                </button>
                <button
                  type="button"
                  onClick={() => { setWithdrawAmount(''); setWithdrawResult(null); setWithdrawError(null); setWithdrawOpen(true); }}
                  disabled={!balanceBnb || balanceBnb <= 0}
                  className="w-full bg-[#1A1A1A] border border-border text-gray-300 font-black text-xs py-3.5 tracking-[0.15em] uppercase hover:border-red-500/50 transition disabled:opacity-40"
                >
                  WITHDRAW
                </button>
                <button
                  type="button"
                  onClick={() => fetchBalance(true)}
                  disabled={balanceLoading}
                  className="w-full col-span-2 bg-[#1A1A1A] border border-border text-gray-300 font-black text-xs py-3.5 tracking-[0.15em] uppercase hover:border-[#F0B90B]/50 transition disabled:opacity-60"
                >
                  REFRESH
                </button>
              </div>

              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Minimum <strong className="text-foreground">$0.50 BNB reserve</strong> kept for gas. {balanceBnb != null && bnbUsdPrice != null
                  ? `Available: ${Math.max(0, balanceBnb - (0.5 / bnbUsdPrice)).toFixed(6)} BNB (${((balanceBnb - (0.5 / bnbUsdPrice)) * (bnbUsdPrice ?? 0)).toFixed(2)} USD)`
                  : ''} Top up BNB here so it can pay gas and execute within its session limits.
              </p>
            </>
          ) : (
            <div className="py-2 space-y-3">
              <p className="text-sm font-black text-muted-foreground">No wallet provisioned</p>
              <p className="text-xs text-muted-foreground">
                This agent does not have a dedicated BNB wallet yet. Create a task or contact support to provision it before topping up.
              </p>
            </div>
          )}
        </div>

        {/* SCHEDULER HEARTBEAT */}
        <div className="bg-card rounded-xl p-5 border border-border">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-black text-foreground tracking-widest uppercase">Scheduler Heartbeat</span>
            <span className="flex items-center gap-1.5 text-[10px] font-mono text-[#F0B90B]">~2m</span>
          </div>
          {latestTick ? (
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#F0B90B] animate-pulse" />
                <span className="text-foreground font-black">{tickStageLabel ?? 'Cycle recorded'}</span>
              </div>
              <span className="text-muted-foreground font-mono">{timeAgo(latestTick.createdAt)} · {(latestTick.payload.cycleResult as Record<string, unknown> | undefined)?.stage ? 'loop active' : 'heartbeat'}</span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No scheduled ticks yet. Create a task — Inngest runs the closed loop every ~2 minutes via <span className="font-mono text-muted-foreground">/api/inngest</span> (no GitHub Actions).
            </p>
          )}
        </div>

        {/* TASKS — user-visible unit of work */}
        <div className="bg-card rounded-xl p-5 border border-border space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black text-foreground tracking-widest uppercase">TASKS</span>
            <button
              type="button"
              onClick={() => { setShowTaskModal(true); setTaskError(null); fetchBnbPrice(); }}
              className="bg-[#F0B90B] text-black text-[10px] font-black px-3 py-2 uppercase tracking-wider hover:bg-yellow-400 transition"
            >
              CREATE TASK
            </button>
          </div>

          {tasks.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              No tasks yet. Create a task to configure the agent&apos;s bounded authority and start the loop (observe →’ policy →’ execute).
            </p>
          ) : (
            <div className="space-y-3">
              {tasks.slice(0, 5).map((task) => (
                <div key={task.taskId} className="dark:bg-background/40 bg-white/60 rounded-lg p-3.5 border dark:border-border border-gray-200 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs font-black text-[#F0B90B] font-mono">{task.taskId.slice(0, 14)}</span>
                    <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded border ${task.status === 'COMPLETED' ? 'text-green-400 border-green-500/40 bg-green-500/10' : task.status === 'FAILED' ? 'text-red-400 border-red-500/40 bg-red-500/10' : 'text-[#F0B90B] border-[#F0B90B]/40 bg-[#F0B90B]/10'}`}>
                      {task.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[10px] font-mono text-muted-foreground">
                    <span className="bg-background/40 border border-border px-1.5 py-0.5">${task.config.maxTxUsd} max tx</span>
                    <span className="bg-background/40 border border-border px-1.5 py-0.5">${task.config.dailyLimitUsd}/day</span>
                    <span className="bg-background/40 border border-border px-1.5 py-0.5">{task.config.riskLevel}</span>
                    {task.config.allowedTokens.length > 0 && (
                      <span className="bg-background/40 border border-border px-1.5 py-0.5">{task.config.allowedTokens.join(', ')}</span>
                    )}
                    {task.config.allowedProtocols.length > 0 && (
                      <span className="bg-background/40 border border-border px-1.5 py-0.5">{task.config.allowedProtocols.join(', ')}</span>
                    )}
                  </div>
                  {task.lastRun && (
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span className="font-mono">
                        {task.lastRun.result?.ok === true || (task.lastRun.result && 'stage' in task.lastRun.result)
                          ? `Last run: ${String(task.lastRun.result.stage ?? 'ok')}`
                          : task.lastRun.result?.ok === false
                            ? `Last run failed: ${String(task.lastRun.result.reason ?? '')}`
                            : 'Last run recorded'}
                      </span>
                      <span>{timeAgo(task.lastRun.at)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* PERMISSIONS & LIMITS (session view) */}
        <div className="bg-card rounded-xl p-5 border border-border space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black text-foreground tracking-widest uppercase">PERMISSIONS & LIMITS</span>
            <button type="button" onClick={openEditSession} className="bg-[#1A1A1A] text-[10px] text-gray-300 font-black px-2.5 py-1 border border-border hover:text-foreground">
              EDIT SESSION
            </button>
          </div>

          {activeSession ? (
            <>
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-muted-foreground">Spend Cap</span>
                  <span className="text-foreground font-black font-mono">
                    {spendLimitMax != null ? `${renderUsdc(spendLimitMax)} BNB` : '—'}
                  </span>
                </div>
                <div className="h-1.5 bg-[#222] rounded-full overflow-hidden" />
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Max Tx / Session</span>
                <span className="text-foreground font-black font-mono">
                  {perTxCap != null ? `${renderUsdc(perTxCap)} BNB` : '—'}
                </span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block mb-1">Session</span>
                <span className="text-foreground font-black font-mono">{activeSession.sessionId.slice(0, 10)}...</span>
                <span className="text-xs text-muted-foreground ml-2">({activeSession.status})</span>
              </div>
              {activeSession.allowedFunctions && activeSession.allowedFunctions.length > 0 && (
                <div>
                  <span className="text-xs text-muted-foreground block mb-1.5">Allowed Functions</span>
                  <div className="flex flex-wrap gap-1.5">
                    {activeSession.allowedFunctions.map((fn) => (
                      <span key={fn} className="text-[10px] font-black text-[#F0B90B] bg-[#1A1A1A] border border-border px-2 py-0.5">{fn}</span>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="pt-2 pb-1">
              <p className="text-sm font-black text-muted-foreground mb-1">No active session</p>
              <p className="text-xs text-muted-foreground">Create a task to set spend caps and allowed functions (a scoped session is created for you).</p>
            </div>
          )}

          {failedEvents > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Failed / denied events</span>
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
              <button type="button" disabled className="w-full bg-[#1A1A1A] border border-border text-muted-foreground font-black text-xs py-3.5 tracking-[0.15em] uppercase cursor-not-allowed">
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
            {agent.status !== 'REVOKED' && (
              <button type="button" onClick={() => setRevokeOpen(true)} disabled={actionLoading === 'revoke'} className="w-full bg-[#1A1A1A] border border-border text-red-400 font-black text-xs py-3.5 tracking-[0.15em] uppercase hover:border-red-500/50 transition disabled:opacity-60">
                {actionLoading === 'revoke' ? 'REVOKING...' : 'REVOKE ACCESS'}
              </button>
            )}
          </div>
        </div>

        {/* EDIT SESSION MODAL */}
        {editSessionOpen && editSessionTarget && (
          <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-background/70 backdrop-blur-sm p-0 sm:p-4">
            <div className="w-full max-w-lg bg-card border border-border rounded-2xl p-5 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <span className="text-[10px] font-black text-foreground tracking-widest uppercase">EDIT SESSION</span>
                <button type="button" onClick={() => setEditSessionOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1.5">Max per transaction (BNB)</label>
                  <input type="number" min="0" step="any" value={editForm.maxTxUsd} onChange={(e) => setEditForm((f) => ({ ...f, maxTxUsd: e.target.value }))} className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:border-[#F0B90B]" />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1.5">Daily spend cap (BNB)</label>
                  <input type="number" min="0" step="any" value={editForm.dailyLimitUsd} onChange={(e) => setEditForm((f) => ({ ...f, dailyLimitUsd: e.target.value }))} className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:border-[#F0B90B]" />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1.5">Allowed tokens</label>
                  <div className="flex flex-wrap gap-2">
                    {TOKEN_OPTIONS.map((t) => (
                      <button key={t.symbol} type="button" onClick={() => setEditForm((f) => ({ ...f, allowedTokens: f.allowedTokens.includes(t.symbol) ? f.allowedTokens.filter((x) => x !== t.symbol) : [...f.allowedTokens, t.symbol] }))} className={`px-2.5 py-1 text-[10px] font-black rounded border ${editForm.allowedTokens.includes(t.symbol) ? 'bg-[#F0B90B] text-black border-[#F0B90B]' : 'bg-[#1A1A1A] text-muted-foreground border-border'}`}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1.5">Allowed protocols</label>
                  <div className="flex flex-wrap gap-2">
                    {protocolOptions.map((p) => (
                      <button key={p.id} type="button" onClick={() => setEditForm((f) => ({ ...f, allowedProtocols: f.allowedProtocols.includes(p.id) ? f.allowedProtocols.filter((x) => x !== p.id) : [...f.allowedProtocols, p.id] }))} className={`px-2.5 py-1 text-[10px] font-black rounded border ${editForm.allowedProtocols.includes(p.id) ? 'bg-[#F0B90B] text-black border-[#F0B90B]' : p.verified ? 'bg-[#1A1A1A] text-muted-foreground border-border' : 'bg-[#1A1A1A] text-gray-600 border-border line-through'}`}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1.5">Existing canonical contracts are preserved unless you change protocols here.</p>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1.5">Allowed functions (comma separated)</label>
                  <input type="text" value={editForm.allowedFunctions} onChange={(e) => setEditForm((f) => ({ ...f, allowedFunctions: e.target.value }))} placeholder="deposit, withdraw, swap" className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:border-[#F0B90B]" />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1.5">Expires in (days)</label>
                  <input type="number" min="1" value={editForm.expiresAtDays} onChange={(e) => setEditForm((f) => ({ ...f, expiresAtDays: Number(e.target.value) }))} className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:border-[#F0B90B]" />
                </div>
                {editError && <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">{editError}</div>}
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => setEditSessionOpen(false)} className="flex-1 bg-[#1A1A1A] border border-border text-gray-300 font-black text-xs py-3 uppercase tracking-wider">CANCEL</button>
                  <button type="button" onClick={handleEditSession} disabled={editSaving} className="flex-1 bg-[#F0B90B] text-black font-black text-xs py-3 uppercase tracking-wider disabled:opacity-60">
                    {editSaving ? 'SAVING...' : 'SAVE CHANGES'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* EIP-7702 PERMISSIONS (USER FUNDS) — one-time bounded authorization records */}
        <div className="bg-card rounded-xl p-5 border border-border">
          <PermissionCards agentId={agent.id} />
        </div>

        {/* LIVE ACTIVITY */}
        <div className="bg-card rounded-xl p-5 border border-border">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-black text-foreground tracking-widest uppercase">LIVE ACTIVITY</span>
            <button type="button" onClick={() => setActiveViewTab('analytics')} className="text-[10px] font-black text-[#F0B90B] tracking-wider uppercase flex items-center gap-1">
              VIEW ALL ANALYTICS
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F0B90B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7" /><path d="M7 7h10v10" /></svg>
            </button>
          </div>

          <div className="space-y-4">
            {events.length === 0 ? (
              activityError ? (
                <div className="bg-card border border-border rounded-lg p-3.5 space-y-2">
                  <p className="text-xs font-black text-[#F0B90B] uppercase tracking-wider">Activity restricted</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{activityError}</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    This agent&apos;s live activity is only visible to the account that owns it.
                    If you hired it, sign in with that account to see the audit trail.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground py-2">No activity events recorded yet.</p>
              )
            ) : (
              events.slice(0, 6).map((ev) => (
                <div key={ev.id} className="flex items-start gap-3 text-xs">
                  <div className="w-7 h-7 rounded-full bg-[#1A1A1A] border border-border flex items-center justify-center text-[#F0B90B] shrink-0">
                    {getTimelineIcon(ev.eventType)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline mb-0.5">
                      <p className="font-black text-gray-200">{getTimelineTitle(ev.eventType)}</p>
                      <span className="text-[10px] font-mono text-muted-foreground">{formatEventTimestamp(ev.createdAt)}</span>
                    </div>
                    <p className="text-muted-foreground text-[11px] truncate">{getTimelineSubtitle(ev.eventType, ev.payload)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

                {/* REVIEW TERMINAL (overview) — live loop stream */}
        <div className="bg-card rounded-xl p-5 border border-border">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-black text-foreground tracking-widest uppercase">REVIEW TERMINAL</span>
            <span className="text-[10px] font-mono text-[#F0B90B] animate-pulse">â— LIVE</span>
          </div>
          <LiveRuntimeTerminal agentId={agent.id} initialEvents={events} />
        </div>

        {/* PERFORMANCE */}

        <div className="bg-card rounded-xl p-5 border border-border">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-black text-foreground tracking-widest uppercase">PERFORMANCE</span>
          </div>

          <div className="mb-2">
            <p className="text-[9px] text-muted-foreground font-black uppercase tracking-wider">REALIZED P&L</p>
            <p className={realizedPnlUsd != null ? `text-2xl font-black ${realizedPnlUsd >= 0 ? 'text-green-400' : 'text-red-400'}` : 'text-2xl font-black text-muted-foreground'}>
              {realizedPnlUsd != null ? `$${renderUsdc(realizedPnlUsd)}` : 'Not available'}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              {realizedPnlUsd != null
                ? 'Derived from signed on-chain position records.'
                : 'P&L appears once BAN records a closed on-chain position for this agent.'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-4 pt-3 border-t border-border">
            <div>
              <p className="text-[9px] font-black text-muted-foreground uppercase tracking-wider mb-1">Confirmed</p>
              <p className="text-sm font-black text-foreground">{performance?.confirmedCount ?? 0}</p>
            </div>
            <div>
              <p className="text-[9px] font-black text-muted-foreground uppercase tracking-wider mb-1">Failed</p>
              <p className="text-sm font-black text-red-400">{performance?.failedCount ?? 0}</p>
            </div>
            <div>
              <p className="text-[9px] font-black text-muted-foreground uppercase tracking-wider mb-1">Gas (BNB)</p>
              <p className="text-sm font-black text-foreground font-mono">{performance && Number(performance.totalFeesWei) > 0 ? (Number(performance.totalFeesWei) / 1e18).toFixed(6) : '—'}</p>
            </div>
            <div>
              <p className="text-[9px] font-black text-muted-foreground uppercase tracking-wider mb-1">Last executed</p>
              <p className="text-sm font-black text-foreground">{timeAgo(lastExecutedAt)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ANALYTICS VIEW — full-screen panel with performance + full activity */}
      {activeViewTab === 'analytics' && (
        <div className="fixed inset-0 z-[70] bg-background overflow-y-auto pb-28">
          <div className="sticky top-0 bg-background/95 backdrop-blur px-5 py-4 flex items-center justify-between border-b border-[#1A1A1A]">
            <button onClick={() => setActiveViewTab('overview')} className="text-foreground hover:text-[#F0B90B] transition" aria-label="Back">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <h1 className="text-sm font-black tracking-[0.2em] uppercase text-foreground">ANALYTICS</h1>
            <button onClick={() => setActiveViewTab('overview')} className="text-[10px] font-black text-[#F0B90B] border border-border px-2.5 py-1.5 bg-card">BACK</button>
          </div>
          <div className="px-5 pt-4 space-y-4">
                        {/* Review terminal — live closed-loop stream (real events only) */}
            <div className="bg-card rounded-xl p-5 border border-border">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-black text-foreground tracking-widest uppercase">REVIEW TERMINAL</span>
                <span className="text-[10px] font-mono text-[#F0B90B] animate-pulse">â— LIVE</span>
              </div>
              <LiveRuntimeTerminal agentId={agent.id} initialEvents={events} />
            </div>

            {/* Performance summary */}

            <div className="bg-card rounded-xl p-5 border border-border space-y-3">
              <span className="text-[10px] font-black text-foreground tracking-widest uppercase">PERFORMANCE SUMMARY</span>
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-[9px] font-black text-muted-foreground uppercase tracking-wider mb-1">Confirmed</p><p className="text-sm font-black text-foreground">{performance?.confirmedCount ?? 0}</p></div>
                <div><p className="text-[9px] font-black text-muted-foreground uppercase tracking-wider mb-1">Failed</p><p className="text-sm font-black text-red-400">{performance?.failedCount ?? 0}</p></div>
                <div><p className="text-[9px] font-black text-muted-foreground uppercase tracking-wider mb-1">Total trades</p><p className="text-sm font-black text-foreground">{performance?.totalTrades ?? 0}</p></div>
                <div><p className="text-[9px] font-black text-muted-foreground uppercase tracking-wider mb-1">Success rate</p><p className="text-sm font-black text-emerald-400">{successRateText ?? '—'}</p></div>
              </div>
              {realizedPnlUsd != null && (
                <div className="pt-3 border-t border-border">
                  <p className="text-[9px] font-black text-muted-foreground uppercase tracking-wider mb-1">REALIZED P&L</p>
                  <p className={realizedPnlUsd != null ? `text-xl font-black ${realizedPnlUsd >= 0 ? 'text-green-400' : 'text-red-400'}` : 'text-xl font-black text-muted-foreground'}>
                    {realizedPnlUsd != null ? `$${renderUsdc(realizedPnlUsd)}` : 'Not available'}
                  </p>
                </div>
              )}
            </div>

            {/* Full activity */}
            <div className="bg-card rounded-xl p-5 border border-border">
              <span className="text-[10px] font-black text-foreground tracking-widest uppercase mb-4 block">FULL ACTIVITY</span>
              {events.length === 0 ? (
                activityError ? (
                <div className="bg-card border border-border rounded-lg p-3.5 space-y-2">
                  <p className="text-xs font-black text-[#F0B90B] uppercase tracking-wider">Activity restricted</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{activityError}</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    This agent&apos;s live activity is only visible to the account that owns it.
                    If you hired it, sign in with that account to see the audit trail.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground py-2">No activity events recorded yet.</p>
              )
              ) : (
                <div className="space-y-4">
                  {events.map((ev) => (
                    <div key={ev.id} className="flex items-start gap-3 text-xs">
                      <div className="w-7 h-7 rounded-full bg-[#1A1A1A] border border-border flex items-center justify-center text-[#F0B90B] shrink-0">{getTimelineIcon(ev.eventType)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-baseline mb-0.5">
                          <p className="font-black text-gray-200">{getTimelineTitle(ev.eventType)}</p>
                          <span className="text-[10px] font-mono text-muted-foreground">{formatEventTimestamp(ev.createdAt)}</span>
                        </div>
                        <p className="text-muted-foreground text-[11px]">{getTimelineSubtitle(ev.eventType, ev.payload)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}


      {/* TASK CONFIG MODAL — captures every config the backend consumes */}
      {showTaskModal && (
        <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-lg space-y-5 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-black text-[#F0B90B] uppercase">Create Task</h3>
            <p className="text-xs text-muted-foreground -mt-2">
              Configure the agent&apos;s bounded authority. A scoped session is created with these exact limits, the agent is activated, and the closed loop runs immediately.
            </p>

            {/* Network */}
            <div>
              <label className="block text-xs font-black text-muted-foreground mb-1">Network</label>
              <div className="w-full bg-background border border-border px-3 py-2 text-xs font-mono text-gray-200 rounded">
                BNB Smart Chain (56) <span className="text-[10px] text-muted-foreground">— BAN execution chain</span>
              </div>
            </div>

            {/* USD limits */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-black text-muted-foreground mb-1.5">Max transaction (USD)</label>
                <input
                  type="number"
                  min="1"
                  value={sessionForm.maxTxUsd}
                  onChange={(e) => setSessionForm({ ...sessionForm, maxTxUsd: e.target.value })}
                  className="w-full bg-background border border-border px-3 py-3 text-sm font-mono text-foreground rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-muted-foreground mb-1.5">Daily limit (USD)</label>
                <input
                  type="number"
                  min="1"
                  value={sessionForm.dailyLimitUsd}
                  onChange={(e) => setSessionForm({ ...sessionForm, dailyLimitUsd: e.target.value })}
                  className="w-full bg-background border border-border px-3 py-3 text-sm font-mono text-foreground rounded-lg"
                />
              </div>
            </div>

            {/* Initial deposit — USD input, converts to token */}
            <div>
              <label className="block text-xs font-black text-muted-foreground mb-1.5">Initial deposit</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={sessionForm.depositUsd}
                    onChange={(e) => setSessionForm({ ...sessionForm, depositUsd: e.target.value })}
                    placeholder="10.00"
                    className="w-full bg-background border border-border px-3 py-3 text-sm font-mono text-foreground rounded-lg"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-black">$ USD</span>
                </div>
                <select
                  value={sessionForm.depositToken}
                  onChange={(e) => setSessionForm({ ...sessionForm, depositToken: e.target.value as 'BNB' | 'USDT' | 'USDC' })}
                  className="bg-background border border-border rounded-lg px-3 py-3 text-sm font-black text-foreground font-mono"
                >
                  <option value="BNB">BNB</option>
                  <option value="USDT">USDT</option>
                  <option value="USDC">USDC</option>
                </select>
              </div>

              {/* Gas funding — auto-added when depositing non-BNB tokens */}
              {sessionForm.depositToken !== 'BNB' && (
                <div className="mt-2 flex items-center gap-2 bg-background/40 border border-border rounded-lg px-3 py-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F0B90B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                  </svg>
                  <span className="text-[10px] text-muted-foreground flex-1">Gas funding (BNB)</span>
                  {showGasEdit ? (
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-muted-foreground">$</span>
                      <input
                        type="number"
                        min="0.50"
                        step="0.10"
                        value={gasUsd}
                        onChange={(e) => setGasUsd(e.target.value)}
                        onBlur={() => { if (Number(gasUsd) < 0.50) setGasUsd('0.50'); setShowGasEdit(false); }}
                        className="w-16 bg-background border border-border rounded px-1.5 py-0.5 text-[10px] font-mono text-foreground text-right"
                        autoFocus
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowGasEdit(true)}
                      className="flex items-center gap-1 text-[10px] font-mono text-foreground font-black hover:text-[#F0B90B] transition"
                    >
                      ${Number(gasUsd).toFixed(2)}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                      </svg>
                    </button>
                  )}
                </div>
              )}

              <p className="text-[10px] text-muted-foreground mt-1">
                {bnbUsdPrice != null ? (
                  sessionForm.depositToken === 'BNB'
                    ? `~$${Number(sessionForm.depositUsd).toFixed(2)} USD → ${(Number(sessionForm.depositUsd) / bnbUsdPrice).toFixed(4)} BNB`
                    : `~$${Number(sessionForm.depositUsd).toFixed(2)} ${sessionForm.depositToken} + $${Number(gasUsd).toFixed(2)} BNB gas = ~${(Number(sessionForm.depositUsd) + Number(gasUsd)).toFixed(2)} USD total`
                ) : 'Enter USD amount — BNB price needed for conversion'}
                . Confirm in your wallet after creating the task.
              </p>
            </div>

            {/* Live USD → BNB rate */}
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>USD → BNB conversion</span>
              <span className="font-mono text-gray-300">
                {bnbUsdPrice != null ? `1 BNB = $${bnbUsdPrice.toFixed(2)}` : 'Price unavailable'}
              </span>
              {bnbUsdPrice == null && (
                <button
                  type="button"
                  onClick={() => fetchBnbPrice(true)}
                  disabled={priceLoading}
                  className="text-[#F0B90B] font-black uppercase text-[10px] disabled:opacity-60"
                >
                  {priceLoading ? 'Loading...' : 'Retry'}
                </button>
              )}
            </div>

            {/* Allowed tokens */}
            <div>
              <label className="block text-xs font-black text-muted-foreground mb-1.5">Allowed tokens</label>
              <div className="flex flex-wrap gap-1.5">
                {TOKEN_OPTIONS.map((t) => {
                  const active = sessionForm.allowedTokens.includes(t.symbol);
                  return (
                    <button
                      key={t.symbol}
                      type="button"
                      onClick={() => toggleToken(t.symbol)}
                      className={`text-xs font-black px-3 py-1.5 border transition ${active ? 'bg-[#F0B90B] text-black border-[#F0B90B]' : 'bg-[#1A1A1A] text-gray-300 border-border hover:border-[#F0B90B]/50'}`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">Resolved server-side against the BAN token registry (fail-closed).</p>
            </div>

            {/* Allowed protocols */}
            <div>
              <label className="block text-xs font-black text-muted-foreground mb-1.5">Allowed protocols</label>
              <div className="flex flex-wrap gap-1.5">
                {protocolOptions.map((p) => {
                  const active = sessionForm.allowedProtocols.includes(p.id);
                  const disabled = !p.verified;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => toggleProtocol(p.id)}
                      title={disabled ? `${p.label} is recognized but not yet verified for autonomous execution (verified â‰  enabled).` : undefined}
                      className={`text-[10px] font-black px-2.5 py-1 border transition ${active ? 'bg-[#F0B90B] text-black border-[#F0B90B]' : disabled ? 'bg-card text-gray-600 border-border cursor-not-allowed opacity-60' : 'bg-[#1A1A1A] text-gray-300 border-border hover:border-[#F0B90B]/50'}`}
                    >
                      {p.label}
                      {disabled && <span className="ml-1 text-[9px] normal-case">(verifying"¦)</span>}
                      {!disabled && <span className="ml-1 text-[9px] normal-case text-green-400">(Verified)</span>}
                    </button>
                  );
                })}
              </div>
              {protocolSnapshotError && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Registry snapshot unavailable — showing last-known verified state; the server still validates fail-closed before any session is created.
                </p>
              )}
              {!protocolOptions.some((p) => p.verified) && !protocolSnapshotError && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Protocols are recognized but not yet verified for autonomous execution (verified â‰  enabled). You can create the task with tokens only; protocol selection unlocks once the on-chain verification pipeline confirms their deployments.
                </p>
              )}
              <p className="text-[10px] text-muted-foreground mt-1">Resolved server-side against the BAN deployment registry (fail-closed).</p>
            </div>

            {/* Allowed functions */}
            <div>
              <label className="block text-xs font-black text-muted-foreground mb-1.5">Allowed functions</label>
              <input
                type="text"
                value={sessionForm.allowedFunctions}
                onChange={(e) => setSessionForm({ ...sessionForm, allowedFunctions: e.target.value })}
                placeholder="e.g. swap, deposit, withdraw"
                className="w-full bg-background border border-border px-3 py-3 text-sm font-mono text-foreground rounded-lg"
              />
            </div>

            {/* Risk */}
            <div>
              <label className="block text-xs font-black text-muted-foreground mb-1.5">Risk level</label>
              <div className="flex flex-wrap gap-1.5">
                {RISK_OPTIONS.map((r) => {
                  const active = sessionForm.riskLevel === r;
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setSessionForm({ ...sessionForm, riskLevel: r })}
                      className={`text-[10px] font-black px-2.5 py-1 border transition ${active ? 'bg-[#F0B90B] text-black border-[#F0B90B]' : 'bg-[#1A1A1A] text-gray-300 border-border hover:border-[#F0B90B]/50'}`}
                    >
                      {r}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Duration */}
            <div>
              <label className="block text-xs font-black text-muted-foreground mb-1.5">Session duration (days)</label>
              <input
                type="number"
                min="1"
                value={sessionForm.expiresAtDays}
                onChange={(e) => setSessionForm({ ...sessionForm, expiresAtDays: Number(e.target.value) })}
                className="w-full bg-background border border-border px-3 py-3 text-sm font-mono text-foreground rounded-lg"
              />
            </div>

            {/* Inline registry-error (422) — user-facing, no stack trace */}
            {taskError && (
              <div className="bg-red-950/40 border border-red-500/40 rounded-lg px-3 py-2 text-[11px] text-red-300 leading-relaxed">
                {taskError}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setShowTaskModal(false)} disabled={taskLoading} className="flex-1 bg-[#1A1A1A] border border-border text-gray-300 text-sm font-black py-3 uppercase tracking-wider disabled:opacity-60">Cancel</button>
              <LoadingButton onClick={handleCreateTask} loading={taskLoading} loadingLabel="Creating..." variant="primary" disabled={!bnbUsdPrice}>Create Task</LoadingButton>
            </div>
          </div>
        </div>
      )}

      {/* TASK CONFIRMATION — shown before any wallet top-up during task creation */}
      <TransactionConfirmModal
        open={showTaskConfirm}
        title="Confirm Deposit"
        subtitle={`Fund the agent wallet on BNB Smart Chain (chain 56)`}
        lines={[
          { label: 'Agent', value: agent?.name ?? '—', tone: 'gold' },
          { label: 'Recipient', value: taskConfirmData?.walletAddress ?? '—', mono: true },
          { label: 'Amount', value: taskConfirmData?.depositToken === 'BNB' ? `${taskConfirmData?.amountBnb ?? '0'} BNB` : `${taskConfirmData?.depositUsd ?? '0'} ${taskConfirmData?.depositToken}`, tone: 'gold', mono: true },
          ...(taskConfirmData?.depositToken !== 'BNB' ? [{ label: 'Gas (BNB)', value: `${taskConfirmData?.amountBnb ?? '0'} BNB`, tone: 'default' as const, mono: true as const }] : []),
          { label: 'Network', value: 'BNB Smart Chain (56)', mono: true },
          { label: 'Fee', value: 'Network gas applies (BNB)', tone: 'default' },
        ]}
        warning={taskConfirmData?.depositToken === 'BNB' ? "Sending BNB to the agent's dedicated wallet. The task will be created AFTER the deposit is confirmed on-chain." : `Sending ${taskConfirmData?.depositToken} + BNB gas to the agent's wallet. Your wallet will prompt twice. The task will be created AFTER both are confirmed.`}
        confirmLabel="Confirm & Create Task"
        confirmLoadingLabel="Sending..."
        confirmLoading={taskLoading}
        onConfirm={handleTaskConfirm}
        onClose={() => { setShowTaskConfirm(false); setTaskConfirmData(null); }}
      />

      {/* TRANSACTION CONFIRMATION — shown before any wallet top-up */}
      <TransactionConfirmModal
        open={topupOpen}
        title="Confirm Top Up"
        subtitle={`Top up the agent wallet on BNB Smart Chain (chain 56)`}
        lines={[
          { label: 'Agent', value: agent.name, tone: 'gold' },
          { label: 'Recipient', value: agent.walletAddress ?? '—', mono: true },
          { label: 'Amount', value: `${topupAmount || '0'} BNB`, tone: 'gold', mono: true },
          { label: 'Network', value: 'BNB Smart Chain (56)', mono: true },
          { label: 'Fee', value: 'Network gas applies (BNB)', tone: 'default' },
        ]}
        warning="Sending BNB to the agent's dedicated wallet. BAN only counts the funds after the deposit is confirmed on-chain — no balance change is assumed before that."
        confirmLabel="Confirm Top Up"
        confirmLoadingLabel="Sending..."
        confirmLoading={topupLoading}
        onConfirm={handleTopupConfirm}
        onClose={() => setTopupOpen(false)}
      />

      {/* WITHDRAW MODAL — withdraw funds from agent wallet to user */}
      {withdrawOpen && (
        <div className="fixed inset-0 z-[60] bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-foreground uppercase tracking-wider">Withdraw Funds</h3>
              <button type="button" onClick={() => setWithdrawOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-black text-muted-foreground uppercase tracking-wider mb-1.5">Token</label>
                <div className="flex gap-2">
                  {(['BNB', 'USDT', 'USDC'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setWithdrawToken(t)}
                      className={`px-4 py-2 text-xs font-black rounded border transition ${withdrawToken === t ? 'bg-[#F0B90B] text-black border-[#F0B90B]' : 'bg-[#1A1A1A] text-gray-300 border-border hover:border-[#F0B90B]/50'}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black text-muted-foreground uppercase tracking-wider mb-1.5">Amount</label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-background border border-border rounded-lg px-3 py-3 text-lg font-black text-foreground font-mono focus:border-[#F0B90B] outline-none"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-black text-muted-foreground">{withdrawToken}</span>
                </div>
              </div>

              <div className="bg-background/40 border border-border rounded-lg p-3 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">From</span>
                  <span className="font-mono text-[#F0B90B] font-black truncate ml-2 max-w-[200px]">{agent.walletAddress ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">To (your wallet)</span>
                  <span className="font-mono text-gray-200 font-black truncate ml-2 max-w-[200px]">{wallet.activeAddress ?? wallet.linkedAddress ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Network</span>
                  <span className="font-mono text-gray-200 font-black">BNB Smart Chain (56)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Gas paid by</span>
                  <span className="font-mono text-gray-200 font-black">Agent wallet (BNB)</span>
                </div>
              </div>

              {withdrawError && (
                <div className="bg-red-950/40 border border-red-500/40 rounded-lg px-3 py-2 text-xs text-red-300 leading-relaxed">
                  {withdrawError}
                </div>
              )}

              {withdrawResult ? (
                <div className="bg-emerald-950/40 border border-emerald-500/40 rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                    <span className="text-sm font-black text-emerald-400">Withdrawal Sent</span>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>{withdrawResult.amount} {withdrawResult.token} → {withdrawResult.to.slice(0, 6)}...{withdrawResult.to.slice(-4)}</p>
                    <p className="font-mono text-[#F0B90B] break-all">{withdrawResult.txHash}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => window.open(`https://bscscan.com/tx/${withdrawResult.txHash}`, '_blank')}
                    className="w-full bg-[#1A1A1A] border border-border text-gray-300 text-xs font-black py-2.5 uppercase tracking-wider hover:border-[#F0B90B]/50"
                  >
                    View on BscScan
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setWithdrawOpen(false)}
                    disabled={withdrawLoading}
                    className="flex-1 bg-[#222] text-foreground text-xs font-black py-3 uppercase tracking-wider disabled:opacity-60"
                  >
                    CANCEL
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setWithdrawError(null);
                      setWithdrawResult(null);
                      const to = wallet.activeAddress ?? wallet.linkedAddress;
                      if (!to) { setWithdrawError('Connect your wallet first'); return; }
                      const amount = withdrawAmount.trim();
                      if (!amount || Number(amount) <= 0) { setWithdrawError('Enter a valid amount'); return; }
                      setWithdrawLoading(true);
                      try {
                        const res = await fetch(`/api/agents/${agent.id}/withdraw`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ to, amount, token: withdrawToken }),
                        });
                        const data = await res.json();
                        if (!res.ok || !data?.ok) {
                          setWithdrawError(data?.error || data?.message || 'Withdrawal failed');
                          return;
                        }
                        setWithdrawResult({ txHash: data.txHash, amount: data.amount, token: data.token, to: data.to });
                        fetchBalance(true);
                        toast.success({ title: 'Withdrawal sent', description: `${amount} ${withdrawToken} withdrawn to your wallet.` });
                      } catch (err) {
                        setWithdrawError(err instanceof Error ? err.message : 'Withdrawal failed');
                      } finally {
                        setWithdrawLoading(false);
                      }
                    }}
                    disabled={withdrawLoading || !withdrawAmount || Number(withdrawAmount) <= 0 || (!wallet.activeAddress && !wallet.linkedAddress)}
                    className="flex-1 bg-[#F0B90B] text-black text-xs font-black py-3 uppercase tracking-wider disabled:opacity-50"
                  >
                    {withdrawLoading ? 'SENDING...' : `WITHDRAW ${withdrawToken}`}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Top-up instruction result */}
      {topupResult && (
        <div className="fixed inset-0 z-[60] bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md space-y-4">
            <div className="w-10 h-10 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <h3 className="text-base font-black text-emerald-400 uppercase tracking-wider">Deposit instruction</h3>
            <div className="bg-background/40 border border-border rounded-lg p-4 space-y-3 text-xs">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Request</span>
                <span className="font-mono font-black text-gray-200">{topupResult.topupRequestId}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Send to</span>
                <span className="font-mono font-black text-[#F0B90B] text-right break-all">{topupResult.walletAddress}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-mono font-black text-gray-200">{topupResult.amountBnb} BNB</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Network</span>
                <span className="font-mono font-black text-gray-200">BNB Smart Chain ({topupResult.chainId})</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Status</span>
                <span className="font-black text-[#F0B90B]">{topupResult.status === 'SENT' ? 'SENT (awaiting on-chain confirmation)' : 'INSTRUCTION'}</span>
              </div>
              {topupResult.txHash && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Transaction</span>
                  <span className="font-mono font-black text-[#F0B90B] text-right break-all">{topupResult.txHash.slice(0, 14)}...</span>
                </div>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">{topupResult.note}</p>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setTopupResult(null)} className="flex-1 bg-[#222] text-foreground text-xs font-black py-2.5 uppercase">Close</button>
              {topupResult.txHash ? (
                <button type="button" onClick={() => { window.open(`https://bscscan.com/tx/${topupResult.txHash}`, '_blank'); }} className="flex-1 bg-[#1A1A1A] border border-border text-gray-300 text-xs font-black py-2.5 uppercase hover:border-[#F0B90B]/50">View Transaction</button>
              ) : (
                <button type="button" onClick={() => { window.open(`https://bscscan.com/address/${topupResult.walletAddress}`, '_blank'); }} className="flex-1 bg-[#1A1A1A] border border-border text-gray-300 text-xs font-black py-2.5 uppercase hover:border-[#F0B90B]/50">View BscScan</button>
              )}
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