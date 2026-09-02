'use client';

import { type ButtonHTMLAttributes } from 'react';

interface LoadingButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  loadingLabel?: string;
  variant?: 'primary' | 'destructive' | 'outline';
}

const VARIANTS: Record<string, string> = {
  primary: 'bg-[#F0B90B] text-black hover:bg-yellow-400',
  destructive: 'bg-red-500 text-black hover:bg-red-400',
  outline: 'bg-secondary border border-border text-secondary-foreground hover:border-accent/60 hover:text-foreground',
};

/**
 * Button with built-in busy state that prevents double-submit and shows a spinner.
 */
export function LoadingButton({ loading, loadingLabel = 'Working...', variant = 'primary', disabled, children, ...props }: LoadingButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`w-full py-3.5 text-xs font-black uppercase tracking-widest rounded transition disabled:opacity-60 ${VARIANTS[variant]}`}
      {...props}
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <span className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          {loadingLabel}
        </span>
      ) : (
        children
      )}
    </button>
  );
}