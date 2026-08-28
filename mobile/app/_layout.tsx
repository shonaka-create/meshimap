import { useEffect } from 'react'
import { View } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { AuthProvider, useAuth } from '../src/hooks/useAuth'
import { useTheme } from '../src/theme'
import { AppLoading } from '../src/components/AppLoading'
import { HeaderBack } from '../src/components/HeaderBack'

function RootNavigator() {
  const { user, loading } = useAuth()
  const { colors, isDark } = useTheme()
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    if (loading) return

    const inAuthGroup = segments[0] === '(auth)'

    /**
     * ★ ログイン前でも開ける画面を、ここに必ず含めること。
     *
     *   規約とプライバシーポリシーは「アカウントを作る前に読むもの」で、
     *   新規登録画面から開く導線がある。それを '(auth)' かどうかだけで
     *   判定していたため、規約を開いた瞬間に segments[0] が 'legal' になり、
     *   未ログイン扱いでログイン画面へ引き戻していた。
     *   入力中のフォームごと消えるので、規約を読もうとすると
     *   登録がやり直しになる（App Review の Guideline 2.1 の指摘）。
     */
    const inPublicGroup = inAuthGroup || segments[0] === 'legal'

    if (!user && !inPublicGroup) {
      router.replace('/(auth)/sign-in')
    } else if (user && inAuthGroup) {
      router.replace('/(tabs)')
    }
  }, [user, loading, segments, router])

  if (loading) {
    return (
      <>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <AppLoading />
      </>
    )
  }

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShadowVisible: false,
          // 戻るボタンは自前のものに差し替える。
          //
          // iOS の native-stack は、指定が無いと「ひとつ前の画面の title」を
          // 矢印の横に出す。タブ画面には title を持たせていないので、
          // ルート名がそのまま出て「tabs」という文字が見えていた。
          // それを消す（'minimal'）と、今度は矢印の幅しか押せなくなり、
          // ラベルが出ていたあたりを押しても反応しない状態になっていた。
          //
          // HeaderBack は 44x44 を確保する（Apple のヒットターゲットの下限）。
          // 標準の矢印と二重に出ないよう headerBackVisible は false。
          headerBackButtonDisplayMode: 'minimal',
          headerBackVisible: false,
          headerLeft: () => <HeaderBack />,
          // 端からのスワイプでも戻れること。ボタンが1つしか無い状態で
          // そこが効かないと、その画面から出られなくなる。既定値だが、
          // 戻る手段は2つとも明示して残しておく。
          gestureEnabled: true,
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontSize: 17, fontWeight: '600' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="post/new"
          options={{ presentation: 'modal', title: '新しい投稿' }}
        />
        <Stack.Screen name="post/[id]" options={{ title: '' }} />
        <Stack.Screen name="pick/results" options={{ title: 'おすすめ' }} />
        <Stack.Screen name="ranking" options={{ title: '今月のランキング' }} />
        <Stack.Screen name="featured" options={{ title: '注目のお店' }} />
        <Stack.Screen name="user/[username]" options={{ title: '' }} />
        <Stack.Screen name="settings/index" options={{ title: '設定' }} />
        <Stack.Screen name="settings/edit-profile" options={{ title: 'プロフィールを編集' }} />
        <Stack.Screen name="settings/blocked" options={{ title: 'ブロックしたアカウント' }} />
        <Stack.Screen name="settings/requests" options={{ title: 'フォロー リクエスト' }} />
        <Stack.Screen name="legal/terms" options={{ title: '利用規約' }} />
        <Stack.Screen name="legal/privacy" options={{ title: 'プライバシーポリシー' }} />
      </Stack>
    </>
  )
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
