'use client';

import { useEffect } from 'react';
import { LoadingButton } from '@/components/ui/loading-button';

export interface ConfirmLine {
  label: string;
  value: string;
  mono?: boolean;
  tone?: 'default' | 'gold' | 'green' | 'red';
}

interface TransactionConfirmModalProps {
  /**
   * Controlled visibility — the parent decides when to show this modal.
   * It must be shown BEFORE any wallet top-up / transfer is initiated.
   */
  open: boolean;
  title?: string;
  subtitle?: string;
  /** Summary rows shown to the user: recipient, amount, network, fee, etc. */
  lines: ConfirmLine[];
  /** Honest caution text (never fabricated). Default points to BNB chain 56. */
  warning?: string;
  confirmLabel?: string;
  confirmLoadingLabel?: string;
  confirmLoading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Transaction confirmation modal — the mandatory "are you sure?" gate before
 * any wallet top-up / on-chain transfer. The confirm action is owned by the
 * parent (it POSTs to the wallet/top-up endpoint); this modal only presents
 * the summary and disables while the request is in flight (prevents
 * double-submit).
 *
 * Honest-by-design: it never fabricates a receipt, balance change, or
 * transaction hash. The `warning` explains that funds are only counted after
 * on-chain confirmation.
 */
export function TransactionConfirmModal({
  open,
  title = 'Confirm Transaction',
  subtitle,
  lines,
  warning = 'You are sending BNB on BNB Smart Chain (chain 56). Funds are only counted after the transaction is confirmed on-chain — no balance changes are assumed before that.',
  confirmLabel = 'Confirm',
  confirmLoadingLabel = 'Confirming...',
  confirmLoading = false,
  onConfirm,
  onClose,
}: TransactionConfirmModalProps) {
  // Close on Escape + lock page scroll while open (keeps UX consistent with
  // the other BAN modals).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmLoading) onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, confirmLoading, onClose]);

  if (!open) return null;

  const toneClass = (tone: ConfirmLine['tone']) => {
    switch (tone) {
      case 'gold': return 'text-[#F0B90B]';
      case 'green': return 'text-emerald-400';
      case 'red': return 'text-red-400';
      default: return 'text-gray-200';
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#111] border border-[#333] rounded-xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-[#F0B90B]/15 border border-[#F0B90B]/40 flex items-center justify-center shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F0B90B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <circle cx="12" cy="12" r="2.5" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-black text-[#F0B90B] uppercase tracking-wider">{title}</h3>
            {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
          </div>
        </div>

        <div className="bg-black/40 border border-[#222] rounded-lg p-4 space-y-3">
          {lines.map((line, idx) => (
            <div key={`${line.label}-${idx}`} className="flex items-start justify-between gap-3 text-xs">
              <span className="text-gray-500 shrink-0">{line.label}</span>
              <span
                className={`font-black text-right break-all ${line.mono ? 'font-mono' : ''} ${toneClass(line.tone ?? 'default')}`}
              >
                {line.value}
              </span>
            </div>
          ))}
        </div>

        {warning && (
          <p className="text-[11px] text-gray-500 leading-relaxed border border-[#333] bg-[#161616] rounded-lg px-3 py-2.5">
            <span className="font-black text-gray-300 uppercase tracking-wider text-[9px] block mb-1">Important</span>
            {warning}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={confirmLoading}
            className="w-full bg-[#1A1A1A] border border-[#333] text-gray-300 font-black text-xs py-3.5 tracking-[0.15em] uppercase hover:border-gray-500 transition disabled:opacity-60"
          >
            Cancel
          </button>
          <LoadingButton
            onClick={onConfirm}
            loading={confirmLoading}
            loadingLabel={confirmLoadingLabel}
            variant="primary"
            disabled={lines.length === 0}
          >
            {confirmLabel}
          </LoadingButton>
        </div>
      </div>
    </div>
  );
}