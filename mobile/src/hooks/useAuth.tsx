import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/types'

/** ユーザーID(@handle) の規則。DB側の CHECK 制約と必ず一致させること。 */
export const USERNAME_RE = /^[a-z]{3,20}$/

export function validateUsername(v: string): string | null {
  if (!v) return 'ユーザーIDを入力してください'
  if (/[^a-z]/.test(v)) return 'ユーザーIDは小文字のアルファベットのみ使えます'
  if (v.length < 3) return 'ユーザーIDは3文字以上にしてください'
  if (v.length > 20) return 'ユーザーIDは20文字以内にしてください'
  return null
}

interface AuthContextValue {
  user: User | null
  profile: Profile | null
  loading: boolean
  signUp: (args: {
    email: string
    password: string
    username: string
    displayName: string
  }) => Promise<{ needsEmailConfirm: boolean }>
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  deleteAccount: () => Promise<void>
  refreshProfile: () => Promise<void>
  isUsernameAvailable: (username: string) => Promise<boolean>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  // 同一ユーザーでのトークン更新で再取得が走らないよう、取得済みIDを覚えておく
  const loadedForId = useRef<string | null>(null)

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      console.warn('[auth] プロフィール取得に失敗', error.message)
      return
    }
    setProfile(data as Profile | null)
    loadedForId.current = userId
  }, [])

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      if (data.session?.user) {
        loadProfile(data.session.user.id).finally(() => active && setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return
      setSession(next)
      const uid = next?.user?.id ?? null

      if (!uid) {
        setProfile(null)
        loadedForId.current = null
        return
      }
      // TOKEN_REFRESHED などで無駄に叩かない
      if (loadedForId.current !== uid) loadProfile(uid)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const isUsernameAvailable = useCallback(async (username: string) => {
    const { data, error } = await supabase.rpc('is_username_available', {
      p_username: username,
    })
    if (error) {
      console.warn('[auth] ユーザーID確認に失敗', error.message)
      return false
    }
    return data === true
  }, [])

  const signUp = useCallback<AuthContextValue['signUp']>(
    async ({ email, password, username, displayName }) => {
      const normalized = username.trim().toLowerCase()

      const formatError = validateUsername(normalized)
      if (formatError) throw new Error(formatError)
      if (!displayName.trim()) throw new Error('アカウント名を入力してください')

      // 事前チェック。ここを通っても同時登録で衝突しうるので、
      // 最終的な一意性は DB の UNIQUE 制約が保証する。
      if (!(await isUsernameAvailable(normalized))) {
        throw new Error('このユーザーIDは既に使われています')
      }

      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        // ここに渡した値を handle_new_user() トリガーが profiles に転記する。
        // メールアドレスは表示名に一切使われない。
        options: { data: { username: normalized, display_name: displayName.trim() } },
      })
      if (error) throw error

      // メール確認が有効な場合、session は null になる
      return { needsEmailConfirm: !data.session }
    },
    [isUsernameAvailable]
  )

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
    loadedForId.current = null
  }, [])

  const deleteAccount = useCallback(async () => {
    const { error } = await supabase.rpc('delete_my_account')
    if (error) throw error
    await supabase.auth.signOut()
    setProfile(null)
    loadedForId.current = null
  }, [])

  const refreshProfile = useCallback(async () => {
    const uid = session?.user?.id
    if (uid) await loadProfile(uid)
  }, [session?.user?.id, loadProfile])

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      profile,
      loading,
      signUp,
      signIn,
      signOut,
      deleteAccount,
      refreshProfile,
      isUsernameAvailable,
    }),
    [session, profile, loading, signUp, signIn, signOut, deleteAccount, refreshProfile, isUsernameAvailable]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth は AuthProvider の内側で使ってください')
  return ctx
}

/** Supabase のエラー文言を日本語に寄せる */
export function toJapaneseAuthError(err: unknown): string {
  const msg = (err as Error)?.message ?? ''
  if (msg.includes('Invalid login credentials')) return 'メールアドレスまたはパスワードが正しくありません'
  if (msg.includes('already registered') || msg.includes('User already registered'))
    return 'このメールアドレスは既に登録されています'
  if (msg.includes('Password should be')) return 'パスワードは6文字以上にしてください'
  if (msg.includes('Email not confirmed')) return 'メールアドレスの確認が済んでいません。受信箱を確認してください'
  if (msg.includes('profiles_username_key') || msg.includes('duplicate key'))
    return 'このユーザーIDは既に使われています'
  if (msg.includes('profiles_username_format'))
    return 'ユーザーIDは小文字のアルファベット3〜20文字にしてください'
  if (msg.includes('rate limit') || msg.includes('Too many'))
    return '試行回数が多すぎます。しばらく待ってからお試しください'
  return msg || 'エラーが発生しました。もう一度お試しください'
}
