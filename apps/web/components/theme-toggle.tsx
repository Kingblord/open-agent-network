'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

const THEME_KEY = 'oan-theme-v1'

function resolveInitialTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark'
  const saved = window.localStorage.getItem(THEME_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const nextTheme = resolveInitialTheme()
    setTheme(nextTheme)
    document.documentElement.classList.remove('dark', 'light')
    document.documentElement.classList.add(nextTheme)
    document.documentElement.style.colorScheme = nextTheme
  }, [])

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(nextTheme)
    window.localStorage.setItem(THEME_KEY, nextTheme)
    document.documentElement.classList.remove('dark', 'light')
    document.documentElement.classList.add(nextTheme)
    document.documentElement.style.colorScheme = nextTheme
  }

  if (!mounted) {
    return (
      <button
        type="button"
        className={className || "flex size-10 items-center justify-center rounded-lg border border-border bg-card text-[#F0B90B]"}
      >
        <Sun className="size-5" />
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
        className ||
        "flex size-10 items-center justify-center rounded-lg border transition-colors duration-200 " +
        "border-border bg-card text-[#F0B90B] hover:border-[#F0B90B] shadow-sm"
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