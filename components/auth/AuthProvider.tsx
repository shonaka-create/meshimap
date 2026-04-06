'use client'

import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { useAuth } from '@/hooks/useAuth'
import type { User } from '@supabase/supabase-js'

interface AuthContextType {
  user: User | null
  loading: boolean
  signUp: (email: string, password: string, displayName: string) => Promise<User>
  signIn: (email: string, password: string) => Promise<unknown>
  signInWithGoogle: () => Promise<void>
  logOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()

  useEffect(() => {
    // unload リスナーを追加するだけでブラウザが bfcache の対象外にする
    const noop = () => {}
    window.addEventListener('unload', noop)
    return () => window.removeEventListener('unload', noop)
  }, [])

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
}

export function useAuthContext() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuthContext must be used within AuthProvider')
  return context
}
