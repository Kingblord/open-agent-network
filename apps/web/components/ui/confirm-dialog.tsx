'use client';

import { useEffect, useState } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  dangerous?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Replaces native confirm() with a scoped destructive dialog (BAN dark theme).
 * Used for safe/destructive actions (revoke, pause, delete key) so we never
 * rely on the browser's blocking dialog.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  dangerous = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (open) setMounted(true);
    if (!open) {
      const t = setTimeout(() => setMounted(false), 150);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!open && !mounted) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#111] border border-[#333] rounded-xl p-6 w-full max-w-md space-y-4">
        <h3 className={`text-base font-black uppercase ${dangerous ? 'text-red-400' : 'text-white'}`}>{title}</h3>
        {description && <p className="text-xs text-gray-400 leading-relaxed">{description}</p>}
        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 bg-[#222] text-white text-xs font-black py-2.5 uppercase rounded disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 text-black text-xs font-black py-2.5 uppercase rounded flex items-center justify-center gap-2 disabled:opacity-60 transition ${
              dangerous ? 'bg-red-500 hover:bg-red-400' : 'bg-[#F0B90B] hover:bg-yellow-400'
            }`}
          >
            {loading && <span className="h-3.5 w-3.5 border-2 border-black/40 border-t-transparent rounded-full animate-spin" />}
            {loading ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}