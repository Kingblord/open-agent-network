'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';
import { useToast } from '@/components/toast-provider';

interface RegistrySnapshot {
  chainId: number;
  generatedAt: string;
  tokens: Array<{
    id: string;
    symbol: string;
    name: string;
    address: string;
    decimals: number;
    verified: boolean;
    enabled: boolean;
    native?: boolean;
  }>;
  protocols: Array<{
    id: string;
    name: string;
    status: string;
    official: boolean;
    priority?: string;
    integrationStatus: string;
    reason: string;
    contracts: Array<{
      id: string;
      address: string;
      name: string;
      verified: boolean;
      enabled: boolean;
      capabilities: string[];
      integrationStatus: string;
      reason: string;
      functions: Array<{ name: string; capability: string }>;
    }>;
  }>;
}

const LADDER_ORDER = ['DISCOVERY_ONLY', 'READ_ONLY', 'SIMULATION', 'EXECUTION_ENABLED'] as const;
const LADDER_STYLES: Record<string, string> = {
  DISCOVERY_ONLY: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
  READ_ONLY: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  SIMULATION: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  EXECUTION_ENABLED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
};
const PRIORITY_STYLES: Record<string, string> = {
  P0: 'bg-[#F0B90B]/10 text-[#F0B90B] border-[#F0B90B]/30',
  P1: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  P2: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  P3: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};
const CAP_STYLE = 'bg-[#1A1A1A] text-gray-300 border border-[#333]';

function StatusBadge({ value }: { value: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-black tracking-wider uppercase ${LADDER_STYLES[value] ?? LADDER_STYLES.DISCOVERY_ONLY}`}>
      {value === 'EXECUTION_ENABLED' ? '● ' : ''}{value}
    </span>
  );
}

export default function ProtocolsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [mounted, setMounted] = useState(false);
  const [snapshot, setSnapshot] = useState<RegistrySnapshot | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(true);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !loading && !user) {
      router.push('/login');
    }
  }, [mounted, user, loading, router]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/protocols');
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setFetchError(err.error || 'Failed to load protocol registry.');
          return;
        }
        const data = await res.json();
        if (!cancelled && data.ok && data.snapshot) setSnapshot(data.snapshot);
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to fetch protocols:', err);
          setFetchError('Failed to load protocol registry.');
        }
      } finally {
        if (!cancelled) setLoadingSnapshot(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black text-white">
        <div className="text-center">
          <div className="inline-block animate-spin mb-4">
            <div className="h-8 w-8 border-4 border-[#F0B90B] border-t-transparent rounded-full" />
          </div>
          <p className="text-[#F0B90B] font-mono text-xs uppercase tracking-widest">Loading protocols...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white font-sans antialiased">
      <div className="pb-20">
        <header className="bg-black px-5 pt-6 pb-4 flex items-center justify-between border-b border-[#1A1A1A]">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/settings')}
              className="w-8 h-8 rounded-lg bg-[#111] border border-[#222] flex items-center justify-center text-gray-400 hover:text-white"
              aria-label="Back to settings"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <div>
              <h2 className="text-[22px] font-black text-[#F0B90B] tracking-wide">PROTOCOL REGISTRY</h2>
              <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">BNB Chain 56 · read-only view</p>
            </div>
          </div>
        </header>

        <div className="mx-5 mt-4 space-y-4">
          <div className="bg-[#111] rounded-xl p-5 border border-[#222]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[10px] font-black text-white tracking-widest uppercase">Integration Ladder</h3>
              <span className="text-[10px] font-mono text-gray-500">
                {snapshot ? `chain ${snapshot.chainId} · ${snapshot.generatedAt}` : 'loading…'}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              {LADDER_ORDER.map((s, i) => (
                <div key={s} className="p-2 rounded-lg bg-[#1A1A1A] border border-[#333]">
                  <div className={`text-[9px] font-black tracking-wider uppercase ${LADDER_STYLES[s].split(' ')[1]}`}>
                    {i + 1}. {s.replace('_', ' ')}
                  </div>
                  <div className="text-[9px] text-gray-500 mt-1">
                    {s === 'DISCOVERY_ONLY' ? 'recognized candidate' : s === 'READ_ONLY' ? 'verified reads' : s === 'SIMULATION' ? 'sim + preflight' : 'autonomous exec'}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[10px] text-gray-500">
              verified ≠ enabled (mustflow §12). This view is derived from the fail-closed registries and grants no authority.
            </p>
          </div>

          {fetchError && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">{fetchError}</div>
          )}

          {loadingSnapshot && !snapshot ? (
            <div className="text-center py-10 text-gray-500 text-xs">Loading registry…</div>
          ) : (
            <>
              <div className="bg-[#111] rounded-xl p-5 border border-[#222]">
                <h3 className="text-[10px] font-black text-white tracking-widest uppercase mb-3">Supported Tokens</h3>
                <div className="space-y-2">
                  {snapshot?.tokens.map((t) => (
                    <div key={t.id} className="flex items-center justify-between p-3 bg-[#1A1A1A] rounded-lg border border-[#333]">
                      <div>
                        <div className="text-sm font-black text-white">
                          {t.symbol}
                          {t.native && <span className="ml-2 text-[9px] text-[#F0B90B] font-black uppercase">native</span>}
                        </div>
                        <div className="text-[10px] text-gray-500 capitalize">{t.name}</div>
                        <div className="text-[10px] font-mono text-gray-600 break-all">{t.address}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {t.verified && <StatusBadge value="READ_ONLY" />}
                        <span className={`text-[9px] font-black uppercase ${t.enabled ? 'text-emerald-400' : 'text-gray-500'}`}>
                          {t.enabled ? 'enabled' : 'not enabled'}
                        </span>
                      </div>
                    </div>
                  ))}
                  {!snapshot?.tokens.length && <div className="text-center py-4 text-gray-500 text-xs">No tokens registered.</div>}
                </div>
              </div>

              <div className="bg-[#111] rounded-xl p-5 border border-[#222]">
                <h3 className="text-[10px] font-black text-white tracking-widest uppercase mb-3">Protocols</h3>
                <div className="space-y-3">
                  {snapshot?.protocols.map((p) => (
                    <div key={p.id} className="bg-[#1A1A1A] rounded-lg border border-[#333]">
                      <div className="flex items-center justify-between p-3 border-b border-[#222]">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-black text-white">{p.name}</span>
                          {p.priority && (
                            <span className={`px-1.5 py-0.5 rounded border text-[9px] font-black ${PRIORITY_STYLES[p.priority] ?? ''}`}>
                              {p.priority}
                            </span>
                          )}
                          {p.status !== 'ACTIVE' && (
                            <span className="px-1.5 py-0.5 rounded border text-[9px] font-black bg-gray-500/10 text-gray-400 border-gray-500/20 uppercase">
                              {p.status.replace('_', ' ')}
                            </span>
                          )}
                        </div>
                        <StatusBadge value={p.integrationStatus} />
                      </div>
                      <div className="px-3 py-2 text-[10px] text-gray-500">{p.reason}</div>
                      {p.contracts.length > 0 && (
                        <div className="px-3 pb-3 space-y-2">
                          {p.contracts.map((c) => (
                            <div key={c.id} className="bg-black rounded-lg border border-[#222] p-3">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-black text-white">{c.name}</span>
                                <StatusBadge value={c.integrationStatus} />
                              </div>
                              <div className="flex flex-wrap gap-1.5 mb-2">
                                {c.capabilities.map((cap) => (
                                  <span key={cap} className={`px-1.5 py-0.5 rounded text-[9px] font-black ${CAP_STYLE}`}>{cap}</span>
                                ))}
                              </div>
                              <div className="text-[10px] font-mono text-gray-500 break-all">{c.address}</div>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {c.functions.map((f) => (
                                  <span
                                    key={f.name}
                                    className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${
                                      f.capability === 'EXECUTE'
                                        ? 'bg-[#F0B90B]/10 text-[#F0B90B] border border-[#F0B90B]/30'
                                        : 'bg-[#1A1A1A] text-gray-400 border border-[#333]'
                                    }`}
                                  >
                                    {f.name} · {f.capability}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {!snapshot?.protocols.length && <div className="text-center py-4 text-gray-500 text-xs">No protocols registered.</div>}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <MobileBottomNav />
    </div>
  );
}