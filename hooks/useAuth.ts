'use client'

import { useState, useEffect } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase, supabaseUrl } from '@/lib/supabase'

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
 * Supabase v2 が localStorage に保存するセッションを同期的に読み取る。
 * キー: sb-{projectRef}-auth-token
 * INITIAL_SESSION イベントは Navigator Lock 待ちで数秒遅延することがあるため、
 * この関数で先に user を復元してスピナーを排除する。
 */
function getStoredUser(): User | null {
  if (typeof window === 'undefined') return null
  try {
    const match = supabaseUrl.match(/https?:\/\/([^.]+)\.supabase\.co/)
    if (!match) {
      console.warn('[useAuth] supabaseUrl からプロジェクト参照を取得できませんでした。URL を確認してください:', supabaseUrl)
      return null
    }
    const key = `sb-${match[1]}-auth-token`
    const raw = localStorage.getItem(key)
    if (!raw) {
      // セッションなし（未ログイン）は正常。ログ不要。
      return null
    }
    const parsed = JSON.parse(raw)
    const user: User | undefined = parsed?.user
    if (!user?.id) {
      // キーは存在するが user が取れない = Supabase がキー構造を変えた可能性
      console.warn('[useAuth] localStorage のセッションから user を取得できませんでした。@supabase/supabase-js のバージョンを確認してください。key:', key, 'value:', parsed)
      return null
    }
    // 期限切れでも user を返す（onAuthStateChange が正確な状態で上書きする）
    return user
  } catch (e) {
    console.warn('[useAuth] localStorage の読み取り中にエラーが発生しました:', e)
    return null
  }
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    // ① localStorage から即時復元 → スピナーなしでアプリを表示
    //    SSR と不一致にならないよう useEffect 内（クライアント専用）で実行
    const stored = getStoredUser()
    if (stored) {
      setUser(stored)
      setLoading(false)
    }

    // ② onAuthStateChange で正確なセッション状態に更新
    //    INITIAL_SESSION: Navigator Lock 解放後に発火（遅延あり）
    //    SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED: リアルタイム更新
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      setUser(session?.user ?? null)
      setLoading(false)
      if (session?.user && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
        ensureProfile(session.user)
      }
    })

    // ③ フォールバック: 万が一 onAuthStateChange が発火しない場合に解除
    const fallback = setTimeout(() => {
      if (mounted) setLoading(false)
    }, 5000)

    return () => {
      mounted = false
      clearTimeout(fallback)
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
