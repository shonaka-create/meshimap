import { useCallback, useState } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../../src/lib/supabase'
import { useAuth } from '../../src/hooks/useAuth'
import { useTheme, space, radius } from '../../src/theme'
import { Button, EmptyState, Loading, Txt } from '../../src/components/ui'
import { RankAvatar } from '../../src/components/RankAvatar'
import type { Profile } from '../../src/lib/types'

interface FollowingRow extends Pick<
  Profile,
  'id' | 'username' | 'display_name' | 'photo_url' | 'avatar_emoji'
  | 'bio' | 'posts_count' | 'areas_count' | 'is_public'
> {}

export default function Favorites() {
  const { user } = useAuth()
  const { colors } = useTheme()
  const router = useRouter()

  const [following, setFollowing] = useState<FollowingRow[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!user) return

    // フォロー中（承認済み）のプロフィールを取得
    const { data, error } = await supabase
      .from('follows')
      .select(
        'following_id, profiles!follows_following_id_fkey(id, username, display_name, photo_url, avatar_emoji, bio, posts_count, areas_count, is_public)'
      )
      .eq('follower_id', user.id)
      .eq('status', 'accepted')
      .order('created_at', { ascending: false })

    if (error) {
      console.warn('[fav] フォロー一覧の取得に失敗', error.message)
    } else {
      const rows = (data ?? [])
        .map((r: any) => r.profiles)
        .filter(Boolean) as FollowingRow[]
      setFollowing(rows)
    }

    // 自分宛の承認待ちリクエスト数
    const { count } = await supabase
      .from('follows')
      .select('follower_id', { count: 'exact', head: true })
      .eq('following_id', user.id)
      .eq('status', 'pending')
    setPendingCount(count ?? 0)

    setLoading(false)
  }, [user])

  // タブに戻るたびに最新化する
  useFocusEffect(useCallback(() => { load() }, [load]))

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <Loading />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.header}>
        <Txt variant="display">フォロー</Txt>
        <Txt variant="small" tone="muted">{following.length}人</Txt>
      </View>

      {pendingCount > 0 && (
        <Pressable
          onPress={() => router.push('/settings/requests')}
          style={({ pressed }) => [
            styles.requests,
            { backgroundColor: colors.accentSoft, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Ionicons name="person-add" size={18} color={colors.accent} />
          <Txt variant="smallMed" tone="accent" style={{ flex: 1 }}>
            {pendingCount}件のフォローリクエスト
          </Txt>
          <Ionicons name="chevron-forward" size={16} color={colors.accent} />
        </Pressable>
      )}

      <FlatList
        data={following}
        keyExtractor={(item) => item.id}
        contentContainerStyle={
          following.length === 0 ? { flexGrow: 1 } : { paddingBottom: space.xxl }
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
        ListEmptyComponent={
          /* 「人を探す」は人探し（行方不明者）に読めるので、
             行き先そのものを名乗らせる。押した先はタブ名も「検索」で、
             言葉が一致していると迷いが減る。 */
          <EmptyState
            emoji="👥"
            title="まだ誰もフォローしていません"
            body="検索タブから気になる人を見つけてフォローすると、ここに並びます。"
            action={<Button title="検索を開く" onPress={() => router.push('/(tabs)/search')} />}
          />
        }
        renderItem={({ item }) => (
          <Pressable
            // 自分のプロフィールタブには行かず、その人のページへ直接遷移する
            onPress={() => router.push(`/user/${item.username}`)}
            style={({ pressed }) => [
              styles.row,
              { borderBottomColor: colors.border, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <RankAvatar
              uri={item.photo_url}
              emoji={item.avatar_emoji}
              name={item.display_name}
              postsCount={item.posts_count}
              areasCount={item.areas_count}
              size={52}
            />

            <View style={{ flex: 1, gap: 1 }}>
              <View style={styles.nameRow}>
                <Txt variant="bodyMed" numberOfLines={1}>{item.display_name}</Txt>
                {!item.is_public && (
                  <Ionicons name="lock-closed" size={12} color={colors.textFaint} />
                )}
              </View>
              <Txt variant="small" tone="faint" numberOfLines={1}>@{item.username}</Txt>
              {!!item.bio && (
                <Txt variant="small" tone="muted" numberOfLines={1}>{item.bio}</Txt>
              )}
            </View>

            <View style={{ alignItems: 'flex-end' }}>
              <Txt variant="smallMed">{item.posts_count}</Txt>
              <Txt variant="caption" tone="faint">投稿</Txt>
            </View>

            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </Pressable>
        )}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md, gap: 2 },
  requests: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginBottom: space.md,
    padding: space.md,
    borderRadius: radius.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
})
