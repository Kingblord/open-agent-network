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
  spend: { spendLimit: string; used: string; asset: string };
  status: string;
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
  const [allocations, setAllocations] = useState<Permission[]>([]);
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
        const allocList: Permission[] = [];

        for (const a of mine.slice(0, 20)) {
          const [perf, perm] = await Promise.all([
            fetch(`/api/agents/${a.id}/performance`).then(r => r.ok ? r.json() : null).catch(() => null),
            fetch(`/api/permissions?agentId=${encodeURIComponent(a.id)}`).then(r => r.ok ? r.json() : null).catch(() => null),
          ]);
          const pd = perf?.performance as PerformanceData | undefined;
          if (pd) {
            conf += pd.confirmedCount || 0; fail += pd.failedCount || 0;
            fees += BigInt(pd.totalFeesWei || '0');
            if (pd.confirmedCount > 0) { srSum += parseFloat(pd.successRate); srCnt++; }
            if (pd.hasPositions && parseFloat(pd.capitalManagedUsd) > 0) posList.push({ agentId: a.id, name: a.name, capitalUsd: parseFloat(pd.capitalManagedUsd) });
          }
          if (perm?.permissions) {
            for (const p of perm.permissions) { if (p.status === 'ACTIVE') allocList.push(p); }
          }
        }
        setConfirmed(conf); setFailed(fail);
        setSuccessRate(srCnt > 0 ? srSum / srCnt : null);
        setFeesBnb(fees > 0n ? (Number(fees) / 1e18).toFixed(4) : null);
        setPositions(posList);
        setAllocations(allocList);
        setTotalUsd(prev => prev + posList.reduce((s, p) => s + p.capitalUsd, 0));
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
    <div className="min-h-screen bg-background text-foreground font-sans antialiased pb-24">
      <header className="bg-background px-5 pt-6 pb-4 flex items-center justify-between">
        <h2 className="text-[22px] font-black text-[#F0B90B] tracking-wide">PORTFOLIO</h2>
      </header>

      {/* Wallet Balances */}
      {isConnected && address && balances.length > 0 && (
        <div className="mx-5 mb-4 bg-card rounded-xl p-5 border border-border">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-black text-muted-foreground tracking-widest uppercase">Wallet</span>
            <span className="text-[10px] font-mono text-muted-foreground">{address.slice(0,6)}...{address.slice(-4)}</span>
          </div>
          <div className="space-y-2">
            {balances.map(b => (
              <div key={b.token} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-[#F0B90B]/20 flex items-center justify-center text-[10px] font-black text-[#F0B90B]">{b.token[0]}</span>
                  <span className="text-sm font-bold text-foreground">{b.token}</span>
                </div>
                <div className="text-right">
                  <p className="text-sm font-black text-foreground">{parseFloat(b.balance).toFixed(b.token === 'BNB' ? 4 : 2)}</p>
                  <p className="text-[10px] text-muted-foreground">${b.usdValue.toFixed(2)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Protocol Positions (Venus, Aave, PancakeSwap LP) */}
      {isConnected && address && protocolPositions.length > 0 && (
        <div className="mx-5 mb-4 bg-card rounded-xl p-5 border border-border">
          <h3 className="text-[10px] font-black text-foreground tracking-widest uppercase mb-4">Protocol Positions</h3>
          <div className="space-y-2">
            {protocolPositions.map((p, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border border-border">
                <div>
                  <p className="text-sm font-bold text-foreground uppercase">{p.protocol}</p>
                  <p className="text-[10px] text-muted-foreground">{'token' in p ? p.token : ''} {p.protocol === 'aave' ? `HF: ${(p as any).healthFactor.toFixed(2)}` : ''}</p>
                </div>
                <div className="text-right">
                  {p.protocol === 'venus' && <p className="text-sm font-black text-emerald-400">{(p as any).supplied} {(p as any).token}</p>}
                  {p.protocol === 'aave' && <><p className="text-sm font-black text-emerald-400">${parseFloat((p as any).collateral).toFixed(2)}</p><p className="text-[10px] text-red-400">Debt: ${parseFloat((p as any).debt).toFixed(2)}</p></>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PancakeSwap LP Positions */}
      {isConnected && address && lpCount > 0 && (
        <div className="mx-5 mb-4 bg-card rounded-xl p-5 border border-border">
          <h3 className="text-[10px] font-black text-foreground tracking-widest uppercase mb-4">PancakeSwap LP Positions</h3>
          <p className="text-sm font-black text-[#F0B90B]">{lpCount} active position{lpCount > 1 ? 's' : ''}</p>
        </div>
      )}

      {/* Total Value */}
      <div className="mx-5 mb-4 bg-card rounded-xl p-5 border border-border">
        <span className="text-[10px] font-black text-muted-foreground tracking-widest uppercase">Total Value</span>
        <p className="text-[40px] font-black leading-none text-foreground mt-2">
          {totalUsd > 0
            ? `$${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : '—'}
        </p>
      </div>

      {/* Agent Allocations */}
      {allocations.length > 0 && (
        <div className="mx-5 mb-4 bg-card rounded-xl p-5 border border-border">
          <h3 className="text-[10px] font-black text-foreground tracking-widest uppercase mb-4">Active Allocations</h3>
          <div className="space-y-2">
            {allocations.map((a, i) => (
              <button key={`${a.agentId}-${i}`} onClick={() => router.push(`/my-agents/${a.agentId}`)}
                className="w-full flex items-center justify-between p-3 bg-muted/50 rounded-lg border border-border hover:border-[#F0B90B]/50 transition">
                <div>
                  <p className="text-sm font-bold text-foreground">{a.agentId.slice(0, 20)}...</p>
                  <p className="text-[10px] text-muted-foreground">{a.spend.asset} &middot; {a.status}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-black text-[#F0B90B]">{parseFloat(a.spend.spendLimit).toFixed(2)} {a.spend.asset}</p>
                  <p className="text-[10px] text-muted-foreground">{parseFloat(a.spend.used || '0').toFixed(2)} used</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Positions */}
      <div className="mx-5 mb-4 bg-card rounded-xl p-5 border border-border">
        <h3 className="text-[10px] font-black text-foreground tracking-widest uppercase mb-4">Positions</h3>
        {loading ? <p className="text-xs text-muted-foreground">Loading...</p> : positions.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-sm font-black text-muted-foreground mb-1">No positions</p>
            <p className="text-xs text-muted-foreground">On-chain positions appear after BAN records them.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {positions.map(p => (
              <button key={p.agentId} onClick={() => router.push(`/my-agents/${p.agentId}`)}
                className="w-full flex items-center justify-between p-3 bg-muted/50 rounded-lg border border-border hover:border-[#F0B90B]/50 transition">
                <div>
                  <p className="text-sm font-bold text-foreground">{p.name}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">{p.agentId.slice(0,12)}...</p>
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
      <div className="mx-5 mb-4 bg-card rounded-xl p-5 border border-border">
        <h3 className="text-[10px] font-black text-foreground tracking-widest uppercase mb-4">Performance</h3>
        {loading ? <p className="text-xs text-muted-foreground">Loading...</p> : (
          <>
            <div className="flex justify-between mb-3">
              <div className="text-center flex-1"><p className="text-xs text-muted-foreground font-bold mb-1">Confirmed</p><p className="text-lg font-black text-foreground">{confirmed}</p></div>
              <div className="text-center flex-1"><p className="text-xs text-muted-foreground font-bold mb-1">Failed</p><p className="text-lg font-black text-red-400">{failed}</p></div>
              <div className="text-center flex-1"><p className="text-xs text-muted-foreground font-bold mb-1">Success</p><p className="text-lg font-black text-[#F0B90B]">{successRate != null ? `${(successRate * 100).toFixed(0)}%` : '—'}</p></div>
              <div className="text-center flex-1"><p className="text-xs text-muted-foreground font-bold mb-1">Gas</p><p className="text-lg font-black text-foreground font-mono">{feesBnb ?? '—'}</p></div>
            </div>
            {positions.length > 0 && <div className="pt-3 border-t border-border"><p className="text-[10px] font-black text-muted-foreground tracking-widest uppercase mb-2">P&amp;L</p>{positions.map(p => <p key={p.agentId} className="text-xs text-foreground mb-1">{p.name}: ${p.capitalUsd.toFixed(2)} managed</p>)}</div>}
          </>
        )}
      </div>

      <MobileBottomNav />
    </div>
  );
}