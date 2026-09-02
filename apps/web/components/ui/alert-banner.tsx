'use client';

/** Inline non-transient status banner (success / error / info / warning) for form regions. */

type AlertTone = 'success' | 'error' | 'info' | 'warning';

const TONES: Record<AlertTone, { box: string; text: string; icon: string }> = {
  success: {
    box: 'bg-emerald-500/10 border-emerald-500/30',
    text: 'text-emerald-600 dark:text-emerald-400',
    icon: 'M20 6L9 17l-5-5',
  },
  error: {
    box: 'bg-red-500/10 border-red-500/30',
    text: 'text-red-600 dark:text-red-400',
    icon: 'M18 6L6 18M6 6l12 12',
  },
  info: {
    box: 'bg-[#F0B90B]/10 border-[#F0B90B]/30',
    text: 'text-[#F0B90B]',
    icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  warning: {
    box: 'bg-amber-500/10 border-amber-500/30',
    text: 'text-amber-600 dark:text-amber-400',
    icon: 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  },
};

export function AlertBanner({ tone = 'info', title, description }: { tone?: AlertTone; title: string; description?: string }) {
  const toneCfg = TONES[tone];
  const Icon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={toneCfg.icon} />
    </svg>
  );
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border ${toneCfg.box}`}>
      <span className={`mt-0.5 shrink-0 ${toneCfg.text}`}>{Icon}</span>
      <div className="min-w-0">
        <p className={`text-xs font-black uppercase tracking-wide ${toneCfg.text}`}>{title}</p>
        {description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}