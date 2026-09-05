'use client';

import { useEffect } from 'react';

/**
 * App-wide theme bootstrap (app pages only).
 *
 * Reads the saved theme ('oan-theme-v1') or falls back to the system
 * preference and applies it to <html> BEFORE paint.
 *
 * Landing-page exception: the landing page (app/page.tsx) has its own
 * dedicated toggle + scoped palette via [data-landing] on its <main>. When
 * this component sees that marker it does nothing, so the landing page's
 * theme behavior is fully self-owned and never fought by this bootstrap.
 */
export function ThemeInit() {
  useEffect(() => {
    try {
      if (document.querySelector('[data-landing]')) {
        return; // Landing page owns its own theme — do not touch.
      }
      const saved = window.localStorage.getItem('oan-theme-v1');
      const systemPrefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
      const nextTheme: 'dark' | 'light' =
        saved === 'light' ? 'light' : saved === 'dark' ? 'dark' : systemPrefersLight ? 'light' : 'dark';
      document.documentElement.classList.remove('dark', 'light');
      document.documentElement.classList.add(nextTheme);
      document.documentElement.style.colorScheme = nextTheme;
    } catch {
      // Non-fatal: default dark already set by the <html className="dark"> in layout.
    }
  }, []);

  return null;
}