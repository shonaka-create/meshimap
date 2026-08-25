import { Pressable, StyleSheet, View } from 'react-native'
import { Tabs, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme, space, radius, shadow } from '../../src/theme'

/** 中央の投稿ボタン。タブではなくモーダルを開くので Pressable で差し替える。 */
function PostButton() {
  const { colors } = useTheme()
  const router = useRouter()

  return (
    <Pressable
      onPress={() => router.push('/post/new')}
      accessibilityRole="button"
      accessibilityLabel="新しい投稿を作成"
      style={({ pressed }) => [
        styles.postBtn,
        shadow.float,
        { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <Ionicons name="add" size={28} color={colors.accentText} />
    </Pressable>
  )
}

export default function TabsLayout() {
  const { colors } = useTheme()

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 88,
          paddingTop: space.sm,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'ホーム',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'map' : 'map-outline'} size={24} color={color} />
          ),
        }}
      />

      {/* 旧「フォロー」タブ（favorites.tsx）を置き換えた枠。
          地図に同時に出せるのは無料で2人まで（移行0013）なので、
          1画面を使って最大2行のリストを出していたことになる。
          しかも空のときの導線は「検索を開く」で、検索タブと役目が重なっていた。
          フォロー中の人へは 地図のピン・検索のアカウント・プロフィール から行ける。
          フォローリクエストの確認は設定（settings/index）に元からある。 */}
      <Tabs.Screen
        name="pick"
        options={{
          title: 'おすすめ',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'compass' : 'compass-outline'} size={24} color={color} />
          ),
        }}
      />

      {/* 中央: 投稿。tabBarButton を差し替えてモーダルを開く */}
      <Tabs.Screen
        name="post-placeholder"
        options={{
          title: '',
          tabBarButton: () => (
            <View style={styles.postSlot}>
              <PostButton />
            </View>
          ),
        }}
      />

      <Tabs.Screen
        name="search"
        options={{
          title: '検索',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'search' : 'search-outline'} size={24} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: 'プロフィール',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={24} color={color} />
          ),
        }}
      />
    </Tabs>
  )
}

const styles = StyleSheet.create({
  postSlot: { flex: 1, alignItems: 'center', justifyContent: 'flex-start' },
  postBtn: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.xs,
  },
})
