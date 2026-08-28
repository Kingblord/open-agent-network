'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

const THEME_KEY = 'oan-theme-v1'

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const saved = window.localStorage.getItem(THEME_KEY)
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const nextTheme = saved === 'light' ? 'light' : saved === 'dark' ? 'dark' : systemPrefersDark ? 'dark' : 'dark'
    setTheme(nextTheme)
    document.documentElement.classList.toggle('dark', nextTheme === 'dark')
    document.documentElement.classList.toggle('light', nextTheme === 'light')
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
        className={className || "flex size-10 items-center justify-center rounded-lg border border-[#333] bg-[#111] text-[#F0B90B]"}
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
        "dark:border-[#333] dark:bg-[#111] dark:text-[#F0B90B] dark:hover:border-[#F0B90B] " +
        "border-gray-300 bg-white text-[#F0B90B] hover:border-[#F0B90B] " +
        "shadow-sm"
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
