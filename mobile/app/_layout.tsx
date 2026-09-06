import { useEffect } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { AuthProvider, useAuth } from '../src/hooks/useAuth'
import { ThemeSettingProvider, useThemeSetting } from '../src/hooks/useThemeSetting'
import { useTheme } from '../src/theme'
import { AppLoading } from '../src/components/AppLoading'
import { HeaderBack } from '../src/components/HeaderBack'

function RootNavigator() {
  const { user, loading } = useAuth()
  // 保存した見た目の設定を読み終える前に描くと、選んだ配色と違う色が
  // 一瞬出てから切り替わる。読み終えるまでは読み込み画面のままにする。
  const { ready: themeReady } = useThemeSetting()
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

    /**
     * ★ 画面を積んだまま入れ替えないこと。
     *
     *   ログアウトは設定画面から呼ばれる。設定は (tabs) の上に
     *   積まれているので、そこで replace すると置き換わるのは
     *   いちばん上の1枚だけで、下にいる (tabs) はそのまま残る。
     *   ログイン画面の裏で、前のアカウントのタブ——地図つき——が
     *   生きたまま動き続けていた。
     *
     *   その状態で別のアカウントに入ると、replace はまた
     *   いちばん上を置き換えるだけなので、スタックが
     *   [(tabs), (tabs)] になる。MapView が2枚同時に生きる。
     *   react-native-maps は新アーキテクチャ(Fabric)に非対応で
     *   互換層越しに動いているため、地図を2枚重ねた時点で落ちる。
     *   「ログアウトして別のアカウントに入った瞬間に落ちる」の正体はこれ。
     *
     *   積んである画面を全部畳んでから入れ替える。こうすれば
     *   前のアカウントの画面は確実に外れ、スタックは常に1枚で済む。
     */
    const resetTo = (href: '/(auth)/sign-in' | '/(tabs)') => {
      if (router.canDismiss()) router.dismissAll()
      router.replace(href)
    }

    if (!user && !inPublicGroup) {
      resetTo('/(auth)/sign-in')
    } else if (user && inAuthGroup) {
      resetTo('/(tabs)')
    }
  }, [user, loading, segments, router])

  if (loading || !themeReady) {
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
        <Stack.Screen name="user/[username]" options={{ title: '' }} />
        {/* 画面側で「◯◯ のフォロワー」に差し替える */}
        <Stack.Screen name="follows" options={{ title: 'フォロー' }} />
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
        {/* 見た目の設定は、ログインしていなくても効く必要がある
            （ログイン画面もこの配色で描く）。Auth より外に置く。 */}
        <ThemeSettingProvider>
          <AuthProvider>
            <RootNavigator />
          </AuthProvider>
        </ThemeSettingProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
