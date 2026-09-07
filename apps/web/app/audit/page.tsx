'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';
import { ThemeToggle } from '@/components/theme-toggle';

interface AuditEvent {
  id: string;
  eventType: string;
  severity: string;
  agentId: string;
  agentName: string;
  correlationId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

const EVENT_TYPE_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  AGENT_ACTIVATED: { label: 'Activated', color: 'text-emerald-400', icon: '🟢' },
  AGENT_PAUSED: { label: 'Paused', color: 'text-amber-400', icon: '⏸️' },
  AGENT_REVOKED: { label: 'Revoked', color: 'text-red-400', icon: '🔴' },
  OBSERVATION_CREATED: { label: 'Observed', color: 'text-sky-400', icon: '👁️' },
  AI_DECISION_CREATED: { label: 'AI Decided', color: 'text-violet-400', icon: '🧠' },
  ACTION_PROPOSED: { label: 'Proposed', color: 'text-blue-400', icon: '📋' },
  ACTION_DENIED: { label: 'Denied', color: 'text-red-400', icon: '🚫' },
  ACTION_APPROVED: { label: 'Approved', color: 'text-emerald-400', icon: '✅' },
  EXECUTION_QUEUED: { label: 'Queued', color: 'text-cyan-400', icon: '⏳' },
  TRANSACTION_SUBMITTED: { label: 'Submitted', color: 'text-sky-400', icon: '📤' },
  TRANSACTION_CONFIRMED: { label: 'Confirmed', color: 'text-emerald-400', icon: '✅' },
  TRANSACTION_FAILED: { label: 'Failed', color: 'text-red-400', icon: '❌' },
  POSITION_UPDATED: { label: 'Position Updated', color: 'text-amber-400', icon: '📊' },
  AGENT_OBSERVED: { label: 'Observed', color: 'text-sky-400', icon: '👁️' },
  AGENT_PROPOSED: { label: 'Proposed', color: 'text-blue-400', icon: '📋' },
  AGENT_POLICY_DENIED: { label: 'Policy Denied', color: 'text-red-400', icon: '🚫' },
  AGENT_EXECUTED: { label: 'Executed', color: 'text-emerald-400', icon: '⚡' },
  AGENT_EXECUTION_PENDING: { label: 'Awaiting Execution', color: 'text-amber-400', icon: '⏳' },
  AGENT_CYCLE_ERROR: { label: 'Cycle Error', color: 'text-red-400', icon: '💥' },
  AGENT_THINKING: { label: 'Thinking', color: 'text-violet-400', icon: '🧠' },
  PERMISSION_CREATED: { label: 'Permission Created', color: 'text-cyan-400', icon: '🔑' },
  PERMISSION_ACTIVATED: { label: 'Permission Activated', color: 'text-emerald-400', icon: '🔓' },
  PERMISSION_REVOKED: { label: 'Permission Revoked', color: 'text-red-400', icon: '🔒' },
};

const SEVERITY_COLORS: Record<string, string> = {
  INFO: 'bg-sky-500/10 border-sky-500/30',
  WARN: 'bg-amber-500/10 border-amber-500/30',
  WARNING: 'bg-amber-500/10 border-amber-500/30',
  ERROR: 'bg-red-500/10 border-red-500/30',
  CRITICAL: 'bg-red-500/20 border-red-500/50',
};

const ALL_EVENT_TYPES = Object.keys(EVENT_TYPE_LABELS);

export default function AuditTrailPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (mounted && !loading && !user) router.push('/login');
  }, [mounted, user, loading, router]);

  const loadEvents = useCallback(async (startAfter?: string) => {
    if (!user) return;
    setDataLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (startAfter) params.set('startAfter', startAfter);
      if (selectedType !== 'ALL') params.set('type', selectedType);

      const res = await fetch(`/api/audit?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (startAfter) {
          setEvents((prev) => [...prev, ...(data.events || [])]);
        } else {
          setEvents(data.events || []);
        }
        setHasMore(data.hasMore || false);
      }
    } catch (err) {
      console.error('Failed to load audit events:', err);
    } finally {
      setDataLoading(false);
    }
  }, [user, selectedType]);

  useEffect(() => {
    if (mounted && user) loadEvents();
  }, [mounted, user, loadEvents]);

  // REALTIME: keep the audit trail live with a light poll (pagination-safe:
  // the interval always reloads the first page; explicit "load more" is manual). 60s cadence: single userId-scoped query pair.
  useEffect(() => {
    if (!mounted || !user) return;
    const t = setInterval(() => { loadEvents(); }, 60000);
    return () => clearInterval(t);
  }, [mounted, user, loadEvents]);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString();
  };

  const formatFullTime = (iso: string) => {
    return new Date(iso).toLocaleString();
  };

  const getEventInfo = (eventType: string) => {
    return EVENT_TYPE_LABELS[eventType] || { label: eventType, color: 'text-zinc-400', icon: '❓' };
  };

  const formatPayloadValue = (key: string, value: unknown): string => {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  };

  if (!mounted || loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-400">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-xl">
        <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Audit Trail</h1>
            <p className="text-sm text-zinc-500">Complete agent activity log — M14</p>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link href="/dashboard" className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {/* Filters */}
        <div className="mb-6 flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedType('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              selectedType === 'ALL'
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            All Events
          </button>
          {ALL_EVENT_TYPES.map((type) => {
            const info = getEventInfo(type);
            return (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  selectedType === type
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                {info.icon} {info.label}
              </button>
            );
          })}
        </div>

        {/* Event Count */}
        <div className="mb-4 text-sm text-zinc-500">
          {events.length} event{events.length !== 1 ? 's' : ''} loaded
        </div>

        {/* Timeline */}
        {dataLoading && events.length === 0 ? (
          <div className="text-center py-12 text-zinc-500">Loading audit events…</div>
        ) : events.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">📋</div>
            <div className="text-zinc-400 font-medium">No audit events yet</div>
            <div className="text-sm text-zinc-600 mt-1">
              Events will appear here when agents observe, decide, and execute.
            </div>
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-5 top-0 bottom-0 w-px bg-zinc-800" />

            <div className="space-y-1">
              {events.map((event) => {
                const info = getEventInfo(event.eventType);
                const isExpanded = expandedEvent === event.id;
                const severityStyle = SEVERITY_COLORS[event.severity] || SEVERITY_COLORS.INFO;

                return (
                  <div key={event.id} className="relative pl-12">
                    {/* Timeline dot */}
                    <div className="absolute left-3.5 top-4 w-3 h-3 rounded-full bg-zinc-800 border-2 border-zinc-600 z-10" />

                    <div
                      className={`rounded-lg border p-3 cursor-pointer transition-all ${severityStyle} ${
                        isExpanded ? 'ring-1 ring-blue-500/30' : 'hover:bg-zinc-800/30'
                      }`}
                      onClick={() => setExpandedEvent(isExpanded ? null : event.id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-base">{info.icon}</span>
                            <span className={`text-sm font-medium ${info.color}`}>
                              {info.label}
                            </span>
                            <span className="text-xs text-zinc-600">•</span>
                            <Link
                              href={`/my-agents/${event.agentId}`}
                              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors truncate"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {event.agentName}
                            </Link>
                          </div>
                          <div className="text-xs text-zinc-600">
                            {formatTime(event.createdAt)}
                            {event.correlationId && (
                              <span className="ml-2 font-mono text-zinc-700">
                                corr:{event.correlationId.slice(0, 8)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-zinc-600 shrink-0">
                          {isExpanded ? '▾' : '▸'}
                        </div>
                      </div>

                      {/* Expanded details */}
                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-zinc-800/50">
                          <div className="text-xs text-zinc-500 mb-2">
                            {formatFullTime(event.createdAt)}
                          </div>
                          {event.correlationId && (
                            <div className="text-xs text-zinc-600 mb-2 font-mono">
                              Correlation ID: {event.correlationId}
                            </div>
                          )}
                          {Object.keys(event.payload).length > 0 && (
                            <div className="space-y-1">
                              {Object.entries(event.payload).map(([key, value]) => (
                                <div key={key} className="flex gap-2 text-xs">
                                  <span className="text-zinc-500 font-mono shrink-0 w-32 truncate">{key}</span>
                                  <span className="text-zinc-300 font-mono break-all">
                                    {formatPayloadValue(key, value)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Load More */}
        {hasMore && (
          <div className="mt-6 text-center">
            <button
              onClick={() => loadEvents(events[events.length - 1]?.id)}
              className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 text-sm transition-colors"
            >
              Load More
            </button>
          </div>
        )}
      </main>

      <MobileBottomNav />
    </div>
  );
}
