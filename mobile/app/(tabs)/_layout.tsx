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

      {/* ファイル名は favorites だが、中身はフォロー中の人の一覧。
          画面の中も「フォロー中 N人」で統一されているので、
          タブの名前もそちらに合わせる。
          （旧ラベルは 'Fav'。ここだけ英語だったうえ、
            「お気に入りの店」と誤解させる名前だった） */}
      <Tabs.Screen
        name="favorites"
        options={{
          title: 'フォロー',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'people' : 'people-outline'} size={24} color={color} />
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
