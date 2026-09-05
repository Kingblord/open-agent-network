'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

const THEME_KEY = 'oan-theme-v1'

/**
 * Landing-page theme toggle — reproduces the ORIGINAL toggle behavior exactly:
 * dark-first default (no system-light lookup), persists to the same
 * 'oan-theme-v1' key, black button + yellow icon in dark, white button + yellow
 * icon in light. The landing page keeps its own logic; app pages use the
 * shared ThemeToggle/ThemeInit instead.
 */
export function LandingThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const saved = window.localStorage.getItem(THEME_KEY)
    const nextTheme = saved === 'light' ? 'light' : 'dark'
    setTheme(nextTheme)
    document.documentElement.classList.remove('dark', 'light')
    document.documentElement.classList.add(nextTheme)
  }, [])

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(nextTheme)
    window.localStorage.setItem(THEME_KEY, nextTheme)
    document.documentElement.classList.remove('dark', 'light')
    document.documentElement.classList.add(nextTheme)
  }

  if (!mounted) {
    return (
      <button
        type="button"
        aria-label="Toggle theme"
        className="flex size-10 items-center justify-center rounded-lg border-2 border-[#F0B90B] bg-[#111] text-[#F0B90B]"
      >
        <Sun className="size-5" aria-hidden="true" />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      className={
        theme === 'dark'
          ? 'flex size-10 items-center justify-center rounded-lg border-2 border-[#F0B90B] bg-[#111] text-[#F0B90B] transition-colors hover:bg-[#1a1a1a]'
          : 'flex size-10 items-center justify-center rounded-lg border-2 border-gray-300 bg-white text-[#F0B90B] transition-colors hover:border-[#F0B90B]'
      }
    >
      {theme === 'dark' ? (
        <Sun className="size-5" aria-hidden="true" />
      ) : (
        <Moon className="size-5" aria-hidden="true" />
      )}
    </button>
  )
}