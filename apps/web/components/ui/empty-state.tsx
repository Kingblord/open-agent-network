'use client';

import Link from 'next/link';

interface EmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
}

/**
 * Honest empty-state component (per BAN no-fabrication rule).
 * Shows an explicit "No data yet" state rather than inventing values.
 * Use where the backend returns no records yet.
 */
export function EmptyState({ title, description, actionLabel, actionHref, onAction }: EmptyStateProps) {
  return (
    <div className="text-center bg-[#111] border border-[#222] rounded-2xl p-6 py-10">
      <div className="w-14 h-14 mx-auto mb-3 rounded-xl bg-[#F0B90B] flex items-center justify-center">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="8" width="16" height="12" rx="2" />
          <circle cx="9" cy="13" r="1.5" fill="#000" />
          <circle cx="15" cy="13" r="1.5" fill="#000" />
          <path d="M10 17h4" />
          <line x1="12" y1="4" x2="12" y2="8" />
        </svg>
      </div>
      <div className="text-white font-bold text-base mb-1">{title}</div>
      {description && <p className="text-xs text-gray-400 mb-6 max-w-xs mx-auto">{description}</p>}
      {(actionLabel && (actionHref || onAction)) && (
        actionHref ? (
          <Link
            href={actionHref}
            className="inline-block w-full py-3 bg-[#F0B90B] text-black font-black text-xs rounded-xl uppercase tracking-wider text-center"
          >
            {actionLabel}
          </Link>
        ) : (
          <button
            type="button"
            onClick={onAction}
            className="w-full py-3 bg-[#F0B90B] text-black font-black text-xs rounded-xl uppercase tracking-wider"
          >
            {actionLabel}
          </button>
        )
      )}
    </div>
  );
}