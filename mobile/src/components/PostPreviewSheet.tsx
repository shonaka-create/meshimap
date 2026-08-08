import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme, space, radius, shadow, GENRE_EMOJI } from '../theme'
import { Avatar, Txt } from './ui'
import type { Post } from '../lib/types'

/** 地図上でピンを選んだときに下から出るプレビュー */
export function PostPreviewSheet({
  post, onClose, onOpenProfile,
}: {
  post: Post
  onClose: () => void
  onOpenProfile: (username: string) => void
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
        <Txt variant="small" tone="muted" numberOfLines={3} style={{ paddingHorizontal: space.lg }}>
          {post.caption}
        </Txt>
      )}

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
  rating: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  images: { paddingHorizontal: space.lg, gap: space.sm },
  image: { width: 132, height: 96, borderRadius: radius.md },
  author: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.xs,
  },
})
