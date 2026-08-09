import { useCallback, useRef, useState } from 'react'
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet,
  useWindowDimensions, View,
} from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { supabase } from '../../src/lib/supabase'
import { useAuth } from '../../src/hooks/useAuth'
import { useTheme, space, radius, GENRE_EMOJI, SITUATION_EMOJI } from '../../src/theme'
import { Avatar, EmptyState, Loading, Txt } from '../../src/components/ui'
import { POST_SELECT, toPost } from '../../src/lib/posts'
import { openDirections, openInMaps } from '../../src/lib/maps'
import {
  FEATURED_WINDOW_DAYS, formatImpressions, isFeatured, recordImpression,
} from '../../src/lib/impressions'
import type { Post } from '../../src/lib/types'

/**
 * 投稿の詳細。
 *
 * 地図のプレビューシートは「これは何の店か」を1秒で判断させるためのもので、
 * キャプションは3行で切れ、写真もサムネイルしか出ない。
 * 店を決めた後に読みたい情報（全文・大きな写真・誰が何と言っているか）は
 * 行き場がなかったので、この画面を置いた。
 */
export default function PostDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { user } = useAuth()
  const { colors } = useTheme()
  const { width } = useWindowDimensions()
  const router = useRouter()

  const [post, setPost] = useState<Post | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [imageIndex, setImageIndex] = useState(0)

  const [liked, setLiked] = useState(false)
  const [likes, setLikes] = useState(0)
  const [liking, setLiking] = useState(false)

  const [impressions, setImpressions] = useState(0)

  /**
   * 表示回数を記録した投稿。
   *
   * この画面は useFocusEffect で読み直すので、他の画面から戻るたびに
   * 走ってしまう。DB側でも1人1日1回に丸めているが、
   * 意味のない往復は減らしておく。
   */
  const counted = useRef<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)

    // RLS が非公開投稿を弾くので、見えなければ 0 行で返る。
    const { data, error } = await supabase
      .from('posts')
      .select(POST_SELECT)
      .eq('id', id)
      .maybeSingle()

    if (error) {
      console.warn('[post] 取得に失敗', error.message)
      setNotFound(true)
      setLoading(false)
      return
    }
    if (!data) {
      setNotFound(true)
      setLoading(false)
      return
    }

    const p = toPost(data)
    setPost(p)
    setLikes(p.likes_count ?? 0)
    setImpressions(p.impressions_count ?? 0)

    // 表示回数を数える。
    // 数える条件（公開投稿・投稿者以外・1人1日1回）はDB側で見ているので、
    // ここでは「同じ画面で何度も呼ばない」ことだけ気にする。
    if (counted.current !== p.id) {
      counted.current = p.id
      recordImpression(p.id).then((n) => {
        if (n !== null) setImpressions(n)
      })
    }

    if (user) {
      const { data: mine } = await supabase
        .from('likes')
        .select('post_id')
        .eq('post_id', p.id)
        .eq('user_id', user.id)
        .maybeSingle()
      setLiked(!!mine)
    }
    setLoading(false)
  }, [id, user])

  useFocusEffect(useCallback(() => { load() }, [load]))

  /**
   * いいね。
   * posts.likes_count は DB トリガー trg_like_counts が likes 行の
   * INSERT / DELETE で増減させる。ここで足すと1回で2動くので触らない。
   */
  const toggleLike = useCallback(async () => {
    if (!user || !post || liking) return
    setLiking(true)

    const next = !liked
    setLiked(next)
    setLikes((n) => Math.max(0, n + (next ? 1 : -1)))

    try {
      if (next) {
        const { error } = await supabase
          .from('likes')
          .upsert({ post_id: post.id, user_id: user.id },
            { onConflict: 'post_id,user_id', ignoreDuplicates: true })
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('likes').delete().eq('post_id', post.id).eq('user_id', user.id)
        if (error) throw error
      }
      // 他の人のいいねも反映したいので確定値を取り直す
      const { data: fresh } = await supabase
        .from('posts').select('likes_count').eq('id', post.id).single()
      if (fresh) setLikes((fresh.likes_count as number) ?? 0)
    } catch {
      setLiked(!next)
      setLikes((n) => Math.max(0, n + (next ? -1 : 1)))
    } finally {
      setLiking(false)
    }
  }, [user, post, liked, liking])

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Stack.Screen options={{ title: '' }} />
        <Loading />
      </View>
    )
  }

  if (notFound || !post) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Stack.Screen options={{ title: '' }} />
        <EmptyState
          emoji="🔒"
          title="この投稿は表示できません"
          body="削除されたか、公開されていない投稿です。"
        />
      </View>
    )
  }

  const area = post.area ?? post.city ?? post.prefecture ?? ''

  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ paddingBottom: space.xxxl }}
      >
        {/* ── 写真。角丸なしの全幅で、雑誌の見開きのように置く ───── */}
        {post.images.length > 0 && (
          <View>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) =>
                setImageIndex(Math.round(e.nativeEvent.contentOffset.x / width))
              }
            >
              {post.images.map((uri) => (
                <Image
                  key={uri}
                  source={{ uri }}
                  style={{ width, height: width, backgroundColor: colors.surfaceAlt }}
                  contentFit="cover"
                  transition={180}
                />
              ))}
            </ScrollView>

            {post.images.length > 1 && (
              <View style={styles.dots}>
                {post.images.map((uri, i) => (
                  <View
                    key={uri}
                    style={[
                      styles.dot,
                      {
                        backgroundColor: i === imageIndex ? colors.surface : 'rgba(255,255,255,0.45)',
                      },
                    ]}
                  />
                ))}
              </View>
            )}
          </View>
        )}

        <View style={{ padding: space.lg, gap: space.lg }}>
          {/* ── 店名と基本情報 ───────────────────────── */}
          <View style={{ gap: space.xs }}>
            {!!area && (
              <Txt variant="caption" tone="faint">
                {[post.prefecture, area].filter(Boolean).join(' · ').toUpperCase()}
              </Txt>
            )}

            {/* 注目。編集部が選ぶのではなく、直近で実際に見られた数で自動的に立つ。
                「誰かが推した」ではなく「いま人が集まっている」を示すもの。 */}
            {isFeatured(post.featured_at) && (
              <View style={[styles.featured, { borderColor: colors.accent }]}>
                <Ionicons name="flame" size={12} color={colors.accent} />
                <Txt variant="caption" tone="accent" style={{ letterSpacing: 1.2 }}>
                  注目
                </Txt>
              </View>
            )}

            <Txt variant="title">{post.location_name}</Txt>
            <View style={styles.meta}>
              <View style={styles.rating}>
                {[1, 2, 3, 4, 5].map((s) => (
                  <Ionicons
                    key={s}
                    name={s <= post.rating ? 'star' : 'star-outline'}
                    size={14}
                    color={s <= post.rating ? colors.star : colors.borderStrong}
                  />
                ))}
              </View>
              <Txt variant="small" tone="faint">·</Txt>
              <Txt variant="small" tone="muted">
                {GENRE_EMOJI[post.genre] ?? '🍴'} {post.genre}
              </Txt>
              <Txt variant="small" tone="faint">·</Txt>
              <Txt variant="small" tone="muted">{post.price_range}</Txt>
            </View>
          </View>

          {/* ── 投稿者 ───────────────────────────── */}
          {post.author && (
            <Pressable
              onPress={() => router.push(`/user/${post.author!.username}`)}
              style={({ pressed }) => [
                styles.author,
                { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Avatar uri={post.author.photo_url} name={post.author.display_name} size={38} />
              <View style={{ flex: 1 }}>
                <Txt variant="smallMed" numberOfLines={1}>{post.author.display_name}</Txt>
                <Txt variant="small" tone="faint" numberOfLines={1}>@{post.author.username}</Txt>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
            </Pressable>
          )}

          {/* ── 本文（ここが今まで3行で切れていた） ───────── */}
          {!!post.caption && (
            <Txt variant="body" style={{ lineHeight: 27 }}>{post.caption}</Txt>
          )}

          {/* ── シチュエーション・ハッシュタグ ──────────── */}
          {(post.situations?.length > 0 || post.hashtags?.length > 0) && (
            <View style={styles.tags}>
              {(post.situations ?? []).map((s) => (
                <View
                  key={s}
                  style={[styles.tag, { borderColor: colors.border, backgroundColor: colors.surface }]}
                >
                  <Txt variant="small" tone="muted">{SITUATION_EMOJI[s] ?? ''} {s}</Txt>
                </View>
              ))}
              {(post.hashtags ?? []).map((h) => (
                <Txt key={h} variant="small" tone="accent">#{h}</Txt>
              ))}
            </View>
          )}

          {/* ── いいね・コメント数 ─────────────────── */}
          <View style={[styles.counts, { borderColor: colors.border }]}>
            <Pressable
              onPress={toggleLike}
              disabled={!user || liking}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={liked ? 'いいねを取り消す' : 'いいね'}
              style={({ pressed }) => [styles.count, { opacity: pressed ? 0.6 : 1 }]}
            >
              {liking
                ? <ActivityIndicator size="small" color={colors.textFaint} />
                : <Ionicons
                    name={liked ? 'heart' : 'heart-outline'}
                    size={20}
                    color={liked ? colors.danger : colors.textMuted}
                  />}
              <Txt variant="smallMed" tone="muted">{likes}</Txt>
            </Pressable>

            <View style={styles.count}>
              <Ionicons name="chatbubble-outline" size={18} color={colors.textMuted} />
              <Txt variant="smallMed" tone="muted">{post.comments_count ?? 0}</Txt>
            </View>

            {/* 表示回数。同じ人が何度開いても1日1回しか増えないので、
                「何回開かれたか」ではなく「何人に届いたか」に近い。 */}
            <View style={styles.count}>
              <Ionicons name="eye-outline" size={18} color={colors.textMuted} />
              <Txt variant="smallMed" tone="muted">{formatImpressions(impressions)}</Txt>
            </View>
          </View>

          {isFeatured(post.featured_at) && (
            <Txt variant="caption" tone="faint">
              直近{FEATURED_WINDOW_DAYS}日でよく見られている投稿です
            </Txt>
          )}

          {/* ── 店へ向かう導線。
                外部の地図アプリを URL で開くだけなので API 費用はかからない ── */}
          <View style={styles.actions}>
            <Pressable
              onPress={() => openInMaps(post.location_name, post.area)}
              style={({ pressed }) => [
                styles.action,
                { borderColor: colors.borderStrong, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Ionicons name="storefront-outline" size={16} color={colors.text} />
              <Txt variant="smallMed">この店を調べる</Txt>
            </Pressable>

            <Pressable
              onPress={() => openDirections(post.location_lat, post.location_lng, post.location_name)}
              style={({ pressed }) => [
                styles.action,
                { borderColor: colors.borderStrong, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Ionicons name="navigate-outline" size={16} color={colors.text} />
              <Txt variant="smallMed">行き方</Txt>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  dots: {
    position: 'absolute', bottom: space.md, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', gap: 5,
  },
  dot: { width: 5, height: 5, borderRadius: 3 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 2 },
  featured: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start', borderWidth: 1, borderRadius: radius.sm,
    paddingHorizontal: space.sm, paddingVertical: 3,
  },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  author: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingVertical: space.md, borderTopWidth: 1, borderBottomWidth: 1,
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  tag: {
    paddingHorizontal: space.md, paddingVertical: 5,
    borderRadius: radius.sm, borderWidth: 1,
  },
  counts: {
    flexDirection: 'row', gap: space.xl,
    paddingVertical: space.md, borderTopWidth: 1, borderBottomWidth: 1,
  },
  count: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minWidth: 44 },
  actions: { flexDirection: 'row', gap: space.sm },
  action: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: space.xs, paddingVertical: space.md,
    borderWidth: 1, borderRadius: radius.sm,
  },
})
