'use client';

import React from 'react';

interface CryptoIconProps {
  symbol: string;
  className?: string;
  size?: number;
}

export function CryptoIcon({ symbol, className = '', size = 28 }: CryptoIconProps) {
  const norm = (symbol || '').toUpperCase().trim();

  // Custom high fidelity SVGs for BNB ecosystem & top tokens
  if (norm === 'BNB' || norm === 'WBNB') {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className={className}>
        <circle cx="16" cy="16" r="16" fill="#F0B90B" />
        <path
          d="M16 6.5l3.5 3.5-3.5 3.5-3.5-3.5L16 6.5zm-5.5 5.5l3.5 3.5-3.5 3.5-3.5-3.5 3.5-3.5zm11 0l3.5 3.5-3.5 3.5-3.5-3.5 3.5-3.5zM16 17.5l3.5 3.5-3.5 3.5-3.5-3.5 3.5-3.5z"
          fill="#000000"
        />
      </svg>
    );
  }

  if (norm === 'USDT' || norm === 'VUSDT') {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className={className}>
        <circle cx="16" cy="16" r="16" fill="#26A17B" />
        <path
          d="M17.9 14.7v-1.6h4.6V10H9.5v3.1h4.6v1.6c-4.4.2-7.7 1.1-7.7 2.2 0 1.1 3.3 2 7.7 2.2v5.9h3.8v-5.9c4.4-.2 7.7-1.1 7.7-2.2 0-1.1-3.3-2-7.7-2.2zm0 3.3c-3.7-.2-6.5-.8-6.5-1.5 0-.7 2.8-1.3 6.5-1.5v3zm3.8-1.5c0 .7-2.8 1.3-6.5 1.5v-3c3.7.2 6.5.8 6.5 1.5z"
          fill="#FFFFFF"
        />
      </svg>
    );
  }

  if (norm === 'CAKE' || norm === 'PANCAKESWAP') {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className={className}>
        <circle cx="16" cy="16" r="16" fill="#D1884F" />
        <path d="M12 9c-1.5 0-2 1.5-1.5 3.5l1.5 3.5c-.8.8-1.5 1.8-1.5 3 0 2.5 2.5 4.5 5 4.5s5-2 5-4.5c0-1.2-.7-2.2-1.5-3l1.5-3.5c.5-2 0-3.5-1.5-3.5-1 0-1.8 1-2 2-.7-.3-1.3-.3-2 0-.2-1-1-2-2-2z" fill="#FFE0B2" />
        <circle cx="13.5" cy="18.5" r="1" fill="#4E2A0E" />
        <circle cx="18.5" cy="18.5" r="1" fill="#4E2A0E" />
      </svg>
    );
  }

  if (norm === 'XVS' || norm === 'VENUS') {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className={className}>
        <circle cx="16" cy="16" r="16" fill="#2B5BEE" />
        <path d="M10 11l6 11 6-11h-3.2l-2.8 5.4-2.8-5.4H10z" fill="#F0B90B" />
        <circle cx="16" cy="9.5" r="1.5" fill="#F0B90B" />
      </svg>
    );
  }

  if (norm === 'BTC' || norm === 'WBTC' || norm === 'BTCB') {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className={className}>
        <circle cx="16" cy="16" r="16" fill="#F7931A" />
        <path d="M20.8 14.2c.4-.7.5-1.5.3-2.3-.4-1.6-1.8-2.3-3.6-2.5V7.5h-1.8V9.3h-1.4V7.5h-1.8V9.3H9.5v2.2h1.4c.5 0 .7.3.7.6v7.7c0 .3-.2.6-.7.6H9.5v2.2h3v1.8h1.8v-1.8h1.4v1.8h1.8v-1.8c2.1-.2 3.8-.9 4.3-2.9.3-1.1.1-2.2-.6-2.9zm-4.7-3c1.1 0 2.2.4 2.2 1.5 0 1.2-1.1 1.6-2.2 1.6h-2.1v-3.1h2.1zm.6 7.4h-2.7v-3.3h2.7c1.3 0 2.4.5 2.4 1.7 0 1.1-1.1 1.6-2.4 1.6z" fill="#FFFFFF" />
      </svg>
    );
  }

  if (norm === 'ETH' || norm === 'WETH') {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className={className}>
        <circle cx="16" cy="16" r="16" fill="#627EEA" />
        <path d="M16 6l-6.5 10.7 6.5 3.8 6.5-3.8L16 6z" fill="#FFFFFF" fillOpacity="0.8" />
        <path d="M16 21.5l-6.5-3.8L16 26l6.5-8.3-6.5 3.8z" fill="#FFFFFF" />
      </svg>
    );
  }

  if (norm === 'ALPACA') {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className={className}>
        <circle cx="16" cy="16" r="16" fill="#2EBD85" />
        <path d="M12 22v-6l4-6 4 6v6h-3v-4h-2v4h-3z" fill="#FFFFFF" />
      </svg>
    );
  }

  // Default clean circular crypto badge with first 2 chars - NO EMOJI
  return (
    <div
      style={{ width: size, height: size }}
      className={`rounded-full bg-muted border border-border flex items-center justify-center text-[10px] font-bold text-[#F0B90B] shrink-0 ${className}`}
    >
      {norm.slice(0, 2) || 'TK'}
    </div>
  );
}