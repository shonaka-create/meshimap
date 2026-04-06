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
  const [loading, setLoading] = useState(true) // INITIAL_SESSION を待つ

  // bfcache から復元されたとき、フルリロードせずセッションを再取得して状態を復元
  useEffect(() => {
    const handlePageShow = async (e: PageTransitionEvent) => {
      if (!e.persisted) return
      const { data: { session } } = await supabase.auth.getSession()
      setUser(session?.user ?? null)
      setLoading(false)
    }
    window.addEventListener('pageshow', handlePageShow)
    return () => window.removeEventListener('pageshow', handlePageShow)
  }, [])

  useEffect(() => {
    let resolved = false

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const u = session?.user ?? null
      if (u !== null) {
        // セッションがある場合: ユーザーIDが変わった場合のみ更新
        setUser(prev => (prev?.id === u.id ? prev : u))
      } else if (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') {
        // 明示的なサインアウト or 初回セッション確認で未ログインの場合のみ null にする
        // タブ切り替え時の一時的なセッション消失（TOKEN_REFRESHED前の空イベント等）では null にしない
        setUser(null)
      }
      if (!resolved) {
        resolved = true
        setLoading(false)
      }
      if (u && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED')) {
        await ensureProfile(u)
      }
    })

    // 安全策: 3秒以内に認証イベントが来なければ強制終了
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        setLoading(false)
      }
    }, 3000)

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
