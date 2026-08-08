import { useState } from 'react'
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View,
} from 'react-native'
import { Link } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth, toJapaneseAuthError } from '../../src/hooks/useAuth'
import { useTheme, space, radius } from '../../src/theme'
import { Button, Field, Txt } from '../../src/components/ui'

export default function SignIn() {
  const { signIn } = useAuth()
  const { colors } = useTheme()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setError(null)
    setBusy(true)
    try {
      await signIn(email, password)
      // 成功時のルート切り替えは app/_layout.tsx の RootNavigator が行う
    } catch (e) {
      setError(toJapaneseAuthError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.brand}>
            <View style={[styles.mark, { backgroundColor: colors.accentSoft }]}>
              <Txt style={{ fontSize: 34 }}>🍜</Txt>
            </View>
            <Txt variant="display" style={{ marginTop: space.lg }}>MeshiMap</Txt>
            <Txt variant="body" tone="muted" style={{ marginTop: space.xs }}>
              食の記憶を、地図に残す。
            </Txt>
          </View>

          <View style={{ gap: space.lg }}>
            <Field
              label="メールアドレス"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
            />

            <Field
              label="パスワード"
              value={password}
              onChangeText={setPassword}
              placeholder="6文字以上"
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoComplete="current-password"
              textContentType="password"
              onSubmitEditing={submit}
              returnKeyType="go"
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

            {error && (
              <View style={[styles.error, { backgroundColor: colors.dangerSoft }]}>
                <Ionicons name="alert-circle" size={18} color={colors.danger} />
                <Txt variant="small" tone="danger" style={{ flex: 1 }}>{error}</Txt>
              </View>
            )}

            <Button
              title="ログイン"
              onPress={submit}
              loading={busy}
              disabled={!email.trim() || !password}
            />
          </View>

          <View style={styles.footer}>
            <Txt variant="small" tone="muted">アカウントをお持ちでないですか？</Txt>
            <Link href="/(auth)/sign-up" asChild>
              <Pressable hitSlop={8}>
                <Txt variant="smallMed" tone="accent">新規登録</Txt>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, padding: space.xl, justifyContent: 'center' },
  brand: { alignItems: 'center', marginBottom: space.xxxl },
  mark: {
    width: 76, height: 76, borderRadius: radius.xl,
    alignItems: 'center', justifyContent: 'center',
  },
  error: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    padding: space.md, borderRadius: radius.md,
  },
  footer: {
    flexDirection: 'row', justifyContent: 'center',
    alignItems: 'center', gap: space.xs, marginTop: space.xxl,
  },
})
