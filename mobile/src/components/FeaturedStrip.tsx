import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { supabase } from '../lib/supabase'
import { useTheme, space, radius, GENRE_EMOJI } from '../theme'
import { Txt } from './ui'
import { POST_SELECT, toPost } from '../lib/posts'
import { formatImpressions } from '../lib/impressions'
import type { Post } from '../lib/types'

/**
 * 「いま注目のお店」の横並び。
 *
 * 何のために置くか:
 *   検索や提案が0件で終わると、画面が行き止まりになる。
 *   探し方を変えろと言われても、何に変えればいいのかは分からない。
 *   そこで、条件に関係なく「いま実際に見られている店」を出して、
 *   押せるものが必ず残っている状態にする。
 *
 * ★ 並びは featured_post_ids（移行0008/0009）そのまま。
 *   注目のお店の画面（app/featured.tsx）と同じ RPC を呼んでいるので、
 *   どこから見ても同じ順番になる。ここで別の並びを作らないこと。
 *
 * 無料のうちは RPC 側が free_featured_rows() 件しか返さない。
 * 足りない分は「すべて見る」から注目のお店の画面へ送る。
 * あちらに購入の導線と残り件数の表示が既にある。
 */
export function FeaturedStrip({
  title = 'いま注目のお店',
  note,
}: { title?: string; note?: string }) {
  const { colors } = useTheme()
  const router = useRouter()
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data: ids, error } = await supabase.rpc('featured_post_ids', { p_limit: 12 })
    if (error) {
      console.warn('[featured-strip] 取得に失敗', error.message)
      setLoading(false)
      return
    }

    const order = (ids ?? []) as { post_id: string }[]
    if (order.length === 0) {
      setLoading(false)
      return
    }

    // 中身は通常の select で取り直す（RLS を二重に確認しないため）。
    // app/featured.tsx と同じ手順。
    const { data, error: postsError } = await supabase
      .from('posts')
      .select(POST_SELECT)
      .in('id', order.map((o) => o.post_id))

    if (postsError) {
      console.warn('[featured-strip] 投稿の取得に失敗', postsError.message)
    } else {
      const rank = new Map(order.map((o, i) => [o.post_id, i]))
      setPosts(
        (data ?? [])
          .map(toPost)
          .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
      )
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // 読み込み中と0件は何も出さない。
  // 「注目のお店：なし」という枠だけが残ると、行き止まりが2つになる。
  if (loading || posts.length === 0) return null

  return (
    <View style={[styles.wrap, { borderTopColor: colors.border }]}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Txt variant="heading">{title}</Txt>
          {note && <Txt variant="small" tone="faint">{note}</Txt>}
        </View>
        <Pressable
          onPress={() => router.push('/featured')}
          style={({ pressed }) => [styles.more, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Txt variant="smallMed" tone="accent">すべて見る</Txt>
          <Ionicons name="chevron-forward" size={15} color={colors.accent} />
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {posts.map((p) => (
          <Pressable
            key={p.id}
            onPress={() => router.push({ pathname: '/post/[id]', params: { id: p.id } })}
            accessibilityRole="button"
            accessibilityLabel={`${p.location_name} の投稿を開く`}
            style={({ pressed }) => [styles.card, { opacity: pressed ? 0.75 : 1 }]}
          >
            {p.images[0] ? (
              <Image
                source={{ uri: p.images[0] }}
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
                <Txt style={{ fontSize: 26 }}>{GENRE_EMOJI[p.genre] ?? '🍴'}</Txt>
              </View>
            )}

            <Txt variant="caption" tone="faint" numberOfLines={1}>
              {[p.prefecture, p.area ?? p.city].filter(Boolean).join(' · ')}
            </Txt>
            <Txt variant="smallMed" numberOfLines={2}>{p.location_name}</Txt>
            <View style={styles.meta}>
              <Ionicons name="eye-outline" size={12} color={colors.textMuted} />
              <Txt variant="caption" tone="muted">
                {formatImpressions(p.impressions_count)}
              </Txt>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: space.lg,
    paddingBottom: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: space.md,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
  },
  more: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  row: { paddingHorizontal: space.lg, gap: space.md },
  card: { width: 150, gap: 3 },
  thumb: { width: 150, height: 110, borderRadius: radius.sm, marginBottom: space.xs },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 1 },
})
