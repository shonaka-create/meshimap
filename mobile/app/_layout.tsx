import { useEffect } from 'react'
import { View } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { AuthProvider, useAuth } from '../src/hooks/useAuth'
import { useTheme } from '../src/theme'
import { AppLoading } from '../src/components/AppLoading'

function RootNavigator() {
  const { user, loading } = useAuth()
  const { colors, isDark } = useTheme()
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    if (loading) return

    const inAuthGroup = segments[0] === '(auth)'

    if (!user && !inAuthGroup) {
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
