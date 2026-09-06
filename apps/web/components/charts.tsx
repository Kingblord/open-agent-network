'use client';

import { useState } from 'react';

/**
 * Lightweight SVG pie chart — no external dependencies.
 * Renders a donut/ring chart with animated segments and hover tooltips.
 */

export interface PieSegment {
  label: string;
  value: number;
  color: string;
}

interface PieChartProps {
  segments: PieSegment[];
  size?: number;
  strokeWidth?: number;
  centerLabel?: string;
  centerValue?: string;
}

export function PieChart({ segments, size = 160, strokeWidth = 24, centerLabel, centerValue }: PieChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return <div className="text-muted-foreground text-xs text-center">No data</div>;

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx = size / 2;
  const cy = size / 2;

  let accumulated = 0;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {segments.map((seg, idx) => {
          const pct = seg.value / total;
          const dashLength = pct * circumference;
          const dashOffset = circumference - (accumulated / total) * circumference;
          accumulated += seg.value;
          const isHovered = hoveredIdx === idx;

          return (
            <circle
              key={seg.label}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={isHovered ? strokeWidth + 4 : strokeWidth}
              strokeDasharray={`${dashLength} ${circumference - dashLength}`}
              strokeDashoffset={dashOffset}
              strokeLinecap="butt"
              style={{
                transform: 'rotate(-90deg)',
                transformOrigin: 'center',
                transition: 'stroke-width 0.2s ease',
                opacity: hoveredIdx !== null && !isHovered ? 0.4 : 1,
              }}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
            />
          );
        })}
      </svg>
      {/* Center label */}
      {centerLabel && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          {centerValue && (
            <span className="text-lg font-black text-foreground leading-none">{centerValue}</span>
          )}
          <span className="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5">{centerLabel}</span>
        </div>
      )}
      {/* Hover tooltip */}
      {hoveredIdx !== null && segments[hoveredIdx] && (
        <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-card border border-border rounded px-2 py-1 text-[10px] font-bold whitespace-nowrap z-10 shadow-lg">
          <span style={{ color: segments[hoveredIdx].color }}>●</span>{' '}
          {segments[hoveredIdx].label}: ${segments[hoveredIdx].value.toFixed(2)}
        </div>
      )}
    </div>
  );
}

/**
 * Legend for pie chart segments.
 */
export function PieLegend({ segments, total }: { segments: PieSegment[]; total: number }) {
  return (
    <div className="space-y-1.5">
      {segments.map((seg) => (
        <div key={seg.label} className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: seg.color }} />
            <span className="text-muted-foreground">{seg.label}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono font-black text-foreground">${seg.value.toFixed(2)}</span>
            <span className="text-muted-foreground font-mono text-[10px]">
              {total > 0 ? `${((seg.value / total) * 100).toFixed(0)}%` : '0%'}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Simple horizontal bar chart for comparisons.
 */
export function BarChart({ items, maxValue }: { items: { label: string; value: number; color: string }[]; maxValue?: number }) {
  const max = maxValue || Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.label} className="space-y-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">{item.label}</span>
            <span className="font-mono font-black text-foreground">${item.value.toFixed(2)}</span>
          </div>
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${(item.value / max) * 100}%`, backgroundColor: item.color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Collapsible section — works on mobile to keep UI clean.
 */
export function CollapsibleSection({
  title,
  defaultOpen = true,
  badge,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  badge?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black text-foreground tracking-widest uppercase">{title}</span>
          {badge && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-accent/10 text-accent border border-accent/30">{badge}</span>
          )}
        </div>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className={`text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

/**
 * Stat card with icon, value, label and optional change indicator.
 */
export function StatCard({
  icon,
  value,
  label,
  change,
  changeType,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-3.5 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-black text-muted-foreground uppercase tracking-wider">{label}</span>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <div className="flex items-end gap-2">
        <span className="text-xl font-black text-foreground leading-none">{value}</span>
        {change && (
          <span className={`text-[10px] font-bold ${
            changeType === 'positive' ? 'text-emerald-400' : changeType === 'negative' ? 'text-red-400' : 'text-muted-foreground'
          }`}>
            {change}
          </span>
        )}
      </div>
    </div>
  );
}
