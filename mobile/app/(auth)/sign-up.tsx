import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, View,
} from 'react-native'
import { Link, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth, toJapaneseAuthError, validateUsername } from '../../src/hooks/useAuth'
import { useTheme, space, radius } from '../../src/theme'
import { Button, Field, Txt } from '../../src/components/ui'

type Availability = 'idle' | 'checking' | 'free' | 'taken' | 'invalid'

export default function SignUp() {
  const { signUp, isUsernameAvailable } = useAuth()
  const { colors } = useTheme()
  const router = useRouter()

  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [agreedContent, setAgreedContent] = useState(false)
  const [agreedAge, setAgreedAge] = useState(false)

  const [availability, setAvailability] = useState<Availability>('idle')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sentConfirmTo, setSentConfirmTo] = useState<string | null>(null)

  const usernameError = username ? validateUsername(username) : null

  // ユーザーIDの空き確認。入力が止まってから問い合わせる。
  const checkSeq = useRef(0)
  useEffect(() => {
    if (!username) { setAvailability('idle'); return }
    if (usernameError) { setAvailability('invalid'); return }

    setAvailability('checking')
    const seq = ++checkSeq.current
    const timer = setTimeout(async () => {
      const free = await isUsernameAvailable(username)
      // 入力が進んでいたら古い結果は捨てる
      if (seq !== checkSeq.current) return
      setAvailability(free ? 'free' : 'taken')
    }, 450)

    return () => clearTimeout(timer)
  }, [username, usernameError, isUsernameAvailable])

  const submit = async () => {
    setError(null)
    setBusy(true)
    try {
      const { needsEmailConfirm } = await signUp({
        email, password, username, displayName,
      })
      if (needsEmailConfirm) {
        setSentConfirmTo(email.trim())
      }
      // 確認不要ならセッションが張られ、RootNavigator がタブへ送る
    } catch (e) {
      setError(toJapaneseAuthError(e))
    } finally {
      setBusy(false)
    }
  }

  /* ── メール確認待ち画面 ─────────────────────────── */
  if (sentConfirmTo) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={styles.confirm}>
          <View style={[styles.mark, { backgroundColor: colors.accentSoft }]}>
            <Txt style={{ fontSize: 34 }}>✉️</Txt>
          </View>
          <Txt variant="title" style={{ marginTop: space.xl, textAlign: 'center' }}>
            確認メールを送りました
          </Txt>
          <Txt variant="body" tone="muted" style={{ marginTop: space.sm, textAlign: 'center' }}>
            {sentConfirmTo} 宛のリンクを開くと登録が完了します。
          </Txt>
          <Button
            title="ログイン画面へ"
            variant="secondary"
            style={{ marginTop: space.xxl, alignSelf: 'stretch' }}
            onPress={() => router.replace('/(auth)/sign-in')}
          />
        </View>
      </SafeAreaView>
    )
  }

  /* ── ユーザーID の状態表示 ─────────────────────── */
  const availabilityNode = {
    idle: null,
    invalid: null,
    checking: <ActivityIndicator size="small" color={colors.textFaint} />,
    free: <Ionicons name="checkmark-circle" size={20} color={colors.geo} />,
    taken: <Ionicons name="close-circle" size={20} color={colors.danger} />,
  }[availability]

  const usernameHint =
    availability === 'taken'
      ? undefined
      : '小文字のアルファベットのみ・3〜20文字。あとから変更できます。'

  const canSubmit =
    !!displayName.trim() && availability === 'free' &&
    !!email.trim() && password.length >= 6
    && agreed && agreedContent && agreedAge && !busy

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Txt variant="display">アカウント作成</Txt>
          <Txt variant="body" tone="muted" style={{ marginTop: space.xs, marginBottom: space.xl }}>
            アカウント名がアプリ上の表示名になります。
          </Txt>

          <View style={{ gap: space.lg }}>
            <Field
              label="アカウント名（表示名）"
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="例: しょうたろう"
              maxLength={30}
              hint="日本語OK。他の人と同じ名前でも登録できます。"
            />

            <Field
              label="ユーザーID"
              value={username}
              // 大文字で打たれても黙って小文字に直す。弾くよりストレスが少ない。
              onChangeText={(v) => setUsername(v.toLowerCase().replace(/[^a-z]/g, ''))}
              placeholder="meshitaro"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={20}
              prefix="@"
              right={availabilityNode}
              error={
                usernameError ??
                (availability === 'taken' ? 'このユーザーIDは既に使われています' : null)
              }
              hint={usernameHint}
            />

            <Field
              label="メールアドレス"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              hint="ログインにのみ使います。他の人には公開されません。"
            />

            <Field
              label="パスワード"
              value={password}
              onChangeText={setPassword}
              placeholder="6文字以上"
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              textContentType="newPassword"
              right={
                <Pressable
                  onPress={() => setShowPassword((v) => !v)}
                  hitSlop={10}
                  accessibilityLabel={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
                >
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={colors.textFaint}
                  />
                </Pressable>
              }
            />

            {/* App Store Guideline 1.2:
              * UGCアプリは「規約への同意」と「不適切な内容への不寛容の明示」が必須。
              * 同意は1つにまとめず分けて取る。まとめると、何に同意したのかが
              * 曖昧になり、審査でも指摘されやすい。 */}
            <View style={{ gap: space.md }}>
              <Check
                checked={agreed}
                onPress={() => setAgreed((v) => !v)}
                colors={colors}
              >
                <Txt variant="small" tone="muted" style={{ flex: 1 }}>
                  <Txt variant="small" tone="accent" onPress={() => router.push('/legal/terms')}>
                    利用規約
                  </Txt>
                  {' と '}
                  <Txt variant="small" tone="accent" onPress={() => router.push('/legal/privacy')}>
                    プライバシーポリシー
                  </Txt>
                  {' に同意します'}
                </Txt>
              </Check>

              <Check
                checked={agreedContent}
                onPress={() => setAgreedContent((v) => !v)}
                colors={colors}
              >
                <Txt variant="small" tone="muted" style={{ flex: 1 }}>
                  不適切な投稿・迷惑行為を行いません。違反した場合、
                  投稿の削除やアカウントの停止に同意します
                </Txt>
              </Check>

              <Check
                checked={agreedAge}
                onPress={() => setAgreedAge((v) => !v)}
                colors={colors}
              >
                <Txt variant="small" tone="muted" style={{ flex: 1 }}>
                  13歳以上です
                </Txt>
              </Check>
            </View>

            {error && (
              <View style={[styles.error, { backgroundColor: colors.dangerSoft }]}>
                <Ionicons name="alert-circle" size={18} color={colors.danger} />
                <Txt variant="small" tone="danger" style={{ flex: 1 }}>{error}</Txt>
              </View>
            )}

            <Button title="登録する" onPress={submit} loading={busy} disabled={!canSubmit} />
          </View>

          <View style={styles.footer}>
            <Txt variant="small" tone="muted">すでにアカウントをお持ちですか？</Txt>
            <Link href="/(auth)/sign-in" asChild>
              <Pressable hitSlop={8}>
                <Txt variant="smallMed" tone="accent">ログイン</Txt>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

/** 同意用のチェック行。同じ見た目を3回書かないための小さな部品 */
function Check({
  checked, onPress, colors, children,
}: {
  checked: boolean
  onPress: () => void
  colors: { accent: string; textFaint: string }
  children: React.ReactNode
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.agreeRow}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <Ionicons
        name={checked ? 'checkbox' : 'square-outline'}
        size={21}
        color={checked ? colors.accent : colors.textFaint}
      />
      {children}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, padding: space.xl, paddingTop: space.xxl },
  confirm: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  mark: {
    width: 76, height: 76, borderRadius: radius.xl,
    alignItems: 'center', justifyContent: 'center',
  },
  agreeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  error: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    padding: space.md, borderRadius: radius.md,
  },
  footer: {
    flexDirection: 'row', justifyContent: 'center',
    alignItems: 'center', gap: space.xs, marginTop: space.xxl,
  },
})
