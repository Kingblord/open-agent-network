'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useWallet } from '@/lib/wallet-context';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';
import { ThemeToggle } from '@/components/theme-toggle';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/toast-provider';
import { LoadingButton } from '@/components/ui/loading-button';

interface ProfileAgent {
  id: string;
  name: string;
  status: string;
  strategyId?: string;
  walletAddress?: string;
  description?: string;
}

export default function ProfilePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [mounted, setMounted] = useState(false);
  const [agentCount, setAgentCount] = useState<number | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [serverWallet, setServerWallet] = useState<string | null>(null);

  // Manage Agents â€” owned deployed agents (not the canonical template pool).
  const [myAgents, setMyAgents] = useState<ProfileAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentDeleteOpen, setAgentDeleteOpen] = useState<ProfileAgent | null>(null);
  const [agentDeleting, setAgentDeleting] = useState(false);

  const {
    activeAddress,
    linkedAddress,
    hydrating,
  } = useWallet();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !loading && !user) {
      router.push('/login');
    }
  }, [mounted, user, loading, router]);

  async function loadMyAgents() {
    if (!user) return;
    try {
      setAgentsLoading(true);
      const res = await fetch(`/api/agents?ownerId=${encodeURIComponent(user.id)}`);
      if (res.ok) {
        const data = await res.json();
        const list: ProfileAgent[] = data.agents || [];
        setMyAgents(list);
        setAgentCount(list.length);
      }
    } catch (err) {
      console.error('Failed to load managed agents:', err);
    } finally {
      setAgentsLoading(false);
    }
  }

  useEffect(() => {
    if (user) {
      loadMyAgents();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void fetch('/api/developers/wallet', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.walletAddress) setServerWallet(data.walletAddress);
      })
      .catch(() => {
        // Non-fatal â€” fall back to active/linked address below.
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // still fetch credits for the stats row even though Manage Agents owns the count
  useEffect(() => {
    async function loadCredits() {
      if (!user) return;
      try {
        const credRes = await fetch('/api/developers/credits');
        if (credRes.ok) {
          const c = await credRes.json();
          setCredits(c.balance);
        }
      } catch (err) {
        console.error('Failed to load credits:', err);
      }
    }
    loadCredits();
  }, [user]);

  const handleDeleteAgent = async () => {
    if (!agentDeleteOpen) return;
    setAgentDeleting(true);
    try {
      const res = await fetch(`/api/agents/${agentDeleteOpen.id}/delete`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        toast.success({
          title: 'Agent deleted',
          description: `"${agentDeleteOpen.name}" was removed from your profile.`,
        });
        setMyAgents((prev) => prev.filter((a) => a.id !== agentDeleteOpen.id));
      } else {
        toast.error({
          title: 'Delete failed',
          description: data?.error || 'Unable to delete this agent.',
        });
      }
    } catch (err) {
      console.error('Delete agent error:', err);
      toast.error({ title: 'Delete failed', description: 'An unexpected error occurred.' });
    } finally {
      setAgentDeleting(false);
      setAgentDeleteOpen(null);
    }
  };

  const memberSince = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }).toUpperCase()
    : 'â€”';

  const walletAddress = activeAddress ?? user?.walletAddress ?? linkedAddress ?? serverWallet ?? null;
  const walletConnected = Boolean(walletAddress);

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen dark:bg-background dark:text-foreground bg-white text-black">
        <div className="text-center">
          <div className="inline-block animate-spin mb-4">
            <div className="h-8 w-8 border-4 border-[#F0B90B] border-t-transparent rounded-full" />
          </div>
          <p className="text-[#F0B90B] font-mono text-xs uppercase tracking-widest">Loading profile...</p>
        </div>
      </div>
    );
  }

  const displayName = user.name || user.email?.split('@')[0] || 'BAN User';

  return (
    <div className="min-h-screen dark:bg-background dark:text-foreground bg-white text-black font-sans antialiased transition-colors duration-200">
      <div className="pb-20">
        {/* Header with Title, ThemeToggle, and Settings */}
        <header className="dark:bg-background bg-white px-5 pt-6 pb-4 flex items-center justify-between border-b dark:border-[#1A1A1A] border-gray-200">
          <h2 className="text-[22px] font-black text-[#F0B90B] tracking-wide">PROFILE</h2>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <button
              onClick={() => router.push('/settings')}
              className="w-10 h-10 rounded-lg dark:bg-card bg-gray-50 border dark:border-border border-gray-300 flex items-center justify-center text-[#F0B90B] hover:border-[#F0B90B] transition"
              aria-label="Settings"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>
        </header>

        <div className="mx-5 mt-4 bg-[#F0B90B] rounded-xl p-5">
          <div className="flex items-center gap-4 mb-5">
            <div className="w-16 h-16 rounded-full bg-background flex items-center justify-center border-2 border-black">
              <span className="text-[#F0B90B] text-xl font-black">
                {displayName.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-black text-black truncate">{displayName}</h3>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 3h5v5L8 21l-5-5z" />
                </svg>
              </div>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-[10px] font-mono text-black/70 truncate">
                  {user.id ? `${user.id.slice(0, 6)}...${user.id.slice(-4)}` : ''}
                </span>
                <span className="bg-background text-[#F0B90B] text-[8px] font-black px-1.5 py-0.5 uppercase">Verified</span>
              </div>
            </div>
          </div>
          <div className="flex justify-between">
            {[
              { label: 'AGENTS', value: agentCount != null ? `${agentCount}` : 'â€”' },
              { label: 'CREDITS', value: credits != null ? `${credits}` : 'â€”' },
              { label: 'MEMBER SINCE', value: memberSince },
            ].map((stat) => (
              <div key={stat.label} className="text-center flex-1">
                <p className="text-[18px] font-black text-black">{stat.value}</p>
                <p className="text-[8px] font-black text-black/60 tracking-wider uppercase">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mx-5 mt-4 dark:bg-card bg-gray-50 rounded-xl p-5 border dark:border-border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[10px] font-black dark:text-foreground text-black tracking-widest uppercase">Wallet</h3>
            {walletConnected ? (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-black text-green-600 dark:text-green-400 uppercase tracking-wider">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                Connected
              </span>
            ) : (
              !hydrating && (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-black text-muted-foreground dark:text-muted-foreground uppercase tracking-wider">
                  <span className="w-2 h-2 rounded-full bg-gray-400 inline-block" />
                  Not connected
                </span>
              )
            )}
          </div>
          {walletConnected ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs dark:text-muted-foreground text-muted-foreground">Address</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono dark:text-foreground text-black">
                    {walletAddress ? `${walletAddress.slice(0, 10)}...${walletAddress.slice(-6)}` : ''}
                  </span>
                  <button
                    onClick={() => walletAddress && navigator.clipboard.writeText(walletAddress)}
                    className="text-[#F0B90B] hover:text-black transition"
                    aria-label="Copy wallet address"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs dark:text-muted-foreground text-muted-foreground">Network</span>
                <span className="dark:bg-[#1A1A1A] bg-white text-[10px] text-[#F0B90B] font-black px-2.5 py-1 border dark:border-border border-gray-300 uppercase tracking-wider">
                  BNB Chain
                </span>
              </div>
              <button
                onClick={() => walletAddress && window.open(`https://bscscan.com/address/${walletAddress}`, '_blank')}
                className="w-full mt-2 text-[10px] font-black text-[#F0B90B] tracking-wider uppercase flex items-center justify-center gap-1 py-2 border dark:border-border border-gray-300 rounded-lg hover:border-[#F0B90B] transition"
              >
                View on BscScan
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F0B90B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 17L17 7" />
                  <path d="M7 7h10v10" />
                </svg>
              </button>
            </div>
          ) : (
            <button
              onClick={() => router.push('/settings')}
              className="w-full flex items-center justify-center gap-2 py-3 text-xs font-black text-[#F0B90B] border dark:border-border border-gray-300 rounded-lg hover:border-[#F0B90B] transition"
            >
              Connect wallet
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
                <path d="M12 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>

        {/* MANAGE AGENTS â€” list owned deployed agents with delete */}
        <div className="mx-5 mt-4 dark:bg-card bg-gray-50 rounded-xl p-5 border dark:border-border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[10px] font-black dark:text-foreground text-black tracking-widest uppercase">Manage Agents</h3>
            <button
              onClick={() => router.push('/my-agents')}
              className="text-[10px] font-black text-[#F0B90B] tracking-wider uppercase flex items-center gap-1"
            >
              View all
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F0B90B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
                <path d="M12 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {agentsLoading ? (
            <p className="text-xs dark:text-muted-foreground text-muted-foreground">Loading deployed agents...</p>
          ) : myAgents.length === 0 ? (
            <p className="text-xs dark:text-muted-foreground text-muted-foreground">
              No deployed agents yet.{' '}
              <button
                onClick={() => router.push('/agents')}
                className="text-[#F0B90B] font-black uppercase"
              >
                Browse marketplace â†’
              </button>
            </p>
          ) : (
            <div className="space-y-2">
              {myAgents.slice(0, 5).map((agent) => (
                <div key={agent.id} className="flex items-center gap-3 dark:bg-background/40 bg-white border dark:border-border border-gray-200 rounded-lg p-3">
                  <button
                    onClick={() => router.push(`/my-agents/${agent.id}`)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-black dark:text-foreground text-black truncate">{agent.name}</p>
                      <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded border ${
                        agent.status === 'ACTIVE'
                          ? 'text-green-600 dark:text-green-400 border-green-500/40 bg-green-500/10'
                          : 'text-muted-foreground border-gray-400/40 bg-gray-500/10'
                      }`}>
                        {agent.status}
                      </span>
                    </div>
                    <p className="text-[10px] font-mono text-muted-foreground mt-0.5 truncate">
                      {agent.id}
                    </p>
                  </button>
                  <button
                    onClick={() => setAgentDeleteOpen(agent)}
                    aria-label={`Delete agent ${agent.name}`}
                    className="shrink-0 w-9 h-9 rounded-lg dark:bg-[#1A1A1A] bg-gray-100 border dark:border-border border-gray-300 flex items-center justify-center text-red-400 hover:border-red-500/50 transition"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mx-5 mt-4 dark:bg-card bg-gray-50 rounded-xl p-5 border dark:border-border border-gray-200">
          <h3 className="text-[10px] font-black dark:text-foreground text-black tracking-widest uppercase mb-4">Quick Links</h3>
          <div className="space-y-2">
            {[
              { label: 'Transaction History', path: '/history' },
              { label: 'My Agents', path: '/my-agents' },
              { label: 'Agent Marketplace', path: '/agents' },
              { label: 'Settings', path: '/settings' },
            ].map((link) => (
              <button
                key={link.label}
                onClick={() => router.push(link.path)}
                className="w-full flex items-center justify-between py-3 border-b dark:border-border border-gray-200 last:border-b-0 dark:text-gray-300 text-gray-600 hover:text-[#F0B90B] transition"
              >
                <span className="text-sm">{link.label}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14" />
                  <path d="M12 5l7 7-7 7" />
                </svg>
              </button>
            ))}
          </div>
        </div>

        <div className="mx-5 mt-4 mb-6">
          <button
            onClick={async () => {
              const { signOut } = await import('firebase/auth');
              const { auth } = await import('@/lib/firebase');
              if (auth) await signOut(auth);
              window.location.href = '/login';
            }}
            className="w-full bg-red-400/10 border border-red-400/30 py-4 flex items-center justify-center gap-2 text-sm font-black text-red-400 rounded-xl hover:bg-red-400/20 transition"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Log out
          </button>
        </div>
      </div>

      {/* Delete agent confirmation */}
      <ConfirmDialog
        open={agentDeleteOpen !== null}
        title="Delete agent?"
        description={
          agentDeleteOpen
            ? `"${agentDeleteOpen.name}" will be revoked and permanently removed from your profile. Its dedicated signing key will be destroyed â€” this cannot be undone.`
            : undefined
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        dangerous
        loading={agentDeleting}
        onConfirm={handleDeleteAgent}
        onCancel={() => setAgentDeleteOpen(null)}
      />

      <MobileBottomNav />
    </div>
  );
}