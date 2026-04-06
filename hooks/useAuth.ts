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

/**
 * Supabase が localStorage に保存したセッションを同期的に読み取り、
 * まだ有効なユーザーを返す。期限切れ・存在しない場合は null。
 * useEffect 冒頭で呼ぶことでスピナーなしに即座にアプリを表示できる。
 */
function getCachedUser(): User | null {
  try {
    const raw = localStorage.getItem('supabase.auth.token')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    // Supabase v2 のストレージ構造に対応
    const user: User | undefined = parsed?.user ?? parsed?.currentSession?.user
    const expiresAt: number | undefined =
      parsed?.expires_at ?? parsed?.currentSession?.expires_at
    if (!user) return null
    // 期限切れなら getSession() の自動リフレッシュに任せる
    if (expiresAt && expiresAt < Date.now() / 1000) return null
    return user
  } catch {
    return null
  }
}

export function useAuth() {
  // SSR と一致させるため初期値は null / true で固定
  // （ハイドレーションエラーを防ぐ）
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    // ① localStorage から即座に復元 → スピナーを表示せずアプリを見せる
    const cached = getCachedUser()
    if (cached) {
      setUser(cached)
      setLoading(false)
    }

    // ② getSession() でトークン検証・自動リフレッシュ
    //    キャッシュが有効なら loading はすでに false なので UX に影響しない
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        if (!mounted) return
        setUser(session?.user ?? null)
        setLoading(false)
        if (session?.user) ensureProfile(session.user)
      })
      .catch(() => {
        if (!mounted) return
        setLoading(false)
      })

    // ③ ログイン・ログアウト・トークンリフレッシュを監視
    //    INITIAL_SESSION は ② が担うのでスキップ
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return
      if (event === 'INITIAL_SESSION') return

      const u = session?.user ?? null
      setUser(u)
      setLoading(false)

      if (u && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
        await ensureProfile(u)
      }
    })

    return () => {
      mounted = false
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
