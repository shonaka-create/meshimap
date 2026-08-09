'use client'

import { useState, useEffect, useCallback } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase, supabaseUrl } from '@/lib/supabase'

/**
 * ユーザーID の形式チェック。
 * DB 側の CHECK 制約 `username ~ '^[a-z]{3,20}$'`（0001）と同じ条件を
 * 手前で見て、日本語のメッセージにして返す。
 * mobile/src/hooks/useAuth.tsx の同名関数と規則を揃えること。
 */
export function validateUsername(v: string): string | null {
  if (!v) return 'ユーザーIDを入力してください'
  if (/[^a-z]/.test(v)) return 'ユーザーIDは小文字のアルファベットのみ使えます'
  if (v.length < 3) return 'ユーザーIDは3文字以上にしてください'
  if (v.length > 20) return 'ユーザーIDは20文字以内にしてください'
  return null
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- ①のとおり初回マウント時の同期復元は意図的
      setUser(stored)
      setLoading(false)
    }

    // ② onAuthStateChange で正確なセッション状態に更新
    //    INITIAL_SESSION: Navigator Lock 解放後に発火（遅延あり）
    //    SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED: リアルタイム更新
    //    profiles 行は auth.users への INSERT トリガー handle_new_user() が作る。
    //    ここでクライアントから作りにいくと username(NOT NULL・形式制約あり) を
    //    満たせず、トリガーが入れた行と競合するだけなので何もしない。
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      setUser(session?.user ?? null)
      setLoading(false)
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

  const isUsernameAvailable = useCallback(async (username: string) => {
    const { data, error } = await supabase.rpc('is_username_available', {
      p_username: username,
    })
    if (error) {
      console.warn('[useAuth] ユーザーID確認に失敗', error.message)
      return false
    }
    return data === true
  }, [])

  /**
   * 新規登録。
   *
   * ★ options.data に渡したキーだけが handle_new_user() トリガー（0005）に読まれ、
   *   profiles へ転記される。読まれるのは username と display_name の2つ。
   *   以前ここは full_name を送っていたため、トリガーが display_name を見つけられず
   *   自動採番の userxxxx が表示名になっていた。mobile と同じ契約に揃えてある。
   *
   * profiles への upsert は行わない。トリガーが先に行を作るので後追いの
   * upsert は必ず素通りし、「保存されたつもり」を生むだけだった。
   */
  const signUp = async (args: {
    email: string
    password: string
    username: string
    displayName: string
  }) => {
    const normalized = args.username.trim().toLowerCase()

    const formatError = validateUsername(normalized)
    if (formatError) throw new Error(formatError)
    if (!args.displayName.trim()) throw new Error('アカウント名を入力してください')

    // 事前チェック。ここを通っても同時登録で衝突しうるので、
    // 最終的な一意性は DB の UNIQUE 制約が保証する。
    if (!(await isUsernameAvailable(normalized))) {
      throw new Error('このユーザーIDは既に使われています')
    }

    const { data, error } = await supabase.auth.signUp({
      email: args.email.trim(),
      password: args.password,
      options: { data: { username: normalized, display_name: args.displayName.trim() } },
    })
    if (error) throw error

    // メール確認が有効な場合、session は null になる
    return { needsEmailConfirm: !data.session }
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

  return { user, loading, signUp, signIn, signInWithGoogle, logOut, isUsernameAvailable }
}
