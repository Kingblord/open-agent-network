'use client';

import { useCallback, useState } from 'react';
import { useToast } from '@/components/toast-provider';

/**
 * Copyable blockchain address (BNB wallet address etc.).
 *
 * Displays the address — shortened by default, full on request — and copies
 * the full value to the clipboard on click, with toast feedback. Uses
 * navigator.clipboard when available and falls back to a hidden textarea for
 * non-secure contexts (http / localhost edge cases).
 *
 * Note: the click handler calls preventDefault() + stopPropagation() so the
 * component is safe to embed inside a wrapping <Link>/<a> card without
 * triggering card navigation.
 */
export function CopyAddress({
  address,
  showFull = false,
  className = '',
}: {
  address: string;
  showFull?: boolean;
  className?: string;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const shorten = useCallback((value: string, head = 6, tail = 4) => {
    if (!value) return '';
    if (value.length <= head + tail + 1) return value;
    return `${value.slice(0, head)}…${value.slice(-tail)}`;
  }, []);

  const copy = useCallback(async () => {
    if (!address) return;
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(address);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      // Fallback for non-secure contexts (plain http / older browsers).
      try {
        const el = document.createElement('textarea');
        el.value = address;
        el.setAttribute('readonly', '');
        el.style.position = 'absolute';
        el.style.left = '-9999px';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        ok = true;
      } catch {
        ok = false;
      }
    }

    if (ok) {
      setCopied(true);
      toast.success({
        title: 'Address copied',
        description: 'Wallet address copied to clipboard.',
      });
      window.setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error({
        title: 'Copy failed',
        description: 'Could not copy the address automatically. Select it manually.',
      });
    }
  }, [address, toast]);

  if (!address) return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void copy();
      }}
      title="Copy wallet address"
      aria-label={`Copy wallet address ${address}`}
      className={`inline-flex items-center gap-1.5 rounded border border-[#333] bg-black/40 px-2 py-1 font-mono hover:border-[#F0B90B]/60 hover:text-[#F0B90B] transition ${className}`}
    >
      <span className="truncate">{showFull ? address : shorten(address)}</span>
      {copied ? (
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-emerald-400"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-gray-500"
          aria-hidden="true"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}