'use client';

import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  dismissable?: boolean;
}

interface ToastOptions {
  title: string;
  description?: string;
  duration?: number;
  dismissable?: boolean;
}

interface ToastContextValue {
  success: (opts: ToastOptions | string) => void;
  error: (opts: ToastOptions | string) => void;
  info: (opts: ToastOptions | string) => void;
  warning: (opts: ToastOptions | string) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const ICONS: Record<ToastType, { path: string; color: string }> = {
  success: {
    color: 'text-emerald-400 border-emerald-500/40',
    path: 'M20 6L9 17l-5-5',
  },
  error: {
    color: 'text-red-400 border-red-500/40',
    path: 'M18 6L6 18M6 6l12 12',
  },
  info: {
    color: 'text-[#F0B90B] border-[#F0B90B]/50',
    path: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  warning: {
    color: 'text-amber-400 border-amber-500/40',
    path: 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  },
};

function normalize(opts: ToastOptions | string): ToastOptions {
  return typeof opts === 'string' ? { title: opts } : opts;
}

/**
 * Global toast system (BAN dark theme).
 * Supports success / error / info / warning, stacked, auto-dismissing, dismissible.
 * Mount <ToastProvider> once in the root layout, then use useToast() in any client page.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current[id];
    if (timer) {
      clearTimeout(timer);
      delete timers.current[id];
    }
  }, []);

  const push = useCallback(
    (type: ToastType) =>
      (opts: ToastOptions | string) => {
        const { title, description, duration = 5000, dismissable = true } = normalize(opts);
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setToasts((prev) => [...prev.slice(-4), { id, type, title, description, dismissable }]);
        if (duration > 0) {
          timers.current[id] = setTimeout(() => dismiss(id), duration);
        }
      },
    [dismiss]
  );

  const contextValue: ToastContextValue = {
    success: push('success'),
    error: push('error'),
    info: push('info'),
    warning: push('warning'),
    dismiss,
  };

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div
        aria-live="polite"
        role="region"
        aria-label="Notifications"
        className="fixed top-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2"
      >
        {toasts.map((t) => {
          const icon = ICONS[t.type];
          return (
            <div
              key={t.id}
              className="pointer-events-auto w-full rounded-xl border border-[#333] bg-[#111]/95 backdrop-blur p-3.5 shadow-2xl shadow-black/50"
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border bg-black ${icon.color}`}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d={icon.path} />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-white uppercase tracking-wide">{t.title}</p>
                  {t.description && <p className="mt-0.5 text-xs leading-relaxed text-gray-400">{t.description}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  aria-label="Dismiss"
                  className={`-mr-1 -mt-1 shrink-0 grid size-6 place-items-center text-gray-500 hover:text-white transition ${!t.dismissable ? 'hidden' : ''}`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <style jsx global>{`
        .toast-enter { transform: translateX(110%); transition: transform 200ms ease; }
      `}</style>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a <ToastProvider>');
  }
  return context;
}