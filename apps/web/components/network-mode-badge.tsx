'use client';

interface NetworkModeBadgeProps {
  mode?: string;
}

/**
 * Displays the agent's real execution mode from the performance engine.
 *
 * mode is one of: LIVE | TESTNET | SIMULATED.
 * - LIVE    → confirmed on-chain executions recorded on mainnet
 * - TESTNET → executions recorded on a testnet chain
 * - SIMULATED / undefined → no confirmed on-chain data yet (honest empty state)
 *
 * Never fabricates a mode: absent data shows as TESTNET-PENDING, not LIVE.
 */
export default function NetworkModeBadge({ mode }: NetworkModeBadgeProps) {
  const normalized = (mode || '').toUpperCase();

  if (normalized === 'LIVE') {
    return (
      <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        LIVE
      </span>
    );
  }

  if (normalized === 'TESTNET') {
    return (
      <span className="text-xs font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        TESTNET
      </span>
    );
  }

  if (normalized === 'SIMULATED') {
    return (
      <span className="text-xs font-bold text-muted-foreground flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
        SIMULATED
      </span>
    );
  }

  return (
    <span className="text-xs font-bold text-muted-foreground flex items-center gap-1">
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
      NO DATA
    </span>
  );
}