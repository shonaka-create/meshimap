'use client'

import { useState, useEffect } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

async function ensureProfile(user: User) {
  const { data } = await supabase.from('profiles').select('id').eq('id', user.id).single()
  if (!data) {
    await supabase.from('profiles').insert({
      id: user.id,
      display_name:
        user.user_metadata?.full_name ??
        user.user_metadata?.name ??
        user.email?.split('@')[0] ??
        '名無し',
      photo_url: user.user_metadata?.avatar_url ?? null,
    })
  }
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    // 1. localStorage から即座にセッション取得（ネットワーク不要）
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return
      setUser(session?.user ?? null)
      setLoading(false)
      if (session?.user) ensureProfile(session.user)
    })

    // 2. ログイン・ログアウト・トークンリフレッシュを監視
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return
      const u = session?.user ?? null

      if (event === 'SIGNED_OUT') {
        setUser(null)
        setLoading(false)
      } else if (u) {
        setUser(prev => (prev?.id === u.id ? prev : u))
        setLoading(false)
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          await ensureProfile(u)
        }
      }
    })

    return () => {
      mounted = false  // 非同期コールバックがアンマウント後に state を変更しないよう
      subscription.unsubscribe()
    }
  }, [])

  const signUp = async (email: string, password: string, displayName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: displayName } },
    })
    if (error) throw error
    if (data.user) {
      await supabase.from('profiles').upsert(
        { id: data.user.id, display_name: displayName },
        { onConflict: 'id', ignoreDuplicates: true }
      )
    }
    return data.user!
  }

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) throw error
  }

  const logOut = async () => {
    await supabase.auth.signOut()
  }

  return { user, loading, signUp, signIn, signInWithGoogle, logOut }
}
