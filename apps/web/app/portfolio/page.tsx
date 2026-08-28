'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';

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

interface Agent {
  id: string;
  name: string;
  status: string;
  strategyId?: string;
}

export default function PortfolioPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [positions, setPositions] = useState<{ agentId: string; name: string; capitalUsd: number }[]>([]);
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [successRate, setSuccessRate] = useState<number | null>(null);
  const [feesBnb, setFeesBnb] = useState<string | null>(null);
  const [hasAnyPositions, setHasAnyPositions] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    async function loadPortfolio() {
      if (!user) return;
      setDataLoading(true);
      try {
        const res = await fetch(`/api/agents?ownerId=${encodeURIComponent(user.id)}`);
        if (!res.ok) {
          setPositions([]);
          return;
        }
        const data = await res.json();
        const mine: Agent[] = data.agents || [];

        let confirmed = 0;
        let failed = 0;
        let successSum = 0;
        let successCount = 0;
        let totalFeesWei = 0;
        let anyPositions = false;
        const posList: { agentId: string; name: string; capitalUsd: number }[] = [];

        for (const agent of mine.slice(0, 20)) {
          try {
            const r = await fetch(`/api/agents/${agent.id}/performance`);
            if (!r.ok) continue;
            const pd = (await r.json()).performance as PerformanceData;
            confirmed += pd.confirmedCount || 0;
            failed += pd.failedCount || 0;
            totalFeesWei += Number(pd.totalFeesWei || '0');
            if (pd.confirmedCount > 0) {
              successSum += parseFloat(pd.successRate);
              successCount++;
            }
            const capital = Number(pd.capitalManagedUsd || '0');
            if (pd.hasPositions && capital > 0) {
              anyPositions = true;
              posList.push({ agentId: agent.id, name: agent.name, capitalUsd: capital });
            }
          } catch {
            // ignore
          }
        }

        setConfirmedCount(confirmed);
        setFailedCount(failed);
        setSuccessRate(successCount > 0 ? successSum / successCount : null);
        setFeesBnb(totalFeesWei > 0 ? (totalFeesWei / 1e18).toFixed(4) : null);
        setHasAnyPositions(anyPositions);
        setPositions(posList);
      } catch (err) {
        console.error('Failed to load portfolio:', err);
      } finally {
        setDataLoading(false);
      }
    }
    loadPortfolio();
  }, [user]);

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black text-white">
        <div className="text-center">
          <div className="inline-block animate-spin mb-4"><div className="h-8 w-8 border-4 border-[#F0B90B] border-t-transparent rounded-full" /></div>
          <p className="text-[#F0B90B] font-mono text-xs uppercase tracking-widest">Loading portfolio...</p>
        </div>
      </div>
    );
  }

  const totalCapital = positions.reduce((s, p) => s + p.capitalUsd, 0);

  return (
    <div className="min-h-screen bg-black text-white font-sans antialiased pb-24">
      <header className="bg-black px-5 pt-6 pb-4 flex items-center justify-between">
        <h2 className="text-[22px] font-black text-[#F0B90B] tracking-wide">PORTFOLIO</h2>
      </header>

      <div className="mx-5 mt-2 bg-[#111] rounded-xl p-5 border border-[#222]">
        <div className="flex items-center justify-between mb-4">
          <span className="text-[10px] font-black text-gray-400 tracking-widest uppercase">Total portfolio value</span>
        </div>
        {dataLoading ? (
          <div className="py-4 text-center text-gray-500 text-xs">Loading positions...</div>
        ) : hasAnyPositions ? (
          <div className="flex items-baseline gap-3 mb-4">
            <p className="text-[40px] font-black leading-none text-white">
              ${totalCapital.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
        ) : (
          <div>
            <p className="text-lg font-black text-gray-400 mb-1">No positions yet</p>
            <p className="text-xs text-gray-500">
              Portfolio metrics will appear after BAN records its first on-chain position.
            </p>
          </div>
        )}
      </div>

      <div className="mx-5 mt-4 bg-[#111] rounded-xl p-5 border border-[#222]">
        <h3 className="text-[10px] font-black text-white tracking-widest uppercase mb-4">Positions</h3>
        {dataLoading ? (
          <p className="text-xs text-gray-500">Loading...</p>
        ) : positions.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-sm font-black text-gray-400 mb-1">No positions recorded</p>
            <p className="text-xs text-gray-500">
              No execution position records exist yet. On-chain allocations will be listed here once BAN records them.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {positions.map((p) => (
              <button
                key={p.agentId}
                onClick={() => router.push(`/my-agents/${p.agentId}`)}
                className="w-full flex items-center justify-between p-3 bg-[#1A1A1A] rounded-lg border border-[#333] hover:border-[#F0B90B]/50 transition"
              >
                <div>
                  <p className="text-sm font-bold text-white">{p.name}</p>
                  <p className="text-[10px] text-gray-500 font-mono">{p.agentId.slice(0, 12)}...</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-black text-[#F0B90B]">${p.capitalUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                  <p className="text-[10px] text-gray-500">Capital managed</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mx-5 mt-4 bg-[#111] rounded-xl p-5 border border-[#222]">
        <h3 className="text-[10px] font-black text-white tracking-widest uppercase mb-4">Operational Performance</h3>
        {dataLoading ? (
          <p className="text-xs text-gray-500">Loading...</p>
        ) : (
          <div className="flex justify-between">
            <div className="text-center flex-1">
              <p className="text-xs text-gray-500 font-bold mb-1">Confirmed</p>
              <p className="text-lg font-black text-white">{confirmedCount}</p>
            </div>
            <div className="text-center flex-1">
              <p className="text-xs text-gray-500 font-bold mb-1">Failed</p>
              <p className="text-lg font-black text-red-400">{failedCount}</p>
            </div>
            <div className="text-center flex-1">
              <p className="text-xs text-gray-500 font-bold mb-1">Success rate</p>
              <p className="text-lg font-black text-[#F0B90B]">
                {successRate != null ? `${(successRate * 100).toFixed(0)}%` : '—'}
              </p>
            </div>
            <div className="text-center flex-1">
              <p className="text-xs text-gray-500 font-bold mb-1">Gas used</p>
              <p className="text-lg font-black text-white font-mono">{feesBnb ?? '—'}</p>
            </div>
          </div>
        )}
        <div className="mt-4 pt-3 border-t border-[#222]">
          <p className="text-[10px] font-black text-gray-500 tracking-widest uppercase mb-2">P&amp;L &amp; Allocation</p>
          <p className="text-xs text-gray-500">
            P&amp;L and allocation breakdowns are not displayed until BAN records on-chain position data for your agents.
          </p>
        </div>
      </div>

      <MobileBottomNav />
    </div>
  );
}