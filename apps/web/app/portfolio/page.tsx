'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useWallet } from '@/lib/wallet-context';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';

interface TokenBalance {
  token: string;
  balance: string;
  usdValue: number;
}

interface ProtocolPosition {
  protocol: string;
  token?: string;
  supplied?: string;
  borrowed?: string;
  collateral?: string;
  debt?: string;
  healthFactor?: number;
}

interface WalletBalanceResponse {
  ok: boolean;
  bnb: string;
  usdt: string;
  usdc: string;
  bnbPrice: number;
  usdTotal: number;
  venus: { protocol: string; token: string; supplied: string; borrowed: string }[] | null;
  aave: { protocol: string; collateral: string; debt: string; healthFactor: number } | null;
  pancakeswapLpCount: number;
}

interface Agent {
  id: string;
  name: string;
  status: string;
  strategyId?: string;
  walletAddress?: string;
}

interface PerformanceData {
  confirmedCount: number;
  failedCount: number;
  successRate: string;
  totalFeesWei: string;
  capitalManagedUsd: string;
  hasPositions: boolean;
}

interface Permission {
  agentId: string;
  id: string;
  spend: { spendLimit: string; used: string; asset: string };
  status: string;
}

interface AgentAllocation {
  agentId: string;
  name: string;
  walletAddress: string;
  bnbBalance: number;
  bnbUsd: number;
  usdtBalance: number;
  usdcBalance: number;
  totalUsd: number;
  hasWallet: boolean;
}

export default function PortfolioPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { linkedAddress, isConnected } = useWallet();
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [protocolPositions, setProtocolPositions] = useState<ProtocolPosition[]>([]);
  const [lpCount, setLpCount] = useState(0);
  const [bnbPrice, setBnbPrice] = useState(600);
  const [totalUsd, setTotalUsd] = useState(0);
  const [positions, setPositions] = useState<{ agentId: string; name: string; capitalUsd: number }[]>([]);
  const [allocations, setAllocations] = useState<AgentAllocation[]>([]);
  const [allocationAmounts, setAllocationAmounts] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(0);
  const [failed, setFailed] = useState(0);
  const [successRate, setSuccessRate] = useState<number | null>(null);
  const [feesBnb, setFeesBnb] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const address = linkedAddress; // Use Firestore-persisted address

  const fetchBalances = useCallback(async (addr: string) => {
    try {
      const res = await fetch(`/api/developers/wallet/balance?address=${encodeURIComponent(addr)}`);
      if (res.ok) {
        const data = await res.json() as WalletBalanceResponse;
        const list: TokenBalance[] = [];
        let total = 0;
        list.push({ token: 'BNB', balance: data.bnb, usdValue: parseFloat(data.bnb) * data.bnbPrice });
        total += parseFloat(data.bnb) * data.bnbPrice;
        if (parseFloat(data.usdt) > 0) { list.push({ token: 'USDT', balance: data.usdt, usdValue: parseFloat(data.usdt) }); total += parseFloat(data.usdt); }
        if (parseFloat(data.usdc) > 0) { list.push({ token: 'USDC', balance: data.usdc, usdValue: parseFloat(data.usdc) }); total += parseFloat(data.usdc); }
        setBalances(list);
        setBnbPrice(data.bnbPrice);
        setTotalUsd(prev => prev + total);

        // Protocol positions
        const protos: ProtocolPosition[] = [];
        if (data.venus) { for (const v of data.venus) protos.push(v); }
        if (data.aave) protos.push(data.aave);
        setProtocolPositions(protos);
        setLpCount(data.pancakeswapLpCount || 0);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { if (address) fetchBalances(address); }, [address, fetchBalances]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/agents?ownerId=${encodeURIComponent(user.id)}`);
        const mine: Agent[] = res.ok ? (await res.json()).agents || [] : [];
        let conf = 0, fail = 0, srSum = 0, srCnt = 0, fees = 0n;
        const posList: { agentId: string; name: string; capitalUsd: number }[] = [];
        const allocList: AgentAllocation[] = [];

        for (const a of mine.slice(0, 20)) {
          const [perf, perm, balanceRes] = await Promise.all([
            fetch(`/api/agents/${a.id}/performance`).then(r => r.ok ? r.json() : null).catch(() => null),
            fetch(`/api/permissions?agentId=${encodeURIComponent(a.id)}`).then(r => r.ok ? r.json() : null).catch(() => null),
            fetch(`/api/agents/${a.id}/balance`).then(r => r.ok ? r.json() : null).catch(() => null),
          ]);
          const pd = perf?.performance as PerformanceData | undefined;
          if (pd) {
            conf += pd.confirmedCount || 0; fail += pd.failedCount || 0;
            fees += BigInt(pd.totalFeesWei || '0');
            if (pd.confirmedCount > 0) { srSum += parseFloat(pd.successRate); srCnt++; }
            if (pd.hasPositions && parseFloat(pd.capitalManagedUsd) > 0) posList.push({ agentId: a.id, name: a.name, capitalUsd: parseFloat(pd.capitalManagedUsd) });
          }

          // Real agent wallet allocation
          const bnbBal = balanceRes?.balanceBnb ? Number(balanceRes.balanceBnb) : 0;
          const bnbUsdVal = bnbBal * (balanceRes?.usdPrice ?? bnbPrice);
          allocList.push({
            agentId: a.id,
            name: a.name,
            walletAddress: a.walletAddress ?? '',
            bnbBalance: bnbBal,
            bnbUsd: bnbUsdVal,
            usdtBalance: 0,
            usdcBalance: 0,
            totalUsd: bnbUsdVal,
            hasWallet: Boolean(a.walletAddress),
          });
        }
        setConfirmed(conf); setFailed(fail);
        setSuccessRate(srCnt > 0 ? srSum / srCnt : null);
        setFeesBnb(fees > 0n ? (Number(fees) / 1e18).toFixed(4) : null);
        setPositions(posList);
        setAllocations(allocList);
        setTotalUsd(prev => prev + posList.reduce((s, p) => s + p.capitalUsd, 0) + allocList.reduce((s, a) => s + a.totalUsd, 0));
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, [user]);

  if (authLoading || !user) return (
    <div className="flex items-center justify-center min-h-screen bg-background text-foreground">
      <div className="text-center">
        <div className="inline-block animate-spin mb-4"><div className="h-8 w-8 border-4 border-[#F0B90B] border-t-transparent rounded-full" /></div>
        <p className="text-[#F0B90B] font-mono text-xs uppercase tracking-widest">Loading portfolio...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen dark:bg-background dark:text-foreground bg-white text-black font-sans antialiased transition-colors duration-200">
      <div className="pb-24">
        <header className="dark:bg-background bg-white px-5 pt-6 pb-4 flex items-center justify-between border-b dark:border-[#1A1A1A] border-gray-200">
          <div>
            <h1 className="text-[28px] font-black leading-none tracking-tight text-[#F0B90B]">PORTFOLIO</h1>
            <div className="text-[10px] font-bold leading-tight text-[#F0B90B] tracking-wider mt-0.5">
              <span>CAPITAL</span><br /><span>OVERVIEW</span>
            </div>
          </div>
          {isConnected && address && (
            <span className="text-[10px] font-mono dark:text-muted-foreground text-muted-foreground">{address.slice(0,6)}...{address.slice(-4)}</span>
          )}
        </header>

        {/* Total Value — yellow hero card */}
        <section className="bg-[#F0B90B] px-5 pt-5 pb-6 w-full">
          <div className="flex items-start justify-between mb-2">
            <span className="text-[10px] font-black text-black tracking-widest uppercase">Total Value</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="black">
              <rect x="2" y="2" width="5" height="5" /><rect x="9.5" y="2" width="5" height="5" /><rect x="17" y="2" width="5" height="5" />
              <rect x="2" y="9.5" width="5" height="5" /><rect x="9.5" y="9.5" width="5" height="5" /><rect x="17" y="9.5" width="5" height="5" />
            </svg>
          </div>
          <p className="text-[80px] font-black leading-[0.85] text-black">
            {totalUsd > 0
              ? `$${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : '—'}
          </p>
          <p className="text-sm font-black text-black mt-2">
            {totalUsd > 0 ? 'Assets under management' : 'No assets tracked yet'}
          </p>

          {/* Wallet Balances grid */}
          {isConnected && address && balances.length > 0 && (
            <div className="grid grid-cols-3 gap-3 border-t border-black/30 pt-4 mt-4">
              {balances.map(b => (
                <div key={b.token}>
                  <p className="text-[10px] font-black text-black/70 tracking-widest uppercase mb-1">{b.token}</p>
                  <p className="text-lg font-black leading-none text-black">{parseFloat(b.balance).toFixed(b.token === 'BNB' ? 4 : 2)}</p>
                  <p className="text-[10px] font-bold text-black/60 mt-0.5">${b.usdValue.toFixed(2)}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Protocol Positions */}
        {isConnected && address && protocolPositions.length > 0 && (
          <div className="mx-5 mt-5 dark:bg-card bg-gray-50 rounded-xl p-4 border dark:border-border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-black dark:text-foreground text-black tracking-widest uppercase">Protocol Positions</span>
              {lpCount > 0 && <span className="text-[10px] font-black text-[#F0B90B]">{lpCount} LP</span>}
            </div>
            <div className="space-y-3">
              {protocolPositions.map((p, i) => (
                <div key={i} className="flex items-center justify-between dark:bg-background/40 bg-white/60 rounded-lg p-3 border dark:border-border border-gray-200">
                  <div>
                    <p className="text-sm font-bold dark:text-foreground text-black uppercase">{p.protocol}</p>
                    <p className="text-[10px] dark:text-muted-foreground text-muted-foreground">
                      {'token' in p && p.token ? p.token : ''}
                      {'healthFactor' in p && typeof p.healthFactor === 'number' ? ` HF: ${p.healthFactor.toFixed(2)}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    {'supplied' in p && typeof p.supplied === 'string' && (
                      <p className="text-sm font-black text-emerald-400">{p.supplied} {p.token}</p>
                    )}
                    {'collateral' in p && typeof p.collateral === 'string' && (
                      <>
                        <p className="text-sm font-black text-emerald-600">${parseFloat(p.collateral).toFixed(2)}</p>
                        {'debt' in p && typeof p.debt === 'string' && parseFloat(p.debt) > 0 && (
                          <p className="text-[10px] text-red-400">Debt: ${parseFloat(p.debt).toFixed(2)}</p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Agent Allocations — real wallet balances */}
        {allocations.length > 0 && (
          <div className="mx-5 mt-5 dark:bg-card bg-gray-50 rounded-xl p-4 border dark:border-border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-black dark:text-foreground text-black tracking-widest uppercase">Agent Allocations</span>
              <span className="text-[10px] font-black text-[#F0B90B]">{allocations.filter(a => a.totalUsd > 0).length} funded</span>
            </div>
            <div className="space-y-3">
              {allocations.map((a) => (
                <div key={a.agentId} className="dark:bg-background/40 bg-white/60 rounded-lg border dark:border-border border-gray-200 p-3">
                  <button onClick={() => router.push(`/my-agents/${a.agentId}`)} className="w-full flex items-center justify-between mb-2">
                    <div className="text-left">
                      <p className="text-sm font-bold dark:text-foreground text-black">{a.name || a.agentId.slice(0, 20)}</p>
                      <p className="text-[10px] dark:text-muted-foreground text-muted-foreground font-mono">{a.walletAddress ? `${a.walletAddress.slice(0,6)}...${a.walletAddress.slice(-4)}` : 'No wallet'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-[#F0B90B]">${a.totalUsd.toFixed(2)}</p>
                      <p className="text-[10px] dark:text-muted-foreground text-muted-foreground">{a.bnbBalance.toFixed(4)} BNB</p>
                    </div>
                  </button>
                  <div className="flex items-center gap-2 border-t dark:border-border border-gray-200 pt-2">
                    <div className="relative flex-1">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={allocationAmounts[a.agentId] || ''}
                        onChange={(e) => setAllocationAmounts(prev => ({ ...prev, [a.agentId]: e.target.value }))}
                        placeholder="Amount BNB"
                        className="w-full dark:bg-background bg-white border dark:border-border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono dark:text-foreground text-black focus:border-[#F0B90B] outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const amt = allocationAmounts[a.agentId];
                        if (amt && Number(amt) > 0) router.push(`/my-agents/${a.agentId}?deposit=${amt}`);
                      }}
                      disabled={!allocationAmounts[a.agentId] || Number(allocationAmounts[a.agentId]) <= 0}
                      className="bg-[#F0B90B] text-black text-xs font-black px-4 py-2 uppercase rounded tracking-wider hover:bg-yellow-400 transition disabled:opacity-50 shrink-0"
                    >
                      DEPOSIT
                    </button>
                  </div>
                  {a.totalUsd > 0 && (
                    <div className="mt-2 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                      <span className="text-[9px] text-muted-foreground">Funded · {a.bnbBalance.toFixed(4)} BNB (${a.bnbUsd.toFixed(2)})</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Positions */}
        <div className="mx-5 mt-5 dark:bg-card bg-gray-50 rounded-xl p-4 border dark:border-border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-black dark:text-foreground text-black tracking-widest uppercase">Positions</span>
          </div>
          {loading ? (
            <p className="text-xs text-muted-foreground py-2">Loading...</p>
          ) : positions.length === 0 ? (
            <div className="py-2">
              <p className="text-sm font-black text-muted-foreground mb-1">No positions</p>
              <p className="text-xs dark:text-muted-foreground text-muted-foreground">On-chain positions appear after BAN agents execute.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {positions.map(p => (
                <button key={p.agentId} onClick={() => router.push(`/my-agents/${p.agentId}`)}
                  className="w-full flex items-center justify-between dark:bg-background/40 bg-white/60 rounded-lg p-3 border dark:border-border border-gray-200 hover:border-[#F0B90B]/50 transition">
                  <div className="text-left">
                    <p className="text-sm font-bold dark:text-foreground text-black">{p.name}</p>
                    <p className="text-[10px] dark:text-muted-foreground text-muted-foreground font-mono">{p.agentId.slice(0,12)}...</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-[#F0B90B]">${p.capitalUsd.toFixed(2)}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Performance */}
        <div className="mx-5 mt-5 dark:bg-card bg-gray-50 rounded-xl p-4 border dark:border-border border-gray-200">
          <span className="text-[10px] font-black dark:text-foreground text-black tracking-widest uppercase block mb-4">Performance</span>
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading...</p>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <p className="text-[10px] font-black dark:text-muted-foreground text-muted-foreground tracking-widest uppercase mb-1">Confirmed</p>
                  <p className="text-xl font-black leading-none dark:text-foreground text-black">{confirmed}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black dark:text-muted-foreground text-muted-foreground tracking-widest uppercase mb-1">Failed</p>
                  <p className="text-xl font-black leading-none text-red-400">{failed}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black dark:text-muted-foreground text-muted-foreground tracking-widest uppercase mb-1">Success</p>
                  <p className="text-xl font-black leading-none text-[#F0B90B]">{successRate != null ? `${(successRate * 100).toFixed(0)}%` : '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black dark:text-muted-foreground text-muted-foreground tracking-widest uppercase mb-1">Gas</p>
                  <p className="text-xl font-black leading-none dark:text-foreground text-black font-mono">{feesBnb ?? '—'}</p>
                </div>
              </div>
              {positions.length > 0 && (
                <div className="mt-4 pt-3 border-t dark:border-border border-gray-200">
                  <p className="text-[10px] font-black dark:text-muted-foreground text-muted-foreground tracking-widest uppercase mb-2">P&L</p>
                  {positions.map(p => (
                    <p key={p.agentId} className="text-xs dark:text-foreground text-black mb-1">{p.name}: ${p.capitalUsd.toFixed(2)} managed</p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <MobileBottomNav />
    </div>
  );
}