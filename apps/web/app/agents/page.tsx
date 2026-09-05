'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';
import { useToast } from '@/components/toast-provider';

interface Agent {
  id: string;
  name: string;
  description?: string;
  type?: string;
  strategyId?: string;
  status: string;
  riskLevel?: string;
  costPerExecution?: number;
  capabilities?: { id: string; name: string }[];
  protocols?: string[];
  createdAt: string;
  source?: 'BAN_NATIVE' | 'EXTERNAL';
  registry?: { verified: boolean };
  reputation?: number | null;
}

interface AgentsResponse {
  ok: boolean;
  agents: Agent[];
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  erc8004?: { count: number; liveError?: string | null };
}

const PAGE_SIZE = 20;

const BAN_NATIVE_AGENTS: Agent[] = [
  { id: 'agent_yield_optimizer', name: 'BAN Yield Optimizer', description: 'Continuously scans BNB supply/yield opportunities (Venus, Aave, Lista), selects the best effective yield after fees/gas/slippage/risk, and proposes deterministic yield actions.', type: 'yield', strategyId: 'yield', status: 'ACTIVE', riskLevel: 'LOW', capabilities: [{ id: 'READ_YIELD', name: 'Read yield' }, { id: 'PROPOSE_SWAP', name: 'Propose swap' }], protocols: ['pancakeswap', 'venus', 'aave', 'lista'], createdAt: '2026-08-27T16:52:16.976Z', source: 'BAN_NATIVE' },
  { id: 'agent_health_factor_monitor', name: 'BAN Health Factor Monitor', description: 'Watches lending positions (Venus, Aave, Lista) and calculates health factor continuously. Emits HEALTHY/WARNING/CRITICAL/EMERGENCY states and proposes protective actions before liquidation.', type: 'health', strategyId: 'health', status: 'ACTIVE', riskLevel: 'LOW', capabilities: [{ id: 'READ_LENDING_POSITION', name: 'Read lending position' }, { id: 'PROPOSE_LENDING_ACTION', name: 'Propose lending action' }], protocols: ['venus', 'aave', 'lista'], createdAt: '2026-08-27T16:52:18.041Z', source: 'BAN_NATIVE' },
  { id: 'agent-lp-rebalancer', name: 'BAN LP Rebalancer', description: 'Manages concentrated PancakeSwap liquidity positions. Detects range inefficiency, calculates a deterministic candidate range, and proposes safe remove/reposition/add actions.', type: 'lp', strategyId: 'lp', status: 'ACTIVE', riskLevel: 'HIGH', capabilities: [{ id: 'READ_LP_POSITION', name: 'Read LP position' }, { id: 'PROPOSE_LP_REBALANCE', name: 'Propose LP rebalance' }], protocols: ['pancakeswap'], createdAt: '2026-08-27T16:52:19.069Z', source: 'BAN_NATIVE' },
  { id: 'ag_fda2d0c6f12a44a99b1e', name: 'BAN Grid Trader', description: 'Runs a bounded grid strategy within configured lower/upper price, grid count, capital and stop conditions. Generates deterministic grid signals and proposes swaps to keep orders in range.', type: 'grid', strategyId: 'grid', status: 'ACTIVE', riskLevel: 'MEDIUM', capabilities: [{ id: 'READ_PRICE', name: 'Read price' }, { id: 'PROPOSE_GRID_ORDER', name: 'Propose grid order' }], protocols: ['pancakeswap'], createdAt: '2026-09-02T11:32:40.447Z', source: 'BAN_NATIVE' },
];

export default function AgentsMarketplacePage() {
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<'ban' | 'marketplace'>('ban');
  const [externalAgents, setExternalAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [erc8004Info, setErc8004Info] = useState<{ count: number; liveError?: string | null }>({ count: 0 });

  const loadExternalAgents = useCallback(async (pageToLoad: number) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(pageToLoad), limit: String(PAGE_SIZE), source: 'erc8004' });
      const res = await fetch(`/api/agents?${qs.toString()}`);
      if (res.ok) {
        const data = (await res.json()) as AgentsResponse;
        setExternalAgents(data.agents || []);
        setTotal(data.total ?? 0);
        setTotalPages(data.totalPages ?? 1);
        setPage(data.page ?? pageToLoad);
        if (data.erc8004) setErc8004Info(data.erc8004);
      }
    } catch (err) {
      console.error('Failed to load external agents:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (tab === 'marketplace') loadExternalAgents(1); }, [tab, loadExternalAgents]);

  const banAgents = BAN_NATIVE_AGENTS;
  const banCategories = Array.from(new Set(banAgents.map((a) => (a.strategyId || a.type || 'General').toUpperCase())));
  const banFiltered = banAgents.filter((a) => {
    const m = a.name.toLowerCase().includes(search.toLowerCase()) || (a.description && a.description.toLowerCase().includes(search.toLowerCase()));
    return selectedCategory === 'ALL' ? m : m && (a.strategyId || a.type || 'General').toUpperCase() === selectedCategory;
  });

  const extCategories = Array.from(new Set(externalAgents.map((a) => (a.strategyId || a.type || 'General').toUpperCase())));
  const extFiltered = externalAgents.filter((a) => {
    const m = a.name.toLowerCase().includes(search.toLowerCase()) || (a.description && a.description.toLowerCase().includes(search.toLowerCase()));
    return selectedCategory === 'ALL' ? m : m && (a.strategyId || a.type || 'General').toUpperCase() === selectedCategory;
  });

  const activeAgents = tab === 'ban' ? banFiltered : extFiltered;
  const activeCategories = tab === 'ban' ? ['ALL', ...banCategories] : ['ALL', ...extCategories];

  const goToPage = (p: number) => {
    if (p < 1 || p > totalPages || p === page) return;
    loadExternalAgents(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const pageNumbers = getPageNumbers(page, totalPages);

  return (
    <div className="min-h-screen bg-background text-foreground font-mono flex flex-col pb-24">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="w-8 h-8 rounded-lg bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <div>
            <div className="text-xs font-bold text-accent tracking-wider uppercase">Discover</div>
            <div className="text-lg font-black tracking-tight text-foreground">AGENTS</div>
          </div>
        </div>
        <Link href="/my-agents" className="px-3 py-1.5 bg-card border border-border hover:border-accent text-xs font-bold text-accent rounded">MY AGENTS &rarr;</Link>
      </div>

      <div className="p-4 space-y-4 max-w-md mx-auto w-full flex-1">
        {/* Tabs */}
        <div className="flex gap-1 bg-card border border-border rounded-xl p-1">
          <button onClick={() => { setTab('ban'); setSearch(''); setSelectedCategory('ALL'); }} className={`flex-1 px-4 py-2 rounded-lg text-xs font-bold transition-colors ${tab === 'ban' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            BAN Smart Money
          </button>
          <button onClick={() => { setTab('marketplace'); setSearch(''); setSelectedCategory('ALL'); }} className={`flex-1 px-4 py-2 rounded-lg text-xs font-bold transition-colors ${tab === 'marketplace' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            Marketplace
            {erc8004Info.count > 0 && <span className="ml-1.5 px-1.5 py-0.5 bg-accent-foreground/20 rounded text-[10px]">{erc8004Info.count}</span>}
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <input type="text" placeholder="Search agents, strategies, protocols..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full bg-card border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent transition-colors" />
          {search && <button onClick={() => setSearch('')} className="absolute right-3 top-3 text-muted-foreground hover:text-foreground text-xs"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>}
        </div>

        {/* Category filter */}
        {activeCategories.length > 1 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
            {activeCategories.map((cat) => (
              <button key={cat} onClick={() => setSelectedCategory(cat)} className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${selectedCategory === cat ? 'bg-accent text-accent-foreground' : 'bg-card border border-border text-muted-foreground hover:text-foreground'}`}>{cat}</button>
            ))}
          </div>
        )}

        {/* Banner */}
        {tab === 'ban' ? (
          <div className="bg-accent rounded-xl p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-black text-accent-foreground tracking-widest uppercase mb-1">BAN SMART MONEY</p>
                <p className="text-sm font-black text-accent-foreground">Four First-Class Agents</p>
                <p className="text-xs text-accent-foreground/70 mt-1">Yield &bull; Trading &bull; Rebalance &bull; Safety</p>
              </div>
              <div className="w-10 h-10 bg-card rounded-lg flex items-center justify-center"><span className="text-accent text-lg font-black">{banAgents.length}</span></div>
            </div>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl p-3 flex items-center justify-between text-xs">
            <div className="text-muted-foreground">Available: <span className="text-accent font-bold">{total}</span> external agents</div>
            <div className="text-muted-foreground">Network: <span className="text-foreground font-bold">BNB Chain</span></div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="py-12 text-center text-muted-foreground text-sm">
            <div className="inline-block w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin mb-2" />
            <div>Loading agents...</div>
          </div>
        )}

        {/* Empty */}
        {!loading && activeAgents.length === 0 && (
          <div className="py-12 text-center bg-card border border-border rounded-2xl p-6">
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-accent flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="8" width="16" height="12" rx="2" /><circle cx="9" cy="13" r="1.5" fill="currentColor" /><circle cx="15" cy="13" r="1.5" fill="currentColor" /><path d="M10 17h4" /><line x1="12" y1="4" x2="12" y2="8" /></svg>
            </div>
            <div className="text-foreground font-bold text-sm mb-1">{tab === 'ban' ? 'No agents matched' : 'No external agents available'}</div>
            <div className="text-xs text-muted-foreground">{tab === 'ban' ? 'Try a different search or category.' : 'External agents from 8004scan.io will appear here.'}</div>
          </div>
        )}

        {/* Agent cards */}
        {!loading && activeAgents.length > 0 && (
          <div className="grid grid-cols-1 gap-3">
            {activeAgents.map((agent) => {
              const risk = (agent.riskLevel || 'LOW').toUpperCase();
              const riskColor = risk === 'LOW' ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : risk === 'MEDIUM' ? 'text-amber-400 border-amber-500/30 bg-amber-500/10' : 'text-red-400 border-red-500/30 bg-red-500/10';
              return (
                <Link key={agent.id} href={`/agents/${agent.id}`} className="block bg-card hover:bg-card/80 border border-border hover:border-accent/50 rounded-2xl p-4 transition-all relative overflow-hidden group">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="8" width="16" height="12" rx="2" /><circle cx="9" cy="13" r="1.5" fill="currentColor" /><circle cx="15" cy="13" r="1.5" fill="currentColor" /><path d="M10 17h4" /><line x1="12" y1="4" x2="12" y2="8" /></svg></div>
                      <div>
                        <div className="text-foreground font-bold text-sm group-hover:text-accent transition-colors flex items-center gap-1.5">
                          {agent.name}
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        </div>
                        <div className="text-[11px] text-accent">{(agent.strategyId || agent.type || 'General').toUpperCase()}</div>
                      </div>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${riskColor}`}>{risk} RISK</span>
                  </div>
                  {agent.description && <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{agent.description}</p>}
                  <div className="grid grid-cols-3 gap-2 bg-muted/50 rounded-xl p-2.5 border border-border text-center mb-3">
                    <div><div className="text-[10px] text-muted-foreground uppercase">Type</div><div className="text-xs font-bold text-foreground">{(agent.type || '-').toUpperCase()}</div></div>
                    <div><div className="text-[10px] text-muted-foreground uppercase">Strategy</div><div className="text-xs font-bold text-accent">{(agent.strategyId || '-').toUpperCase()}</div></div>
                    <div><div className="text-[10px] text-muted-foreground uppercase">Source</div><div className="text-xs font-bold text-foreground">{agent.source === 'EXTERNAL' ? 'ERC-8004' : 'BAN'}</div></div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-accent font-bold text-xs group-hover:translate-x-0.5 transition-transform">
                      VIEW &amp; HIRE
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F0B90B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M12 5l7 7-7 7" /></svg>
                    </div>
                    <span className="text-[10px] text-muted-foreground font-mono">ID: {agent.id.slice(0, 10)}...</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {!loading && tab === 'marketplace' && totalPages > 1 && (
          <div className="flex flex-col items-center gap-2 pt-2">
            <div className="flex items-center gap-1.5 flex-wrap justify-center">
              <button onClick={() => goToPage(page - 1)} disabled={page <= 1} className="px-2.5 py-1.5 rounded-lg bg-card border border-border text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none text-xs font-bold">&lsaquo;</button>
              {pageNumbers.map((p, idx) => p === -1 ? <span key={`e-${idx}`} className="px-1.5 text-muted-foreground text-xs">&hellip;</span> : (
                <button key={p} onClick={() => goToPage(p)} className={`min-w-8 h-8 px-2 rounded-lg text-xs font-bold transition-colors ${p === page ? 'bg-accent text-accent-foreground' : 'bg-card border border-border text-muted-foreground hover:text-foreground'}`}>{p}</button>
              ))}
              <button onClick={() => goToPage(page + 1)} disabled={page >= totalPages} className="px-2.5 py-1.5 rounded-lg bg-card border border-border text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none text-xs font-bold">&rsaquo;</button>
            </div>
            <div className="text-[11px] text-muted-foreground">
              Page {page} of {totalPages} &mdash; Showing {total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}&ndash;{Math.min(page * PAGE_SIZE, total)} of {total}
            </div>
          </div>
        )}
      </div>
      <MobileBottomNav />
    </div>
  );
}

function getPageNumbers(current: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: number[] = [1];
  if (current > 3) pages.push(-1);
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i);
  if (current < total - 2) pages.push(-1);
  pages.push(total);
  return pages;
}