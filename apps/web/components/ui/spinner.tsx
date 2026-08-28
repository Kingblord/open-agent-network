'use client';

/**
 * BAN loading primitives (dark theme).
 * - Spinner: standalone inline loader
 * - LoadingState: full-region loader with optional label
 * All use real async/loading state only; never a fake "loading" for static content.
 */

export function Spinner({ size = 'md', label }: { size?: 'sm' | 'md' | 'lg'; label?: string }) {
  const px =
    size === 'sm' ? 'h-4 w-4 border-2' : size === 'lg' ? 'h-10 w-10 border-[3px]' : 'h-6 w-6 border-2';

  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <div className={`${px} inline-block animate-spin rounded-full border-[#F0B90B] border-t-transparent`} aria-hidden="true" />
      {label && <p className="text-xs font-mono uppercase tracking-widest text-[#F0B90B]">{label}</p>}
    </div>
  );
}

export function LoadingState({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner label={label} />
    </div>
  );
}

export function InlineSpinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-4 justify-center">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#F0B90B] border-t-transparent" />
      {label && <p className="text-xs font-mono uppercase tracking-widest text-[#F0B90B]">{label}</p>}
    </div>
  );
}