import { useState } from 'react'
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View,
} from 'react-native'
import { Link } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth, toJapaneseAuthError } from '../../src/hooks/useAuth'
import { useTheme, space, radius, shadow } from '../../src/theme'
import { Button, Field, Txt } from '../../src/components/ui'
import { AuthBackdrop, AuthBrand } from '../../src/components/AuthBackdrop'

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
    <AuthBackdrop>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >
            <AuthBrand caption="食の記憶を、地図に残す。" />

            {/* 写真の上に浮かせる紙。ここだけ影を強くして、
                背景から切り離して見せる */}
            <View
              style={[
                styles.card,
                shadow.float,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
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
              <Txt variant="small" style={{ color: 'rgba(255,255,255,0.72)' }}>
                アカウントをお持ちでないですか？
              </Txt>
              <Link href="/(auth)/sign-up" asChild>
                <Pressable hitSlop={8}>
                  <Txt variant="smallMed" style={{ color: '#FFFFFF' }}>新規登録</Txt>
                </Pressable>
              </Link>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </AuthBackdrop>
  )
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, padding: space.xl, justifyContent: 'center' },
  card: {
    marginTop: space.xxl,
    padding: space.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: space.lg,
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
