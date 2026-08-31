'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * LiveRuntimeTerminal — real-time review terminal for a BAN agent.
 *
 * Rendered from the My Agent detail page Analytics view. Polls the agent's
 * activity feed (GET /api/agents/:id/activity) every 5 seconds while mounted
 * and streams the closed loop as an animated, monospace terminal:
 *
 *   OBSERVING -> THINKING -> PROPOSING -> POLICY -> AWAITING / CONFIRMED
 *
 * Everything shown comes from real persisted audit events (run-cycle writes
 * them). No fabricated states. Auto-scroll keeps the newest line in view.
 */

interface TerminalEvent {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface LiveRuntimeTerminalProps {
  agentId: string;
  initialEvents?: TerminalEvent[];
}

interface StageStyle {
  label: string;
  color: string;
  dot: string;
}

const STAGE_STYLE: Record<string, StageStyle> = {
  AGENT_OBSERVED: { label: 'OBSERVING', color: 'text-sky-400', dot: 'bg-sky-400' },
  AI_DECISION_CREATED: { label: 'THINKING', color: 'text-amber-300', dot: 'bg-amber-300' },
  AGENT_PASSED: { label: 'THINKING → PASS', color: 'text-amber-300', dot: 'bg-amber-300' },
  AGENT_PROPOSED: { label: 'PROPOSING', color: 'text-[#F0B90B]', dot: 'bg-[#F0B90B]' },
  ACTION_PROPOSED: { label: 'PROPOSING', color: 'text-[#F0B90B]', dot: 'bg-[#F0B90B]' },
  ACTION_APPROVED: { label: 'POLICY APPROVED', color: 'text-emerald-400', dot: 'bg-emerald-400' },
  ACTION_DENIED: { label: 'POLICY DENIED', color: 'text-red-400', dot: 'bg-red-400' },
  AGENT_POLICY_DENIED: { label: 'POLICY DENIED', color: 'text-red-400', dot: 'bg-red-400' },
  AGENT_EXECUTION_PENDING: { label: 'AWAITING', color: 'text-gray-400', dot: 'bg-gray-400' },
  EXECUTION_QUEUED: { label: 'QUEUED', color: 'text-gray-400', dot: 'bg-gray-400' },
  TRANSACTION_SUBMITTED: { label: 'SUBMITTED', color: 'text-sky-400', dot: 'bg-sky-400' },
  TRANSACTION_CONFIRMED: { label: 'CONFIRMED ON-CHAIN', color: 'text-emerald-400', dot: 'bg-emerald-400' },
  TRANSACTION_FAILED: { label: 'TX FAILED', color: 'text-red-400', dot: 'bg-red-400' },
  POSITION_UPDATED: { label: 'POSITION', color: 'text-violet-400', dot: 'bg-violet-400' },
  AGENT_TICK: { label: 'HEARTBEAT', color: 'text-gray-500', dot: 'bg-gray-500' },
  AGENT_ACTIVATED: { label: 'ACTIVATED', color: 'text-emerald-400', dot: 'bg-emerald-400' },
  AGENT_PAUSED: { label: 'PAUSED', color: 'text-amber-300', dot: 'bg-amber-300' },
  AGENT_REVOKED: { label: 'REVOKED', color: 'text-red-400', dot: 'bg-red-400' },
};

const DEFAULT_STAGE: StageStyle = { label: 'EVENT', color: 'text-gray-400', dot: 'bg-gray-400' };

function detailFor(e: TerminalEvent): string {
  const p = e.payload ?? {};
  switch (e.eventType) {
    case 'AGENT_OBSERVED':
      return `count=${String(p.count ?? '?')} strategy=${String(p.strategyId ?? '?')}`;
    case 'AI_DECISION_CREATED':
      return `status=${String(p.status ?? '?')} reasoning="${String(p.reasoning ?? '').slice(0, 160)}"`;
    case 'AGENT_PASSED':
      return `strategy=${String(p.strategyId ?? '?')} → no action needed`;
    case 'AGENT_PROPOSED':
    case 'ACTION_PROPOSED':
      return `action=${String(p.action ?? '?')} contract=${String(p.contract ?? '?')} fn=${String(p.function ?? '?')}`;
    case 'AGENT_POLICY_DENIED':
    case 'ACTION_DENIED':
      return `check=${String(p.deniedCheck ?? '?')} reason=${String(p.reason ?? 'denied')}`;
    case 'AGENT_EXECUTION_PENDING':
      return typeof p.note === 'string' ? p.note : 'awaiting real signer / active session';
    case 'TRANSACTION_CONFIRMED':
    case 'TRANSACTION_SUBMITTED': {
      const h = String(p.transactionHash ?? p.hash ?? '');
      return h ? `hash=0x${h.replace(/^0x/, '').slice(0, 12)}…` : 'on-chain transaction';
    }
    case 'AGENT_TICK': {
      const cr = (p.cycleResult ?? {}) as Record<string, unknown>;
      const stage = String(cr.stage ?? '?');
      const note = typeof cr.note === 'string' ? ` note=${cr.note.slice(0, 70)}` : '';
      return `stage=${stage}${note}`;
    }
    default: {
      const keys = Object.keys(p).filter((k) => !['correlationId', 'agentId'].includes(k));
      if (!keys.length) return '—';
      return keys
        .slice(0, 2)
        .map((k) => `${k}=${String(p[k]).slice(0, 60)}`)
        .join(' ');
    }
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour12: false });
  } catch {
    return '--:--:--';
  }
}

export function LiveRuntimeTerminal({ agentId, initialEvents = [] }: LiveRuntimeTerminalProps) {
  const [events, setEvents] = useState<TerminalEvent[]>(initialEvents);
  const [paused, setPaused] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const load = async () => {
      try {
        const res = await fetch(`/api/agents/${agentId}/activity?limit=30`);
        if (res.ok) {
          const data = await res.json();
          if (active && Array.isArray(data.events)) {
            const fresh = data.events as TerminalEvent[];
            setEvents((prev) => {
              const seen = new Set(fresh.map((e) => e.id));
              const older = prev.filter((e) => !seen.has(e.id));
              return [...fresh, ...older]
                .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
                .slice(0, 60);
            });
            setLastUpdated(Date.now());
          }
        }
      } catch {
        // Transient network glitch — next poll will retry.
      }
    };

    load();
    if (!paused) timer = setInterval(load, 5000);

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [agentId, paused]);

  // Keep a live "updated Xs ago" counter.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-scroll to the newest line.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events]);

  const updatedAgo = lastUpdated != null ? Math.max(0, Math.round((now - lastUpdated) / 1000)) : null;

  return (
    <div className="bg-black border border-[#222] rounded-xl overflow-hidden font-mono">
      {/* Terminal header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#0C0C0C] border-b border-[#222]">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-[10px] font-black tracking-[0.2em] uppercase text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            {paused ? 'PAUSED' : 'LIVE'}
          </span>
          <span className="text-[10px] text-gray-500">
            {updatedAgo != null ? `updated ${updatedAgo}s ago` : 'connecting…'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          className="text-[10px] font-black text-[#F0B90B] border border-[#333] px-2 py-1 uppercase hover:border-[#F0B90B]/50 transition"
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
      </div>

      {/* Streaming lines */}
      <div ref={scrollRef} className="max-h-[420px] overflow-y-auto px-4 py-3 space-y-2.5">
        {events.length === 0 ? (
          <p className="text-[11px] text-gray-500">
            No runtime events yet. Create a task — the closed loop (observe → think → propose → policy → execute) streams here.
          </p>
        ) : (
          events.map((ev) => {
            const stage = STAGE_STYLE[ev.eventType] ?? DEFAULT_STAGE;
            return (
              <div key={ev.id} className="flex items-start gap-2.5 text-[11px] leading-relaxed">
                <span className="text-gray-600 shrink-0 pt-0.5">{formatTime(ev.createdAt)}</span>
                <span className={`shrink-0 font-black tracking-wider ${stage.color}`}>[{stage.label}]</span>
                <span className="text-gray-300 min-w-0 break-words flex-1">{detailFor(ev)}</span>
              </div>
            );
          })
        )}

        {/* Blinking cursor while live */}
        {!paused && (
          <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className="inline-block w-2 h-3.5 bg-gray-400 animate-pulse" />
            <span className="uppercase tracking-widest">awaiting next tick…</span>
          </div>
        )}
      </div>
    </div>
  );
}