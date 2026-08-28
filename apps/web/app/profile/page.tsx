'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';
import { ThemeToggle } from '@/components/theme-toggle';

export default function ProfilePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [agentCount, setAgentCount] = useState<number | null>(null);
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !loading && !user) {
      router.push('/login');
    }
  }, [mounted, user, loading, router]);

  useEffect(() => {
    async function loadStats() {
      if (!user) return;
      try {
        const [credRes, agentRes] = await Promise.all([
          fetch('/api/developers/credits'),
          fetch(`/api/agents?ownerId=${encodeURIComponent(user.id)}`),
        ]);
        if (credRes.ok) {
          const c = await credRes.json();
          setCredits(c.balance);
        }
        if (agentRes.ok) {
          const a = await agentRes.json();
          setAgentCount((a.agents || []).length);
        }
      } catch (err) {
        console.error('Failed to load profile stats:', err);
      }
    }
    loadStats();
  }, [user]);

  const memberSince = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }).toUpperCase()
    : '—';

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen dark:bg-black dark:text-white bg-white text-black">
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
    <div className="min-h-screen dark:bg-black dark:text-white bg-white text-black font-sans antialiased transition-colors duration-200">
      <div className="pb-20">
        {/* Header with Title, ThemeToggle, and Settings */}
        <header className="dark:bg-black bg-white px-5 pt-6 pb-4 flex items-center justify-between border-b dark:border-[#1A1A1A] border-gray-200">
          <h2 className="text-[22px] font-black text-[#F0B90B] tracking-wide">PROFILE</h2>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <button
              onClick={() => router.push('/settings')}
              className="w-10 h-10 rounded-lg dark:bg-[#111] bg-gray-50 border dark:border-[#222] border-gray-300 flex items-center justify-center text-[#F0B90B] hover:border-[#F0B90B] transition"
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
            <div className="w-16 h-16 rounded-full bg-black flex items-center justify-center border-2 border-black">
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
                <span className="bg-black text-[#F0B90B] text-[8px] font-black px-1.5 py-0.5 uppercase">Verified</span>
              </div>
            </div>
          </div>
          <div className="flex justify-between">
            {[
              { label: 'AGENTS', value: agentCount != null ? `${agentCount}` : '—' },
              { label: 'CREDITS', value: credits != null ? `${credits}` : '—' },
              { label: 'MEMBER SINCE', value: memberSince },
            ].map((stat) => (
              <div key={stat.label} className="text-center flex-1">
                <p className="text-[18px] font-black text-black">{stat.value}</p>
                <p className="text-[8px] font-black text-black/60 tracking-wider uppercase">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mx-5 mt-4 dark:bg-[#111] bg-gray-50 rounded-xl p-5 border dark:border-[#222] border-gray-200">
          <h3 className="text-[10px] font-black dark:text-white text-black tracking-widest uppercase mb-4">Wallet</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs dark:text-gray-400 text-gray-500">Address</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono dark:text-white text-black">
                  {user.id ? `${user.id.slice(0, 10)}...${user.id.slice(-6)}` : ''}
                </span>
                <button
                  onClick={() => navigator.clipboard.writeText(user.id || '')}
                  className="text-[#F0B90B] hover:text-black transition"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs dark:text-gray-400 text-gray-500">Network</span>
              <span className="dark:bg-[#1A1A1A] bg-white text-[10px] text-[#F0B90B] font-black px-2.5 py-1 border dark:border-[#333] border-gray-300 uppercase tracking-wider">
                BNB Chain
              </span>
            </div>
            <button
              onClick={() => window.open(`https://bscscan.com/address/${user.id || ''}`, '_blank')}
              className="w-full mt-2 text-[10px] font-black text-[#F0B90B] tracking-wider uppercase flex items-center justify-center gap-1 py-2 border dark:border-[#333] border-gray-300 rounded-lg hover:border-[#F0B90B] transition"
            >
              View on BscScan
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F0B90B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17L17 7" />
                <path d="M7 7h10v10" />
              </svg>
            </button>
          </div>
        </div>

        <div className="mx-5 mt-4 dark:bg-[#111] bg-gray-50 rounded-xl p-5 border dark:border-[#222] border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[10px] font-black dark:text-white text-black tracking-widest uppercase">Your Agents</h3>
            <button
              onClick={() => router.push('/my-agents')}
              className="text-[10px] font-black text-[#F0B90B] tracking-wider uppercase flex items-center gap-1"
            >
              Manage all
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F0B90B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
                <path d="M12 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          <p className="text-xs dark:text-gray-400 text-gray-500">
            {agentCount != null
              ? `You have ${agentCount} agent${agentCount === 1 ? '' : 's'} registered on BAN.`
              : 'Loading agent count...'}
          </p>
        </div>

        <div className="mx-5 mt-4 dark:bg-[#111] bg-gray-50 rounded-xl p-5 border dark:border-[#222] border-gray-200">
          <h3 className="text-[10px] font-black dark:text-white text-black tracking-widest uppercase mb-4">Quick Links</h3>
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
                className="w-full flex items-center justify-between py-3 border-b dark:border-[#222] border-gray-200 last:border-b-0 dark:text-gray-300 text-gray-600 hover:text-[#F0B90B] transition"
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

      <MobileBottomNav />
    </div>
  );
}