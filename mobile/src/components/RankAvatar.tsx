import { View, Text, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import { useTheme, radius } from '../theme'
import { rankOf, type Rank } from '../lib/rank'

interface Props {
  /** プロフィール写真。絵柄を選んでいる場合はそちらが優先される */
  uri?: string | null
  /** 選択中の絵柄。null ならプロフィール写真、それも無ければ頭文字 */
  emoji?: string | null
  name?: string | null
  size?: number
  /** ランクを直接渡す。省略時は投稿数・エリア数から求める */
  rank?: Rank
  postsCount?: number
  areasCount?: number
  /** 枠を描かない（一覧など、ランクを見せる必要がない場所） */
  plain?: boolean
}

/**
 * ランクの枠つきアイコン。
 *
 * 中身の優先順位は 絵柄 → 写真 → 頭文字。
 * 絵柄を選んでいる人は地図上でも一覧でも同じ顔になるので、
 * 「誰のピンか」が判別しやすくなる。
 */
export function RankAvatar({
  uri, emoji, name, size = 44, rank, postsCount = 0, areasCount = 0, plain = false,
}: Props) {
  const { colors } = useTheme()
  const r = rank ?? rankOf(postsCount, areasCount)
  const border = plain ? 0 : r.frameWidth
  const inner = size - border * 2

  return (
    <View
      style={[
        styles.frame,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: border,
          borderColor: plain ? 'transparent' : r.frame,
          backgroundColor: colors.surface,
        },
      ]}
    >
      {emoji ? (
        <View
          style={{
            width: inner, height: inner, borderRadius: inner / 2,
            backgroundColor: colors.accentSoft,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: inner * 0.55 }}>{emoji}</Text>
        </View>
      ) : uri ? (
        <Image
          source={{ uri }}
          style={{ width: inner, height: inner, borderRadius: inner / 2, backgroundColor: colors.surfaceAlt }}
          contentFit="cover"
          transition={150}
        />
      ) : (
        <View
          style={{
            width: inner, height: inner, borderRadius: inner / 2,
            backgroundColor: colors.accentSoft,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ color: colors.accent, fontSize: inner * 0.4, fontWeight: '700' }}>
            {(name ?? '?').trim().charAt(0).toUpperCase()}
          </Text>
        </View>
      )}
    </View>
  )
}

/** ランク名の小さなバッジ */
export function RankBadge({ rank, compact = false }: { rank: Rank; compact?: boolean }) {
  const { colors } = useTheme()
  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: colors.surfaceAlt,
          borderColor: rank.frame,
          paddingVertical: compact ? 2 : 4,
          paddingHorizontal: compact ? 6 : 10,
        },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: rank.frame }]} />
      <Text
        style={{
          color: colors.text,
          fontSize: compact ? 10 : 12,
          fontWeight: '600',
          letterSpacing: 0.2,
        }}
      >
        {rank.name}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  frame: { alignItems: 'center', justifyContent: 'center' },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: radius.pill, borderWidth: 1, alignSelf: 'flex-start',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
})
