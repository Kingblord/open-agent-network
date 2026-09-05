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

interface Notification {
  id: string;
  type: 'agent' | 'transaction' | 'alert' | 'system';
  title: string;
  description: string;
  timestamp: string;
  read: boolean;
  priority?: 'high' | 'medium' | 'low';
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  agent: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="8" width="16" height="12" rx="2" /><circle cx="9" cy="13" r="1.5" fill="black" /><circle cx="15" cy="13" r="1.5" fill="black" /><path d="M10 17h4" /><line x1="12" y1="4" x2="12" y2="8" />
    </svg>
  ),
  transaction: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17L17 7" /><path d="M7 7h10v10" />
    </svg>
  ),
  alert: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  system: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
};

function summarizePayload(payload: Record<string, unknown>): string {
  const entries = Object.entries(payload);
  if (entries.length === 0) return 'Agent event recorded.';
  return entries.slice(0, 3).map(([k, v]) => `${k}: ${String(v)}`).join(' · ');
}

function eventToNotification(event: ActivityEvent): Notification {
  const t = event.eventType;
  if (t.startsWith('TRANSACTION_')) {
    const title = t === 'TRANSACTION_CONFIRMED'
      ? 'Transaction confirmed'
      : t === 'TRANSACTION_FAILED' ? 'Transaction failed' : 'Transaction submitted';
    const priority: 'high' | 'medium' | 'low' =
      t === 'TRANSACTION_FAILED' ? 'high' : t === 'TRANSACTION_CONFIRMED' ? 'low' : 'medium';
    return {
      id: event.id,
      type: 'transaction',
      title,
      description: summarizePayload(event.payload),
      timestamp: event.createdAt,
      read: false,
      priority,
    };
  }
  if (t.includes('FAILED') || t.includes('DENIED')) {
    return {
      id: event.id,
      type: 'alert',
      title: t.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
      description: summarizePayload(event.payload),
      timestamp: event.createdAt,
      read: false,
      priority: 'high',
    };
  }
  return {
    id: event.id,
    type: 'agent',
    title: t.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
    description: summarizePayload(event.payload),
    timestamp: event.createdAt,
    read: false,
    priority: 'medium',
  };
}

export default function NotificationsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function loadFeed() {
      if (!user) return;
      setLoadingFeed(true);
      try {
        const res = await fetch(`/api/agents?ownerId=${encodeURIComponent(user.id)}`);
        if (!res.ok) {
          setNotifications([]);
          return;
        }
        const data = await res.json();
        const mine = data.agents || [];

        const events: ActivityEvent[] = [];
        for (const agent of mine.slice(0, 8)) {
          try {
            const r = await fetch(`/api/agents/${agent.id}/activity?limit=20`);
            if (r.ok) {
              const d = await r.json();
              events.push(...(d.events || []));
            }
          } catch {
            // ignore per-agent failures
          }
        }
        events.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const meaningful = events
          .filter((e) => !['AGENT_ACTIVATED', 'AGENT_CREATED'].includes(e.eventType))
          .slice(0, 30);
        setNotifications(meaningful.map(eventToNotification));
      } catch (err) {
        console.error('Failed to load notifications:', err);
        setNotifications([]);
      } finally {
        setLoadingFeed(false);
      }
    }
    loadFeed();
  }, [user]);

  // Reset local read state whenever the feed changes.
  useEffect(() => {
    setReadIds(new Set());
  }, [notifications]);

  const visible = notifications.map((n) => ({ ...n, read: readIds.has(n.id) || n.read }));
  const unreadCount = visible.filter((n) => !n.read).length;

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const markAllRead = () => {
    setReadIds((prev) => {
      const next = new Set(prev);
      notifications.forEach((n) => next.add(n.id));
      return next;
    });
  };

  const groupByDate = (list: Notification[]) => {
    const groups: Record<string, Notification[]> = {};
    list.forEach((n) => {
      const date = new Date(n.timestamp);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      let key: string;
      if (date.toDateString() === today.toDateString()) {
        key = 'TODAY';
      } else if (date.toDateString() === yesterday.toDateString()) {
        key = 'YESTERDAY';
      } else {
        key = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(n);
    });
    return groups;
  };

  const grouped = groupByDate(visible);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased pb-24">
      <header className="bg-background px-5 pt-6 pb-4 flex items-center justify-between border-b border-border">
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
            <h1 className="text-[22px] font-black text-[#F0B90B] tracking-wide">NOTIFICATIONS</h1>
            <p className="text-[10px] text-muted-foreground font-mono">{unreadCount} unread</p>
          </div>
        </div>
        <button
          onClick={markAllRead}
          className="text-[10px] font-bold text-[#F0B90B] tracking-wider uppercase"
        >
          Mark all read
        </button>
      </header>

      <div className="px-5 py-4 space-y-6">
        {loadingFeed ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            <div className="inline-block w-6 h-6 border-2 border-[#F0B90B] border-t-transparent rounded-full animate-spin mb-2" />
            Loading agent activity...
          </div>
        ) : Object.entries(grouped).length === 0 ? (
          <div className="text-center py-12 bg-card border border-border rounded-2xl p-6">
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-[#F0B90B] flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="8" width="16" height="12" rx="2" /><circle cx="9" cy="13" r="1.5" fill="black" /><circle cx="15" cy="13" r="1.5" fill="black" />
              </svg>
            </div>
            <div className="text-foreground font-bold text-base mb-1">No notifications yet</div>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto">
              Agent activity, transactions, and alerts will appear here once BAN records events for your agents.
            </p>
          </div>
        ) : (
          Object.entries(grouped).map(([date, list]) => (
            <div key={date}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[10px] font-black text-muted-foreground tracking-widest uppercase">{date}</h2>
                <div className="h-px bg-[#222] flex-1 ml-3" />
              </div>
              <div className="space-y-2">
                {list.map((notification) => (
                  <div
                    key={notification.id}
                    className={`bg-card border rounded-xl p-4 transition-all ${
                      notification.read ? 'border-border' : 'border-[#F0B90B]/30 bg-[#F0B90B]/5'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                        notification.read ? 'bg-[#1A1A1A]' : 'bg-[#F0B90B]'
                      }`}>
                        {TYPE_ICONS[notification.type]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className={`text-sm font-bold ${notification.read ? 'text-foreground' : 'text-[#F0B90B]'}`}>
                              {notification.title}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">{notification.description}</p>
                          </div>
                          {!notification.read && (
                            <span className="w-2 h-2 rounded-full bg-[#F0B90B] shrink-0 mt-1" />
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-[10px] text-muted-foreground">{timeAgo(notification.timestamp)}</span>
                          {notification.priority === 'high' && (
                            <span className="text-[9px] font-bold text-red-400 uppercase bg-red-400/10 px-1.5 py-0.5 rounded">
                              High
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <MobileBottomNav />
    </div>
  );
}