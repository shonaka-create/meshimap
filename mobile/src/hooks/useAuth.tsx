import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase, startAuthAutoRefresh } from '../lib/supabase'
import { containsProhibitedContent, PROHIBITED_CONTENT_MESSAGE } from '../lib/moderation'
import { removeMyStorageFiles } from '../lib/storageCleanup'
import type { Profile } from '../lib/types'

/**
 * 退会の途中で「写真だけ消せなかった」ときのしるし。
 *
 * ★ 文字列で判定しているのは、画面側で文言を出し分けるため。
 *   ここを変えるときは settings/index.tsx も一緒に直すこと。
 */
export const PHOTO_CLEANUP_FAILED = 'photo_cleanup_failed'

/** ユーザーIDの空き確認の結果。'unknown' は確かめられなかった、の意 */
export type UsernameCheck = 'free' | 'taken' | 'unknown'

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
  /**
   * 退会する。
   *
   * 写真の実体を消してから RPC を叩く。消せなかった場合は
   * PHOTO_CLEANUP_FAILED を投げて一度止まる。呼び出し元が
   * 本人に確認して evenIfPhotosRemain を立てれば、そのまま進む。
   */
  deleteAccount: (opts?: { evenIfPhotosRemain?: boolean }) => Promise<void>
  /**
   * プロフィールを取り直す。
   * ★ 取れたかどうかを返す。呼び出し元が「失敗した」と分かる必要がある
   *   （投稿完了画面は、この数字を成果として見せるため）。
   */
  refreshProfile: () => Promise<boolean>
  /**
   * ユーザーIDが空いているか。
   *
   * ★ 「空いていない」と「確かめられなかった」を分けること。
   *   まとめて false にすると、圏外で登録しようとした人に
   *   「このユーザーIDは既に使われています」と出る。
   *   何度打ち直しても同じなので、そこで詰む。
   */
  isUsernameAvailable: (username: string) => Promise<UsernameCheck>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  // 同一ユーザーでのトークン更新で再取得が走らないよう、取得済みIDを覚えておく
  const loadedForId = useRef<string | null>(null)

  /**
   * プロフィールを取り込む。
   *
   * ★ 失敗を握りつぶさず、取れたかどうかを返すこと。
   *   ここで黙って resolve すると、呼び出し元は「取れた」と
   *   区別が付かない。投稿完了画面はそれで、投稿前の古い数字を
   *   今回の成果として出していた（増分 0・ランクアップ無し）。
   */
  const loadProfile = useCallback(async (userId: string): Promise<boolean> => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      console.warn('[auth] プロフィール取得に失敗', error.message)
      return false
    }
    setProfile(data as Profile | null)
    loadedForId.current = userId
    return true
  }, [])

  useEffect(() => {
    let active = true

    // AppState への登録はここで行う。モジュール直下でやると
    // バンドル評価中にネイティブを叩くことになり、起動が不安定になる。
    const stopAutoRefresh = startAuthAutoRefresh()

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
      stopAutoRefresh()
    }
  }, [loadProfile])

  const isUsernameAvailable = useCallback<AuthContextValue['isUsernameAvailable']>(
    async (username) => {
      const { data, error } = await supabase.rpc('is_username_available', {
        p_username: username,
      })
      if (error) {
        console.warn('[auth] ユーザーID確認に失敗', error.message)
        return 'unknown'
      }
      return data === true ? 'free' : 'taken'
    },
    []
  )

  const signUp = useCallback<AuthContextValue['signUp']>(
    async ({ email, password, username, displayName }) => {
      const normalized = username.trim().toLowerCase()

      const formatError = validateUsername(normalized)
      if (formatError) throw new Error(formatError)
      if (!displayName.trim()) throw new Error('アカウント名を入力してください')

      // アカウント名は投稿しなくても他の人から見えるので、
      // 登録の時点で見る（Guideline 1.2）。画面ではなくここに置いたのは、
      // 登録の入口をこの関数1つに絞ってあるため。
      if (containsProhibitedContent(displayName)) {
        throw new Error(PROHIBITED_CONTENT_MESSAGE)
      }

      // 事前チェック。ここを通っても同時登録で衝突しうるので、
      // 最終的な一意性は DB の UNIQUE 制約が保証する
      // （profiles_username_key / 0001）。
      //
      // ★ 確かめられなかった場合は止めないこと。
      //   ここで止めると、通信が悪いだけで登録できなくなる。
      //   空いていなければ handle_new_user()（0005）の INSERT が
      //   UNIQUE 制約で落ち、サインアップごと失敗する。
      //   ＝勝手に別のIDが割り当てられることはない。
      //   （0001 版には衝突時に採番し直す WHILE ループがあったが、
      //     0005 で置き換えたときに外れている）
      const availability = await isUsernameAvailable(normalized)
      if (availability === 'taken') {
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

  const deleteAccount = useCallback<AuthContextValue['deleteAccount']>(
    async ({ evenIfPhotosRemain = false } = {}) => {
      // ★ 写真の実体を先に消すこと。
      //   delete_my_account() は auth.users を消すだけで、
      //   Storage のオブジェクトは残る（public バケットなので
      //   URL を控えていれば退会後も開ける）。
      //   そして先にアカウントを消すとトークンが無効になり、
      //   Storage のポリシーで弾かれて二度と消せなくなる。
      //
      // ★ 消せなかったときに黙って進めないこと。
      //   進めた瞬間に、その写真は誰にも消せない公開ファイルになる。
      //   一度止めて本人に伝え、それでも退会するなら通す
      //   （消せないから退会できない、では Guideline 5.1.1(v) を満たさない）。
      const uid = session?.user?.id
      if (uid) {
        const { failed } = await removeMyStorageFiles(uid)
        if (failed.length > 0 && !evenIfPhotosRemain) {
          console.warn('[auth] 退会時に消せなかったバケット', failed.join(', '))
          throw new Error(PHOTO_CLEANUP_FAILED)
        }
      }

      const { error } = await supabase.rpc('delete_my_account')
      if (error) throw error
      await supabase.auth.signOut()
      setProfile(null)
      loadedForId.current = null
    },
    [session?.user?.id]
  )

  const refreshProfile = useCallback(async () => {
    const uid = session?.user?.id
    if (!uid) return false
    return loadProfile(uid)
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
  // ★ Supabase は、サインアップのトリガーが落ちたことを
  //   この一文にまとめて返す。制約名までは降りてこない。
  //   ここに来る現実的な原因は username の重複なので、そう案内する
  //   （空き確認を通せなかったまま登録した人がここに来る）。
  if (msg.includes('Database error saving new user'))
    return 'アカウントを作れませんでした。ユーザーIDが既に使われている可能性があります。別のIDでお試しください'
  if (msg.includes('profiles_username_format'))
    return 'ユーザーIDは小文字のアルファベット3〜20文字にしてください'
  if (msg.includes('rate limit') || msg.includes('Too many'))
    return '試行回数が多すぎます。しばらく待ってからお試しください'
  return msg || 'エラーが発生しました。もう一度お試しください'
}
