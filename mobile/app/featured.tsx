import { useCallback, useState } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { supabase } from '../src/lib/supabase'
import { useTheme, space, radius, GENRE_EMOJI } from '../src/theme'
import { EmptyState, Loading, Txt } from '../src/components/ui'
import { POST_SELECT, toPost } from '../src/lib/posts'
import {
  FEATURED_THRESHOLD, FEATURED_WINDOW_DAYS, formatImpressions,
} from '../src/lib/impressions'
import { BILLING_READY, FREE_FEATURED_ROWS } from '../src/lib/billing'
import type { Post } from '../src/lib/types'

/**
 * 注目のお店。
 *
 * 「編集部のおすすめ」ではなく、直近で実際に見られた数で自動的に並ぶ。
 * 誰かが推したものではないので、順番の理由を説明できる。
 *
 * 無料では先頭数件だけ返る（DB側で絞っている）。
 * 全体の件数は別に取って、あと何件あるのかを見せる。
 * 数が分からないまま鍵をかけると、買うかどうかの判断ができない。
 */
export default function Featured() {
  const { colors } = useTheme()
  const router = useRouter()

  const [posts, setPosts] = useState<Post[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    const [ids, count] = await Promise.all([
      supabase.rpc('featured_post_ids', { p_limit: 100 }),
      supabase.rpc('featured_post_total'),
    ])

    if (ids.error) {
      console.warn('[featured] 取得に失敗', ids.error.message)
      setPosts([])
      setLoading(false)
      return
    }

    const order = (ids.data ?? []) as { post_id: string }[]
    setTotal(typeof count.data === 'number' ? count.data : order.length)

    if (order.length === 0) {
      setPosts([])
      setLoading(false)
      return
    }

    // 投稿の中身は通常の select で取り直す。
    // RPC の戻り値に写真や投稿者を詰めると RLS を二重に確認することになり、
    // 非公開の投稿が漏れる事故が起きやすい。
    const { data, error } = await supabase
      .from('posts')
      .select(POST_SELECT)
      .in('id', order.map((o) => o.post_id))

    if (error) {
      console.warn('[featured] 投稿の取得に失敗', error.message)
      setPosts([])
    } else {
      // .in は順序を保たないので、RPC が返した順に並べ直す
      const rank = new Map(order.map((o, i) => [o.post_id, i]))
      setPosts(
        (data ?? [])
          .map(toPost)
          .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
      )
    }
    setLoading(false)
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  const truncated = total > posts.length

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ title: '注目のお店' }} />
        <View style={{ flex: 1, backgroundColor: colors.bg }}><Loading /></View>
      </>
    )
  }

  return (
    <>
      <Stack.Screen options={{ title: '注目のお店' }} />
      <FlatList
        style={{ flex: 1, backgroundColor: colors.bg }}
        data={posts}
        keyExtractor={(p) => p.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
        ListHeaderComponent={
          <View style={styles.head}>
            <Txt variant="caption" tone="faint" style={{ letterSpacing: 2 }}>NOW</Txt>
            <Txt variant="small" tone="muted">
              直近{FEATURED_WINDOW_DAYS}日で{FEATURED_THRESHOLD}人以上に見られた公開投稿です。
              見られなくなれば自動的に外れます。
            </Txt>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            emoji="🔥"
            title="いまは注目の投稿がありません"
            body={`直近${FEATURED_WINDOW_DAYS}日で${FEATURED_THRESHOLD}人以上に見られた投稿がここに並びます。`}
          />
        }
        ListFooterComponent={
          !truncated ? null : !BILLING_READY ? (
            /* ★ ranking.tsx と同じ理由。買えないものを
                 「プレミアムで見られます」と出さない。 */
            <View
              style={[
                styles.lock,
                { borderColor: colors.border, backgroundColor: colors.surfaceAlt },
              ]}
            >
              <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
              <Txt variant="small" tone="muted" style={{ flex: 1 }}>
                いまは{FREE_FEATURED_ROWS}件までを表示しています。
              </Txt>
            </View>
          ) : (
            <Pressable
              onPress={() => router.push('/settings/subscription')}
              style={({ pressed }) => [
                styles.lock,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.surfaceAlt,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <Ionicons name="lock-closed" size={18} color={colors.textMuted} />
              <View style={{ flex: 1 }}>
                <Txt variant="smallMed">
                  残り{total - posts.length}件は、プレミアムで見られます
                </Txt>
                <Txt variant="small" tone="muted">
                  無料で見えるのは{FREE_FEATURED_ROWS}件までです
                </Txt>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
            </Pressable>
          )
        }
        renderItem={({ item, index }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/post/[id]', params: { id: item.id } })}
            style={({ pressed }) => [
              styles.row,
              { borderBottomColor: colors.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            {item.images[0] ? (
              <Image
                source={{ uri: item.images[0] }}
                style={[styles.thumb, { backgroundColor: colors.surfaceAlt }]}
                contentFit="cover"
                transition={120}
              />
            ) : (
              <View
                style={[
                  styles.thumb,
                  { backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
                ]}
              >
                <Txt style={{ fontSize: 26 }}>{GENRE_EMOJI[item.genre] ?? '🍴'}</Txt>
              </View>
            )}

            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="caption" tone="faint" numberOfLines={1}>
                {[item.prefecture, item.area ?? item.city].filter(Boolean).join(' · ')}
              </Txt>
              <Txt variant="bodyMed" numberOfLines={1}>{item.location_name}</Txt>
              <View style={styles.meta}>
                <Ionicons name="eye-outline" size={13} color={colors.textMuted} />
                <Txt variant="small" tone="muted">
                  {formatImpressions(item.impressions_count)}
                </Txt>
                <Txt variant="small" tone="faint">·</Txt>
                <Txt variant="small" tone="muted">
                  {GENRE_EMOJI[item.genre] ?? '🍴'} {item.genre}
                </Txt>
              </View>
            </View>

            <Txt variant="title" tone="faint" style={styles.pos}>{index + 1}</Txt>
          </Pressable>
        )}
      />
    </>
  )
}

const styles = StyleSheet.create({
  head: { padding: space.lg, gap: space.xs },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.lg, paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  thumb: { width: 68, height: 68, borderRadius: radius.sm },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  pos: { minWidth: 28, textAlign: 'right' },
  lock: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    margin: space.lg, padding: space.md,
    borderWidth: 1, borderRadius: radius.md,
  },
})
