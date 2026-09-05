'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useWallet } from '@/lib/wallet-context';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';

interface OnchainTx {
  hash: string;
  block: number;
  timestamp: string;
  from: string;
  to: string;
  value: string;
  token: string;
  valueUsd: number;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER';
  status: 'CONFIRMED' | 'FAILED';
  agentId?: string;
  agentName?: string;
  gasUsed: string;
  gasPriceGwei: string;
}

interface HistoryItem {
  id: string;
  type: 'ONCHAIN' | 'AUDIT';
  eventType: string;
  source: 'bscscan' | 'ban';
  timestamp: string;
  payload: Record<string, unknown>;
}

const TRANSACTION_TYPES = new Set(['TRANSACTION_SUBMITTED', 'TRANSACTION_CONFIRMED', 'TRANSACTION_FAILED', 'DEPOSIT_CONFIRMED', 'WITHDRAWAL_CONFIRMED']);

export default function HistoryPage() {
  const { user, loading } = useAuth();
  const { linkedAddress, isConnected } = useWallet();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'TRANSACTIONS' | 'AGENTS'>('ALL');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bnbPrice, setBnbPrice] = useState(600);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (mounted && !loading && !user) router.push('/login');
  }, [mounted, user, loading, router]);

  useEffect(() => {
    async function loadHistory() {
      if (!user) return;
      setDataLoading(true);
      setLoadError(null);
      try {
        const address = linkedAddress;
        if (address) {
          // Fetch real on-chain history + agent audit events
          const res = await fetch(`/api/developers/history?address=${encodeURIComponent(address)}`);
          if (res.ok) {
            const data = await res.json();
            setHistory(data.history || []);
            setBnbPrice(data.bnbPrice || 600);
            setDataLoading(false);
            return;
          }
        }

        // Fallback: agent-only audit events
        const res = await fetch(`/api/agents?ownerId=${encodeURIComponent(user.id)}`);
        if (!res.ok) {
          setLoadError('Unable to load history.');
          setHistory([]);
          return;
        }
        const agentsData = await res.json();
        const mine: { id: string; name: string }[] = agentsData.agents || [];

        const all: HistoryItem[] = [];
        for (const agent of mine.slice(0, 10)) {
          try {
            const r = await fetch(`/api/agents/${agent.id}/activity?limit=50`);
            if (r.ok) {
              const d = await r.json();
              for (const ev of (d.events || [])) {
                all.push({
                  id: ev.id,
                  type: 'AUDIT',
                  eventType: ev.eventType,
                  source: 'ban',
                  timestamp: ev.createdAt,
                  payload: ev.payload || {},
                });
              }
            }
          } catch { /* ignore */ }
        }
        all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setHistory(all.slice(0, 100));
      } catch (err) {
        console.error('Failed to load history:', err);
        setLoadError('Failed to load your activity.');
      } finally {
        setDataLoading(false);
      }
    }
    loadHistory();
  }, [user, linkedAddress]);

  const filtered = history.filter((item) => {
    if (activeFilter === 'ALL') return true;
    if (activeFilter === 'TRANSACTIONS') return TRANSACTION_TYPES.has(item.eventType) || item.type === 'ONCHAIN';
    if (activeFilter === 'AGENTS') return item.type === 'AUDIT';
    return true;
  });

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const formatPayload = (item: HistoryItem): string => {
    if (item.type === 'ONCHAIN') {
      const tx = item.payload as unknown as OnchainTx;
      const prefix = tx.type === 'DEPOSIT' ? 'Received' : 'Sent';
      return `${prefix} ${tx.value} ${tx.token} ($${tx.valueUsd.toFixed(2)}) → ${tx.to.slice(0, 6)}...${tx.to.slice(-4)}`;
    }
    const entries = Object.entries(item.payload);
    if (entries.length === 0) return 'Agent event recorded';
    return entries.slice(0, 3).map(([k, v]) => `${k}: ${String(v)}`).join(' · ');
  };

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background text-foreground">
        <div className="text-center">
          <div className="inline-block animate-spin mb-4">
            <div className="h-8 w-8 border-4 border-[#F0B90B] border-t-transparent rounded-full" />
          </div>
          <p className="text-[#F0B90B] font-mono text-xs uppercase tracking-widest">Loading history...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      <div className="pb-20">
        <header className="bg-background px-5 pt-6 pb-4 flex items-center justify-between border-b border-[#1A1A1A]">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/dashboard')} className="w-8 h-8 rounded-lg bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <div>
              <h2 className="text-[22px] font-black text-[#F0B90B] tracking-wide">ACTIVITY</h2>
            </div>
          </div>
          {linkedAddress && <span className="text-[10px] font-mono text-muted-foreground">{linkedAddress.slice(0,6)}...{linkedAddress.slice(-4)}</span>}
        </header>

        <div className="mx-5 mt-4 flex gap-2">
          {(['ALL', 'TRANSACTIONS', 'AGENTS'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setActiveFilter(filter)}
              className={`px-4 py-2 text-[10px] font-black tracking-wider uppercase rounded ${
                activeFilter === filter
                  ? 'bg-[#F0B90B] text-black'
                  : 'bg-[#1A1A1A] text-foreground border border-border'
              }`}
            >
              {filter}
            </button>
          ))}
        </div>

        <div className="mx-5 mt-4 space-y-3">
          {dataLoading && (
            <div className="text-center py-10 text-muted-foreground text-sm">
              <div className="inline-block w-6 h-6 border-2 border-[#F0B90B] border-t-transparent rounded-full animate-spin mb-2" />
              Loading activity...
            </div>
          )}

          {!dataLoading && loadError && (
            <div className="dark:bg-card bg-gray-50 rounded-xl p-4 border dark:border-border border-gray-200 text-center">
              <p className="text-sm font-black text-muted-foreground">{loadError}</p>
              <p className="text-xs text-muted-foreground mt-1">Please check your connection and try again.</p>
            </div>
          )}

          {!dataLoading && !loadError && filtered.length === 0 && (
            <div className="dark:bg-card bg-gray-50 rounded-xl p-4 border dark:border-border border-gray-200 text-center py-8">
              <p className="text-sm font-black text-muted-foreground mb-1">No activity yet</p>
              <p className="text-xs text-muted-foreground">
                {activeFilter === 'TRANSACTIONS' ? 'On-chain deposits and withdrawals will appear here.' : 'Agent activity will appear after deployment.'}
              </p>
            </div>
          )}

          {!dataLoading && !loadError && filtered.map((item) => (
            <div key={item.id} className="dark:bg-card bg-gray-50 rounded-xl p-4 border dark:border-border border-gray-200">
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 flex items-center justify-center shrink-0 ${item.source === 'bscscan' ? 'bg-emerald-500' : 'bg-[#F0B90B]'}`}>
                  {item.source === 'bscscan' ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                      <polyline points="17 6 23 6 23 12" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="4" y="8" width="16" height="12" rx="2" />
                      <circle cx="9" cy="13" r="1.5" fill="black" />
                      <circle cx="15" cy="13" r="1.5" fill="black" />
                      <path d="M10 17h4" />
                      <line x1="12" y1="4" x2="12" y2="8" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-black text-foreground capitalize">
                        {item.eventType.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">{formatPayload(item)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-muted-foreground mb-1">{timeAgo(item.timestamp)}</p>
                      <span className={`text-[9px] font-black uppercase px-2 py-0.5 ${item.source === 'bscscan' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-[#F0B90B]/20 text-[#F0B90B]'}`}>
                        {item.source === 'bscscan' ? 'ONCHAIN' : 'BAN'}
                      </span>
                    </div>
                  </div>
                  {item.source === 'bscscan' && (() => {
                    const tx = item.payload as unknown as OnchainTx;
                    return (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {tx.agentName && (
                          <span className="text-[9px] font-black bg-[#F0B90B]/20 text-[#F0B90B] px-2 py-0.5 uppercase tracking-wider rounded">
                            {tx.agentName}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => window.open(`https://bscscan.com/tx/${tx.hash}`, '_blank')}
                          className="text-[10px] font-mono text-[#F0B90B] hover:underline truncate max-w-[200px]"
                        >
                          {tx.hash.slice(0, 10)}...{tx.hash.slice(-6)}
                        </button>
                        <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 ${tx.status === 'CONFIRMED' ? 'text-green-400' : 'text-red-400'}`}>
                          {tx.status}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <MobileBottomNav />
    </div>
  );
}