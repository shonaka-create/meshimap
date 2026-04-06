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
    // 5秒以内に解決しない場合の安全タイムアウト
    const timeout = setTimeout(() => setLoading(false), 5000)

    // 初期セッションを明示的に取得
    supabase.auth.getSession()
      .then(async ({ data: { session } }) => {
        const u = session?.user ?? null
        setUser(u)
        setLoading(false) // ensureProfile より先に解除
        if (u) await ensureProfile(u)
      })
      .catch(() => {
        setLoading(false)
      })
      .finally(() => {
        clearTimeout(timeout)
      })

    // その後のサインイン・サインアウトを監視
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'INITIAL_SESSION') return // getSession() で処理済み
      const u = session?.user ?? null
      setUser(u)
      if (u && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
        await ensureProfile(u)
      }
    })
    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
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
    if (data.user) {
      const { data: profile } = await supabase.from('profiles').select('id').eq('id', data.user.id).single()
      if (!profile) {
        await supabase.from('profiles').insert({
          id: data.user.id,
          display_name: data.user.user_metadata?.full_name ?? data.user.email?.split('@')[0] ?? '名無し',
          photo_url: data.user.user_metadata?.avatar_url ?? null,
        })
      }
    }
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
