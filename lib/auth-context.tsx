'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'

export interface AuthUser {
  id: string
  name: string
  email: string
  credits: number
  tier: string
  createdAt: Date
}

type StoredUser = AuthUser & { password: string }
type AuthStore = { version: 1; users: StoredUser[]; sessionId: string | null }

interface AuthContextType {
  user: AuthUser | null
  loading: boolean
  token: string | null
  signup: (name: string, email: string, password: string) => Promise<void>
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)
const STORAGE_KEY = 'oan-auth-v1'
const DEMO_USER: StoredUser = {
  id: 'demo-user',
  name: 'Demo Operator',
  email: 'demo@example.com',
  password: 'DemoPass123',
  credits: 1000,
  tier: 'pro',
  createdAt: new Date('2025-01-01T00:00:00.000Z'),
}

function emptyStore(): AuthStore {
  return { version: 1, users: [DEMO_USER], sessionId: null }
}

function readStore(): AuthStore {
  if (typeof window === 'undefined') return emptyStore()
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null') as Partial<AuthStore> | null
    if (parsed?.version === 1 && Array.isArray(parsed.users)) return parsed as AuthStore
  } catch {
    // Reset malformed local state below.
  }
  const store = emptyStore()
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  return store
}

function writeStore(store: AuthStore) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

function publicUser(user: StoredUser): AuthUser {
  const { password: _password, ...safeUser } = user
  return { ...safeUser, createdAt: new Date(safeUser.createdAt) }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [token, setToken] = useState<string | null>(null)

  const refreshUser = async () => {
    const store = readStore()
    const active = store.users.find((candidate) => candidate.id === store.sessionId)
    setUser(active ? publicUser(active) : null)
    setToken(active ? active.id : null)
  }

  useEffect(() => {
    refreshUser().finally(() => setLoading(false))
  }, [])

  const signup = async (name: string, email: string, password: string) => {
    setLoading(true)
    try {
      const store = readStore()
      const normalizedEmail = email.trim().toLowerCase()
      if (store.users.some((candidate) => candidate.email === normalizedEmail)) {
        throw new Error('An account with this email already exists')
      }
      if (password.length < 8) throw new Error('Password must be at least 8 characters')
      const newUser: StoredUser = {
        id: `local-${crypto.randomUUID()}`,
        name: name.trim(),
        email: normalizedEmail,
        password,
        credits: 500,
        tier: 'free',
        createdAt: new Date(),
      }
      writeStore({ ...store, users: [...store.users, newUser], sessionId: newUser.id })
      setUser(publicUser(newUser))
      setToken(newUser.id)
    } finally {
      setLoading(false)
    }
  }

  const login = async (email: string, password: string) => {
    setLoading(true)
    try {
      const store = readStore()
      const found = store.users.find((candidate) => candidate.email === email.trim().toLowerCase())
      if (!found || found.password !== password) throw new Error('Invalid email or password')
      writeStore({ ...store, sessionId: found.id })
      setUser(publicUser(found))
      setToken(found.id)
    } finally {
      setLoading(false)
    }
  }

  const logout = async () => {
    const store = readStore()
    writeStore({ ...store, sessionId: null })
    setUser(null)
    setToken(null)
  }

  return <AuthContext.Provider value={{ user, loading, token, signup, login, logout, refreshUser }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}
