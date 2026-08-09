'use client'

import { useState, useEffect, useRef } from 'react'
import { useAuthContext } from './AuthProvider'
import { validateUsername } from '@/hooks/useAuth'
import { supabaseUrl } from '@/lib/supabase'
import { Mail, Lock, User, AtSign, Eye, EyeOff } from 'lucide-react'

type Availability = 'idle' | 'checking' | 'free' | 'taken' | 'invalid'

export default function LoginForm() {
  const { signIn, signUp, isUsernameAvailable } = useAuthContext()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [availability, setAvailability] = useState<Availability>('idle')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [verifyMessage, setVerifyMessage] = useState('')
  const checkSeq = useRef(0)

  const usernameError = username ? validateUsername(username) : null

  // ユーザーIDの空き確認。入力が止まってから問い合わせる。
  useEffect(() => {
    if (mode !== 'signup' || !username) { setAvailability('idle'); return }
    if (usernameError) { setAvailability('invalid'); return }

    setAvailability('checking')
    const seq = ++checkSeq.current
    const timer = setTimeout(async () => {
      const free = await isUsernameAvailable(username)
      // 入力が進んでいたら古い結果は捨てる
      if (seq !== checkSeq.current) return
      setAvailability(free ? 'free' : 'taken')
    }, 400)
    return () => clearTimeout(timer)
  }, [mode, username, usernameError, isUsernameAvailable])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'login') {
        await signIn(email, password)
      } else {
        if (!displayName.trim()) { setError('アカウント名を入力してください'); setLoading(false); return }
        const formatError = validateUsername(username)
        if (formatError) { setError(formatError); setLoading(false); return }
        const { needsEmailConfirm } = await signUp({ email, password, username, displayName })
        if (needsEmailConfirm) {
          setVerifyMessage('確認メールを送信しました。メールのリンクをクリックしてログインしてください。')
        }
      }
    } catch (err: unknown) {
      const msg = (err as Error)?.message ?? ''
      if (msg.includes('Invalid login credentials')) {
        setError('メールアドレスまたはパスワードが正しくありません')
      } else if (msg.includes('already registered')) {
        setError('このメールアドレスは既に使用されています')
      } else if (msg.includes('Password should be')) {
        setError('パスワードは6文字以上で入力してください')
      } else if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('fetch failed')) {
        // 接続先の Supabase に届いていない。認証情報の問題と紛らわしいので分けて出す。
        // （過去に、消したプロジェクトの URL を向いたままでこれが出た）
        console.error('[LoginForm] Supabase に接続できません。接続先:', supabaseUrl, err)
        setError('サーバーに接続できませんでした。通信環境をご確認ください')
      } else {
        console.error('[LoginForm] 想定外のログインエラー:', err)
        setError('エラーが発生しました。もう一度お試しください')
      }
    } finally {
      setLoading(false)
    }
  }

  if (verifyMessage) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-rose-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 text-center max-w-sm w-full">
          <div className="text-5xl mb-4">📧</div>
          <h2 className="text-xl font-bold mb-2">メールを確認してください</h2>
          <p className="text-gray-600 text-sm">{verifyMessage}</p>
          <button onClick={() => setVerifyMessage('')} className="mt-6 text-orange-500 text-sm font-medium">
            ログイン画面に戻る
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-rose-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-orange-400 to-rose-500 rounded-2xl shadow-lg mb-4">
            <span className="text-3xl">🍜</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">MeshiMap</h1>
          <p className="text-gray-600 text-sm mt-1">食の思い出を地図に残そう</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="flex rounded-xl bg-gray-100 p-1 mb-6">
            <button onClick={() => setMode('login')} className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${mode === 'login' ? 'bg-white shadow text-gray-900' : 'text-gray-600'}`}>
              ログイン
            </button>
            <button onClick={() => setMode('signup')} className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${mode === 'signup' ? 'bg-white shadow text-gray-900' : 'text-gray-600'}`}>
              新規登録
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5" />
                  <input type="text" placeholder="アカウント名（表示される名前）" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                    maxLength={30}
                    className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 text-sm" required />
                </div>
                <div>
                  <div className="relative">
                    <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5" />
                    <input type="text" placeholder="ユーザーID（例: meshitaro）" value={username}
                      // 大文字で打たれても黙って小文字に直す。弾くよりストレスが少ない。
                      onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z]/g, ''))}
                      autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={20}
                      className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 text-sm" required />
                  </div>
                  <p className={`text-xs mt-1.5 px-1 ${
                    usernameError || availability === 'taken' ? 'text-red-500'
                      : availability === 'free' ? 'text-green-600' : 'text-gray-500'
                  }`}>
                    {usernameError
                      ?? (availability === 'taken' ? 'このユーザーIDは既に使われています'
                        : availability === 'checking' ? '確認中...'
                        : availability === 'free' ? '✓ このユーザーIDは使えます'
                        : '小文字のアルファベット3〜20文字。あとから変更できます。')}
                  </p>
                </div>
              </>
            )}
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5" />
              <input type="email" placeholder="メールアドレス" value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 text-sm" required />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5" />
              <input type={showPassword ? 'text' : 'password'} placeholder="パスワード（6文字以上）" value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-10 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 text-sm" required />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>

            {error && <p className="text-red-500 text-xs text-center">{error}</p>}

            <button type="submit"
              disabled={loading || (mode === 'signup' && (!!usernameError || availability === 'taken' || availability === 'checking'))}
              className="w-full py-3 bg-gradient-to-r from-orange-400 to-rose-500 text-white font-semibold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50">
              {loading ? '処理中...' : mode === 'login' ? 'ログイン' : '登録する'}
            </button>
          </form>
          {/*
            Googleログインは Supabase 側のプロバイダを有効にしていないため、
            押すとエラーになるだけだった。設定する時が来たら
            useAuth の signInWithGoogle はそのまま残してあるので繋ぎ直せばよい。
          */}
        </div>
      </div>
    </div>
  )
}
