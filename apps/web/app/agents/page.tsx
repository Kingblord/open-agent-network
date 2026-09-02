'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { CryptoIcon } from '@/components/crypto-icon';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';
import { useToast } from '@/components/toast-provider';

interface Agent {
  id: string;
  name: string;
  description?: string;
  category?: string;
  type?: string;
  strategyId?: string;
  status: string;
  riskLevel?: string;
  costPerExecution?: number;
  capabilities?: { id: string; name: string }[];
  protocols?: string[];
  allowedProtocols?: string[];
  ownerId?: string;
  createdAt: string;
}

interface AgentsResponse {
  ok: boolean;
  agents: Agent[];
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
}

const PAGE_SIZE = 10;

export default function AgentsMarketplacePage() {
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const loadAgents = useCallback(async (pageToLoad: number) => {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = new URLSearchParams({
        page: String(pageToLoad),
        limit: String(PAGE_SIZE),
      });
      const res = await fetch(`/api/agents?${qs.toString()}`);
      if (res.ok) {
        const data = (await res.json()) as AgentsResponse;
        setAgents(data.agents || []);
        setTotal(data.total ?? data.agents?.length ?? 0);
        setTotalPages(data.totalPages ?? Math.max(1, Math.ceil((data.total ?? data.agents?.length ?? 0) / PAGE_SIZE)));
        setPage(data.page ?? pageToLoad);
      } else if (res.status === 401) {
        const msg = 'Sign in required to browse the marketplace.';
        setLoadError(msg);
        toast.error(msg);
      } else {
        const msg = 'Failed to load agents.';
        setLoadError(msg);
        toast.error(msg);
      }
    } catch (err) {
      console.error('Failed to load agents:', err);
      const msg = 'Failed to load agents. Please try again.';
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadAgents(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categories = Array.from(
    new Set(agents.map((a) => (a.strategyId || a.type || 'General').toUpperCase()))
  );
  const CATEGORIES = ['ALL', ...categories];

  const filteredAgents = agents.filter((agent) => {
    const matchesSearch =
      agent.name.toLowerCase().includes(search.toLowerCase()) ||
      (agent.description && agent.description.toLowerCase().includes(search.toLowerCase()));

    if (selectedCategory === 'ALL') return matchesSearch;
    const agentCat = (agent.strategyId || agent.type || 'General').toUpperCase();
    return matchesSearch && agentCat === selectedCategory;
  });

  const deployedCount = agents.length;

  const goToPage = (p: number) => {
    if (p < 1 || p > totalPages || p === page) return;
    loadAgents(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const pageNumbers: (number | 'â€¦')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pageNumbers.push(i);
  } else {
    pageNumbers.push(1);
    if (page > 3) pageNumbers.push('â€¦');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pageNumbers.push(i);
    }
    if (page < totalPages - 2) pageNumbers.push('â€¦');
    pageNumbers.push(totalPages);
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-mono flex flex-col pb-24">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="w-8 h-8 rounded-lg bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div>
            <div className="text-xs font-bold text-accent tracking-wider uppercase">Marketplace</div>
            <div className="text-lg font-black tracking-tight text-foreground">DISCOVER AGENTS</div>
          </div>
        </div>
        <Link
          href="/my-agents"
          className="px-3 py-1.5 bg-card border border-border hover:border-accent text-xs font-bold text-accent rounded"
        >
          MY AGENTS â†’
        </Link>
      </div>

      <div className="p-4 space-y-4 max-w-md mx-auto w-full flex-1">
        <div className="relative">
          <input
            type="text"
            placeholder="Search agents, strategies, protocols..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-card border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-3 text-muted-foreground hover:text-foreground text-xs"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => { setSelectedCategory(cat); setPage(1); loadAgents(1); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${
                selectedCategory === cat
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-card border border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="bg-accent rounded-xl p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] font-black text-accent-foreground tracking-widest uppercase mb-1">BNB AGENT NETWORK</p>
              <p className="text-sm font-black text-accent-foreground">Autonomous Agents Working For You</p>
              <p className="text-xs text-accent-foreground/70 mt-1">Yield â€¢ Trading â€¢ Rebalance â€¢ Safety</p>
            </div>
            <div className="w-10 h-10 bg-card rounded-lg flex items-center justify-center">
              <span className="text-accent text-lg font-black">{deployedCount}</span>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-3 flex items-center justify-between text-xs">
          <div className="text-muted-foreground">
            Available: <span className="text-accent font-bold">{total}</span> agents
          </div>
          <div className="text-muted-foreground">
            Network: <span className="text-foreground font-bold">BNB Chain</span>
          </div>
        </div>

        {loading && (
          <div className="py-12 text-center text-muted-foreground text-sm">
            <div className="inline-block w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin mb-2" />
            <div>Loading verified agents...</div>
          </div>
        )}

        {!loading && loadError && (
          <div className="py-12 text-center bg-card border border-border rounded-2xl p-6">
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-accent flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v20M2 12h20" />
              </svg>
            </div>
            <div className="text-foreground font-bold text-sm mb-1">{loadError}</div>
            {loadError.includes('Sign in') ? (
              <button
                onClick={() => router.push('/login')}
                className="px-4 py-2 bg-accent text-accent-foreground font-bold text-xs rounded-lg"
              >
                Go to Login
              </button>
            ) : (
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-accent text-accent-foreground font-bold text-xs rounded-lg"
              >
                Retry
              </button>
            )}
          </div>
        )}

        {!loading && !loadError && filteredAgents.length === 0 && (
          <div className="py-12 text-center bg-card border border-border rounded-2xl p-6">
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-accent flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="8" width="16" height="12" rx="2" /><circle cx="9" cy="13" r="1.5" fill="currentColor" /><circle cx="15" cy="13" r="1.5" fill="currentColor" /><path d="M10 17h4" /><line x1="12" y1="4" x2="12" y2="8" />
              </svg>
            </div>
            <div className="text-foreground font-bold text-sm mb-1">No agents available</div>
            <div className="text-xs text-muted-foreground mb-4">
              Agents registered on BAN will appear here as the network grows.
            </div>
            <button
              onClick={() => router.push('/my-agents')}
              className="px-4 py-2 bg-accent text-accent-foreground font-bold text-xs rounded-lg"
            >
              Register an Agent
            </button>
          </div>
        )}

        {!loading && !loadError && filteredAgents.length > 0 && (
          <div className="grid grid-cols-1 gap-3">
            {filteredAgents.map((agent) => {
              const risk = (agent.riskLevel || 'LOW').toUpperCase();
              const riskColor =
                risk === 'LOW'
                  ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
                  : risk === 'MEDIUM'
                  ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
                  : 'text-red-400 border-red-500/30 bg-red-500/10';

              return (
                <Link
                  key={agent.id}
                  href={`/agents/${agent.id}`}
                  className="block bg-card hover:bg-card/80 border border-border hover:border-accent/50 rounded-2xl p-4 transition-all relative overflow-hidden group"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="4" y="8" width="16" height="12" rx="2" /><circle cx="9" cy="13" r="1.5" fill="currentColor" /><circle cx="15" cy="13" r="1.5" fill="currentColor" /><path d="M10 17h4" /><line x1="12" y1="4" x2="12" y2="8" />
                        </svg>
                      </div>
                      <div>
                        <div className="text-foreground font-bold text-sm group-hover:text-accent transition-colors flex items-center gap-1.5">
                          {agent.name}
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        </div>
                        <div className="text-[11px] text-accent">
                          {(agent.strategyId || agent.type || 'General').toUpperCase()}
                        </div>
                      </div>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${riskColor}`}>
                      {risk} RISK
                    </span>
                  </div>

                  {agent.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                      {agent.description}
                    </p>
                  )}

                  <div className="grid grid-cols-3 gap-2 bg-muted/50 rounded-xl p-2.5 border border-border text-center mb-3">
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase">Type</div>
                      <div className="text-xs font-bold text-foreground">{(agent.type || 'â€”').toUpperCase()}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase">Strategy</div>
                      <div className="text-xs font-bold text-accent">{(agent.strategyId || 'â€”').toUpperCase()}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase">Cost</div>
                      <div className="text-xs font-bold text-foreground">
                        {agent.costPerExecution != null ? `${agent.costPerExecution}` : 'â€”'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-accent font-bold text-xs group-hover:translate-x-0.5 transition-transform">
                      VIEW &amp; HIRE
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F0B90B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12h14" /><path d="M12 5l7 7-7 7" />
                      </svg>
                    </div>
                    <span className="text-[10px] text-muted-foreground font-mono">ID: {agent.id.slice(0, 10)}...</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {!loading && !loadError && totalPages > 1 && (
          <div className="flex flex-col items-center gap-2 pt-2">
            <div className="flex items-center gap-1.5 flex-wrap justify-center">
              <button
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1}
                className="px-2.5 py-1.5 rounded-lg bg-card border border-border text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none text-xs font-bold"
                aria-label="Previous page"
              >
                â€¹
              </button>
              {pageNumbers.map((p, idx) =>
                p === 'â€¦' ? (
                  <span key={`e-${idx}`} className="px-1.5 text-muted-foreground text-xs">â€¦</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => goToPage(p)}
                    className={`min-w-8 h-8 px-2 rounded-lg text-xs font-bold transition-colors ${
                      p === page
                        ? 'bg-accent text-accent-foreground'
                        : 'bg-card border border-border text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
              <button
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages}
                className="px-2.5 py-1.5 rounded-lg bg-card border border-border text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none text-xs font-bold"
                aria-label="Next page"
              >
                â€º
              </button>
            </div>
            <div className="text-[11px] text-muted-foreground">
              Page {page} of {totalPages} Â· Showing {total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}â€“{Math.min(page * PAGE_SIZE, total)} of {total}
            </div>
          </div>
        )}
      </div>

      <MobileBottomNav />
    </div>
  );
}