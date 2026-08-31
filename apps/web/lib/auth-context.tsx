'use client'

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth'
import { auth } from '@/lib/firebase'

export interface AuthUser {
  id: string
  name: string
  email: string
  credits: number
  tier: string
  createdAt: string
  /** Connected wallet address persisted on the account (null when not linked). */
  walletAddress: string | null
}

interface AuthContextType {
  user: AuthUser | null
  loading: boolean
  firebaseUser: FirebaseUser | null
  signup: (name: string, email: string, password: string) => Promise<void>
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
  /** Update the wallet address on the in-memory auth user (e.g. after connect). */
  updateUserWallet: (walletAddress: string | null) => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

/**
 * Coerces the server's user payload into AuthUser, normalising walletAddress
 * so consumers can rely on `user.walletAddress` being `string | null`.
 */
function toAuthUser(u: any): AuthUser | null {
  if (!u || typeof u.id !== 'string') return null
  return {
    id: u.id,
    name: u.name ?? '',
    email: u.email ?? '',
    credits: typeof u.credits === 'number' ? u.credits : 0,
    tier: u.tier ?? 'free',
    createdAt: u.createdAt ?? new Date().toISOString(),
    walletAddress: typeof u.walletAddress === 'string' ? u.walletAddress : null,
  }
}

/**
 * Exchanges a Firebase ID token for a Firestore user record via the server API.
 * Creates the user in Firestore on first signup, returns existing on login.
 */
async function exchangeFirebaseToken(idToken: string): Promise<AuthUser | null> {
  const res = await fetch('/api/auth/firebase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to authenticate with server')
  }
  const data = await res.json()
  return toAuthUser(data.user)
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null)
  const [loading, setLoading] = useState(true)
  // Prevent the Firebase -> /me -> setUser race on mount
  const initialExchangeDone = useRef(false)

  // Listen to Firebase auth state (once)
  useEffect(() => {
    if (!auth) {
      // Firebase client SDK not configured (missing NEXT_PUBLIC_ vars)
      setLoading(false)
      return
    }

    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser)

      if (fbUser && !initialExchangeDone.current) {
        initialExchangeDone.current = true
        try {
          const idToken = await fbUser.getIdToken()
          const serverUser = await exchangeFirebaseToken(idToken)
          setUser(serverUser)
        } catch {
          // Token exchange failed — user exists in Firebase but not in Firestore
          setUser(null)
        }
      } else if (!fbUser) {
        setUser(null)
      }

      setLoading(false)
    })

    return () => unsubscribe()
  }, [])

  const refreshUser = useCallback(async () => {
    if (!auth || !firebaseUser) {
      setUser(null)
      return
    }
    try {
      const idToken = await firebaseUser.getIdToken(true) // force refresh
      const serverUser = await exchangeFirebaseToken(idToken)
      setUser(serverUser)
    } catch {
      setUser(null)
    }
  }, [firebaseUser])

  const updateUserWallet = useCallback((walletAddress: string | null) => {
    setUser((prev) => {
      if (!prev) return prev
      if (prev.walletAddress === walletAddress) return prev
      return { ...prev, walletAddress }
    })
  }, [])

  const signup = async (name: string, email: string, password: string) => {
    if (!auth) throw new Error('Firebase Auth is not configured')

    // 1. Create Firebase Auth user
    const cred = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password)

    // 2. Server-side signup (stores name + user in Firestore)
    const idToken = await cred.user.getIdToken()
    const res = await fetch('/api/auth/firebase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, name: name.trim() }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Server signup failed')
    }

    const data = await res.json()
    setUser(toAuthUser(data.user))
    setFirebaseUser(cred.user)
  }

  const login = async (email: string, password: string) => {
    if (!auth) throw new Error('Firebase Auth is not configured')

    // 1. Firebase Auth sign-in
    const cred = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password)

    // 2. Exchange token for Firestore user
    const idToken = await cred.user.getIdToken()
    const res = await fetch('/api/auth/firebase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Server login failed')
    }

    const data = await res.json()
    setUser(toAuthUser(data.user))
    setFirebaseUser(cred.user)
  }

  const logout = async () => {
    if (auth) {
      await signOut(auth)
    }
    setUser(null)
    setFirebaseUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, firebaseUser, signup, login, logout, refreshUser, updateUserWallet }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}