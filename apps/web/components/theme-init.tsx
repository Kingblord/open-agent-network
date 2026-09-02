'use client';

import { useEffect } from 'react';

/**
 * App-wide theme bootstrap.
 *
 * Reads the saved theme ('oan-theme-v1') or falls back to the system
 * preference and applies it to <html> BEFORE paint (called in root layout,
 * which wraps every page — including the landing page). The landing page
 * (app/page.tsx) keeps its own in-page ThemeToggle UI, but the persisted
 * class on <html> is shared so the toggle works consistently app-wide.
 *
 * Landing page exception: the landing hero uses a fixed brutalist design and
 * reads `--background` directly; it is still covered here so a user who toggled
 * light on /settings and then visits / sees the same light palette. The
 * dedicated landing toggle simply writes the same localStorage key — one source
 * of truth ('oan-theme-v1'), one <html> class, every page.
 */
export function ThemeInit() {
  useEffect(() => {
    try {
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