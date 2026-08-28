'use client';

import { useState, useEffect } from 'react';
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

export default function AgentsMarketplacePage() {
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    async function loadAgents() {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch('/api/agents');
        if (res.ok) {
          const data = await res.json();
          const apiAgents: Agent[] = data.agents || data || [];
          setAgents(apiAgents);
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
    }
    loadAgents();
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

  return (
    <div className="min-h-screen bg-black text-white font-mono flex flex-col pb-24">
      <div className="flex items-center justify-between p-4 border-b border-[#222]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="w-8 h-8 rounded-lg bg-[#111] border border-[#222] flex items-center justify-center text-gray-400 hover:text-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div>
            <div className="text-xs font-bold text-[#F0B90B] tracking-wider uppercase">Marketplace</div>
            <div className="text-lg font-black tracking-tight text-white">DISCOVER AGENTS</div>
          </div>
        </div>
        <Link
          href="/my-agents"
          className="px-3 py-1.5 bg-[#111] border border-[#333] hover:border-[#F0B90B] text-xs font-bold text-[#F0B90B] rounded"
        >
          MY AGENTS →
        </Link>
      </div>

      <div className="p-4 space-y-4 max-w-md mx-auto w-full flex-1">
        <div className="relative">
          <input
            type="text"
            placeholder="Search agents, strategies, protocols..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#111] border border-[#222] rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#F0B90B] transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-3 text-gray-500 hover:text-white text-xs"
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
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${
                selectedCategory === cat
                  ? 'bg-[#F0B90B] text-black'
                  : 'bg-[#111] border border-[#222] text-gray-400 hover:text-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="bg-[#F0B90B] rounded-xl p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] font-black text-black tracking-widest uppercase mb-1">BNB AGENT NETWORK</p>
              <p className="text-sm font-black text-black">Autonomous Agents Working For You</p>
              <p className="text-xs text-black/70 mt-1">Yield • Trading • Rebalance • Safety</p>
            </div>
            <div className="w-10 h-10 bg-black rounded-lg flex items-center justify-center">
              <span className="text-[#F0B90B] text-lg font-black">{deployedCount}</span>
            </div>
          </div>
        </div>

        <div className="bg-[#111] border border-[#222] rounded-xl p-3 flex items-center justify-between text-xs">
          <div className="text-gray-400">
            Available: <span className="text-[#F0B90B] font-bold">{filteredAgents.length}</span> agents
          </div>
          <div className="text-gray-400">
            Network: <span className="text-white font-bold">BNB Chain</span>
          </div>
        </div>

        {loading && (
          <div className="py-12 text-center text-gray-500 text-sm">
            <div className="inline-block w-6 h-6 border-2 border-[#F0B90B] border-t-transparent rounded-full animate-spin mb-2" />
            <div>Loading verified agents...</div>
          </div>
        )}

        {!loading && loadError && (
          <div className="py-12 text-center bg-[#111] border border-[#222] rounded-2xl p-6">
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-[#F0B90B] flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v20M2 12h20" />
              </svg>
            </div>
            <div className="text-white font-bold text-sm mb-1">{loadError}</div>
            {loadError.includes('Sign in') ? (
              <button
                onClick={() => router.push('/login')}
                className="px-4 py-2 bg-[#F0B90B] text-black font-bold text-xs rounded-lg"
              >
                Go to Login
              </button>
            ) : (
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-[#F0B90B] text-black font-bold text-xs rounded-lg"
              >
                Retry
              </button>
            )}
          </div>
        )}

        {!loading && !loadError && filteredAgents.length === 0 && (
          <div className="py-12 text-center bg-[#111] border border-[#222] rounded-2xl p-6">
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-[#F0B90B] flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="8" width="16" height="12" rx="2" /><circle cx="9" cy="13" r="1.5" fill="black" /><circle cx="15" cy="13" r="1.5" fill="black" /><path d="M10 17h4" /><line x1="12" y1="4" x2="12" y2="8" />
              </svg>
            </div>
            <div className="text-white font-bold text-sm mb-1">No agents available</div>
            <div className="text-xs text-gray-500 mb-4">
              Agents registered on BAN will appear here as the network grows.
            </div>
            <button
              onClick={() => router.push('/my-agents')}
              className="px-4 py-2 bg-[#F0B90B] text-black font-bold text-xs rounded-lg"
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
                  className="block bg-[#111] hover:bg-[#161616] border border-[#222] hover:border-[#F0B90B]/50 rounded-2xl p-4 transition-all relative overflow-hidden group"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[#F0B90B] flex items-center justify-center">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="4" y="8" width="16" height="12" rx="2" /><circle cx="9" cy="13" r="1.5" fill="black" /><circle cx="15" cy="13" r="1.5" fill="black" /><path d="M10 17h4" /><line x1="12" y1="4" x2="12" y2="8" />
                        </svg>
                      </div>
                      <div>
                        <div className="text-white font-bold text-sm group-hover:text-[#F0B90B] transition-colors flex items-center gap-1.5">
                          {agent.name}
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        </div>
                        <div className="text-[11px] text-[#F0B90B]">
                          {(agent.strategyId || agent.type || 'General').toUpperCase()}
                        </div>
                      </div>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${riskColor}`}>
                      {risk} RISK
                    </span>
                  </div>

                  {agent.description && (
                    <p className="text-xs text-gray-400 line-clamp-2 mb-3">
                      {agent.description}
                    </p>
                  )}

                  <div className="grid grid-cols-3 gap-2 bg-black/60 rounded-xl p-2.5 border border-[#1f1f1f] text-center mb-3">
                    <div>
                      <div className="text-[10px] text-gray-500 uppercase">Type</div>
                      <div className="text-xs font-bold text-white">{(agent.type || '—').toUpperCase()}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-gray-500 uppercase">Strategy</div>
                      <div className="text-xs font-bold text-[#F0B90B]">{(agent.strategyId || '—').toUpperCase()}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-gray-500 uppercase">Cost</div>
                      <div className="text-xs font-bold text-white">
                        {agent.costPerExecution != null ? `${agent.costPerExecution}` : '—'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[#F0B90B] font-bold text-xs group-hover:translate-x-0.5 transition-transform">
                      VIEW &amp; HIRE
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F0B90B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12h14" /><path d="M12 5l7 7-7 7" />
                      </svg>
                    </div>
                    <span className="text-[10px] text-gray-500 font-mono">ID: {agent.id.slice(0, 10)}...</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <MobileBottomNav />
    </div>
  );
}