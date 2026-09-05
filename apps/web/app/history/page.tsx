'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';

interface ActivityEvent {
  id: string;
  eventType: string;
  agentId: string;
  correlationId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface Agent {
  id: string;
  name: string;
}

const TRANSACTION_TYPES = new Set(['TRANSACTION_SUBMITTED', 'TRANSACTION_CONFIRMED', 'TRANSACTION_FAILED']);
const AGENT_TYPES = new Set(['ACTION_PROPOSED', 'ACTION_APPROVED', 'ACTION_DENIED', 'EXECUTION_QUEUED', 'POSITION_UPDATED', 'AI_DECISION_CREATED', 'OBSERVATION_CREATED']);

export default function HistoryPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'TRANSACTIONS' | 'AGENTS'>('ALL');
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !loading && !user) {
      router.push('/login');
    }
  }, [mounted, user, loading, router]);

  useEffect(() => {
    async function loadHistory() {
      if (!user) return;
      setDataLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(`/api/agents?ownerId=${encodeURIComponent(user.id)}`);
        if (!res.ok) {
          setLoadError('Unable to load your agent activity.');
          setEvents([]);
          return;
        }
        const data = await res.json();
        const mine: Agent[] = data.agents || [];

        const all: ActivityEvent[] = [];
        for (const agent of mine.slice(0, 10)) {
          try {
            const r = await fetch(`/api/agents/${agent.id}/activity?limit=50`);
            if (r.ok) {
              const d = await r.json();
              all.push(...(d.events || []));
            }
          } catch {
            // ignore per-agent failures
          }
        }
        all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setEvents(all.slice(0, 100));
      } catch (err) {
        console.error('Failed to load history:', err);
        setLoadError('Failed to load your activity.');
      } finally {
        setDataLoading(false);
      }
    }
    loadHistory();
  }, [user]);

  const filteredEvents = events.filter((e) => {
    if (activeFilter === 'ALL') return true;
    if (activeFilter === 'TRANSACTIONS') return TRANSACTION_TYPES.has(e.eventType);
    if (activeFilter === 'AGENTS') return AGENT_TYPES.has(e.eventType);
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

  const formatPayload = (payload: Record<string, unknown>) => {
    const entries = Object.entries(payload);
    if (entries.length === 0) return 'Agent event recorded';
    return entries.slice(0, 3).map(([k, v]) => `${k}: ${String(v)}`).join(' · ');
  };

  const isTransaction = (type: string) => TRANSACTION_TYPES.has(type);

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
            <button
              onClick={() => router.push('/dashboard')}
              className="w-8 h-8 rounded-lg bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <div>
              <h2 className="text-[22px] font-black text-[#F0B90B] tracking-wide">ACTIVITY</h2>
            </div>
          </div>
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
            <div className="bg-card rounded-xl p-6 border border-border text-center">
              <p className="text-sm font-black text-muted-foreground">{loadError}</p>
              <p className="text-xs text-muted-foreground mt-1">Please check your connection and try again.</p>
            </div>
          )}

          {!dataLoading &&
            !loadError &&
            filteredEvents.map((ev) => (
              <div key={ev.id} className="bg-card rounded-xl p-4 border border-border">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-[#F0B90B] flex items-center justify-center shrink-0">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      {isTransaction(ev.eventType) ? (
                        <>
                          <path d="M7 17L17 7" />
                          <path d="M7 7h10v10" />
                        </>
                      ) : (
                        <>
                          <rect x="4" y="8" width="16" height="12" rx="2" />
                          <circle cx="9" cy="13" r="1.5" fill="black" />
                          <circle cx="15" cy="13" r="1.5" fill="black" />
                          <path d="M10 17h4" />
                          <line x1="12" y1="4" x2="12" y2="8" />
                        </>
                      )}
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-black text-foreground capitalize">
                          {ev.eventType.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">{formatPayload(ev.payload)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[10px] text-muted-foreground">{timeAgo(ev.createdAt)}</p>
                        <span className="bg-[#F0B90B] text-black text-[9px] font-black uppercase px-2 py-0.5 mt-1 inline-block">
                          LOG
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}

          {!dataLoading && !loadError && filteredEvents.length === 0 && (
            <div className="text-center py-12 bg-card rounded-xl border border-border">
              <div className="w-14 h-14 mx-auto mb-3 rounded-xl bg-[#F0B90B] flex items-center justify-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="8" width="16" height="12" rx="2" />
                  <circle cx="9" cy="13" r="1.5" fill="black" />
                  <circle cx="15" cy="13" r="1.5" fill="black" />
                  <path d="M10 17h4" />
                  <line x1="12" y1="4" x2="12" y2="8" />
                </svg>
              </div>
              <div className="text-foreground font-bold text-base mb-1">No activity found</div>
              <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                {activeFilter === 'TRANSACTIONS'
                  ? 'No on-chain transaction events recorded yet. Transactions will appear once BAN submits executions for your agents.'
                  : activeFilter === 'AGENTS'
                  ? 'No agent action events recorded yet.'
                  : 'Your agent activity and transactions will appear here.'}
              </p>
            </div>
          )}
        </div>
      </div>

      <MobileBottomNav />
    </div>
  );
}