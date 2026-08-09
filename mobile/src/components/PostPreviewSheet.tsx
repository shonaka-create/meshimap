import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme, space, radius, shadow, GENRE_EMOJI } from '../theme'
import { Avatar, Txt } from './ui'
import { openDirections, openInMaps } from '../lib/maps'
import { isFeatured } from '../lib/impressions'
import type { Post } from '../lib/types'

/** 地図上でピンを選んだときに下から出るプレビュー */
export function PostPreviewSheet({
  post, onClose, onOpenProfile, onOpenPost,
}: {
  post: Post
  onClose: () => void
  onOpenProfile: (username: string) => void
  /** 投稿の詳細へ。キャプション全文・大きな写真・いいねはそちらで見せる */
  onOpenPost: (postId: string) => void
}) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()

  return (
    <View
      style={[
        styles.sheet,
        shadow.float,
        { backgroundColor: colors.surface, paddingBottom: insets.bottom + space.md },
      ]}
    >
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          {/* 注目は店名の上に置く。店名の横に足すと、名前が長い店で
              先に切れてしまい、注目の投稿ほど出なくなる。 */}
          {isFeatured(post.featured_at) && (
            <View style={[styles.featured, { borderColor: colors.accent }]}>
              <Ionicons name="flame" size={11} color={colors.accent} />
              <Txt variant="caption" tone="accent" style={{ letterSpacing: 1.2 }}>注目</Txt>
            </View>
          )}
          <Txt variant="heading" numberOfLines={1}>{post.location_name}</Txt>
          <View style={styles.meta}>
            <Txt variant="small" tone="muted">
              {GENRE_EMOJI[post.genre] ?? '🍴'} {post.genre}
            </Txt>
            <Txt variant="small" tone="faint">·</Txt>
            <View style={styles.rating}>
              <Ionicons name="star" size={13} color={colors.star} />
              <Txt variant="smallMed">{post.rating}.0</Txt>
            </View>
            <Txt variant="small" tone="faint">·</Txt>
            <Txt variant="small" tone="muted">{post.price_range}</Txt>
          </View>
        </View>

        <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="閉じる">
          <Ionicons name="close" size={22} color={colors.textMuted} />
        </Pressable>
      </View>

      {/* 写真とキャプションは詳細への入口を兼ねる。
          ここは「これは何の店か」を一瞬で判断させる場所なので、
          読み切らせようとせず、続きは詳細画面に渡す。 */}
      <Pressable
        onPress={() => onOpenPost(post.id)}
        accessibilityRole="button"
        accessibilityLabel="投稿の詳細を開く"
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, gap: space.md })}
      >
        {post.images.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.images}
          >
            {post.images.map((uri) => (
              <Image
                key={uri}
                source={{ uri }}
                style={[styles.image, { backgroundColor: colors.surfaceAlt }]}
                contentFit="cover"
                transition={150}
              />
            ))}
          </ScrollView>
        )}

        {!!post.caption && (
          <Txt variant="small" tone="muted" numberOfLines={2} style={{ paddingHorizontal: space.lg }}>
            {post.caption}
          </Txt>
        )}

        <View style={styles.more}>
          <Txt variant="smallMed" tone="accent">投稿を見る</Txt>
          <Ionicons name="chevron-forward" size={15} color={colors.accent} />
        </View>
      </Pressable>

      {/* 「行きたい」導線。
          外部の地図アプリを URL で開くだけなので API 費用はかからない。
          予約は請け負わないので、店を見つけるところまでで手を離す。 */}
      <View style={styles.actions}>
        <Pressable
          onPress={() => openInMaps(post.location_name, post.area)}
          style={({ pressed }) => [
            styles.action,
            { borderColor: colors.borderStrong, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Ionicons name="storefront-outline" size={15} color={colors.text} />
          <Txt variant="smallMed">この店を調べる</Txt>
        </Pressable>

        <Pressable
          onPress={() => openDirections(post.location_lat, post.location_lng, post.location_name)}
          style={({ pressed }) => [
            styles.action,
            { borderColor: colors.borderStrong, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Ionicons name="navigate-outline" size={15} color={colors.text} />
          <Txt variant="smallMed">行き方</Txt>
        </Pressable>
      </View>

      {post.author && (
        <Pressable
          onPress={() => onOpenProfile(post.author!.username)}
          style={({ pressed }) => [styles.author, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Avatar uri={post.author.photo_url} name={post.author.display_name} size={32} />
          <View style={{ flex: 1 }}>
            <Txt variant="smallMed" numberOfLines={1}>{post.author.display_name}</Txt>
            <Txt variant="small" tone="faint" numberOfLines={1}>@{post.author.username}</Txt>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: space.lg,
    gap: space.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingHorizontal: space.lg,
  },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 2 },
  featured: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start', borderWidth: 1, borderRadius: radius.sm,
    paddingHorizontal: 7, paddingVertical: 2, marginBottom: 4,
  },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  images: { paddingHorizontal: space.lg, gap: space.sm },
  image: { width: 132, height: 96, borderRadius: radius.md },
  more: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    paddingHorizontal: space.lg,
  },
  actions: {
    flexDirection: 'row', gap: space.sm,
    paddingHorizontal: space.lg, paddingTop: space.md,
  },
  action: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: space.xs, paddingVertical: space.sm,
    borderWidth: 1, borderRadius: radius.sm,
  },
  author: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.xs,
  },
})
