import {
  Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme, space, radius, shadow } from '../theme'
import { Txt } from './ui'
import { RankAvatar } from './RankAvatar'
import { RANKS } from '../lib/rank'
import type { MapPin } from '../lib/types'

/** 列に並べるアイコンの数。これを超えた分は「+N」にまとめて引き出しへ送る */
const MAX_FACES = 10

/** 輪の外径。中のアイコンは輪の太さと隙間のぶん小さくなる */
const RING = 52
const FACE = 42

/**
 * 地図の下に置く「みんなの地図」の列。
 *
 * Instagram のストーリーのように、地図に出ている人のアイコンを横に並べる。
 * 押すと、その人の投稿だけの地図に切り替わる。もう一度押すと全員に戻る。
 *
 * 以前は左下に「N人の地図」というボタンが1つあるだけで、
 * 誰かの地図だけを見たいときは、引き出しを開いて他の人のチェックを
 * 外して回るしかなかった。出す人の入れ替え（課金の線）と、
 * 「いまこの人の店を見たい」は別の操作なので、後者を初期画面に出す。
 *
 * ★ ここで地図に出す人を増やしたり減らしたりしないこと。
 *   それは MapAudienceDrawer（follows.on_map）の役目で、上限もそこが持つ。
 *   この列は map_pins() が返した「既に出ている人」の中から選ぶだけ。
 *
 * ★ 輪にグラデーションの部品を使っていないのは、
 *   このアプリで他に使っている所が無く、ネイティブ部品を1つ増やすことになるため。
 *   罫線の上下で色を変え、45度回すだけで、ストーリーの輪に見える。
 */
export function MapStoryRow({
  pins, selectedId, onSelect, onOpenDrawer, style,
}: {
  pins: MapPin[]
  /** 絞り込み中の人。null なら全員 */
  selectedId: string | null
  onSelect: (userId: string | null) => void
  onOpenDrawer: () => void
  style?: StyleProp<ViewStyle>
}) {
  const { colors } = useTheme()

  // 自分を先頭に。ストーリーと同じく「自分 → 他の人」の順が見慣れている
  const ordered = [...pins].sort((a, b) => Number(b.is_me) - Number(a.is_me))
  const faces = ordered.slice(0, MAX_FACES)
  const rest = ordered.length - faces.length

  return (
    <View
      style={[
        styles.bar,
        shadow.float,
        { backgroundColor: colors.surface, borderColor: colors.border },
        style,
      ]}
    >
      <Pressable
        onPress={onOpenDrawer}
        accessibilityRole="button"
        accessibilityLabel="みんなの地図。誰の地図を出すかを選ぶ"
        style={({ pressed }) => [
          styles.lead,
          { backgroundColor: colors.text, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <Ionicons name="people-outline" size={18} color={colors.bg} />
        <Txt variant="caption" style={{ color: colors.bg, letterSpacing: 0.8 }}>
          {'みんなの\n地図'}
        </Txt>
        <Ionicons name="chevron-forward" size={12} color={colors.bg} />
      </Pressable>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.faces}
        // 地図の上なので、端まで行ったときの跳ね返りで地図が動いたように見えないよう止める
        bounces={false}
      >
        {faces.map((pin) => {
          const selected = selectedId === pin.user_id
          // 誰かを選んでいる間は、選ばれていない人を薄くして「絞っている」ことを見せる
          const dimmed = selectedId !== null && !selected
          const rank = RANKS.find((r) => r.level === pin.rank) ?? RANKS[0]
          const name = pin.is_me ? '自分' : pin.display_name

          return (
            <Pressable
              key={pin.user_id}
              onPress={() => onSelect(selected ? null : pin.user_id)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={
                selected ? `${name}の地図をやめて、みんなの地図に戻す` : `${name}の地図だけを見る`
              }
              hitSlop={4}
              style={({ pressed }) => ({ opacity: dimmed ? 0.45 : pressed ? 0.7 : 1 })}
            >
              <View style={styles.ringBox}>
                <View
                  style={[
                    styles.ring,
                    {
                      borderWidth: selected ? 3 : 2,
                      borderTopColor: colors.accent,
                      borderRightColor: colors.accent,
                      borderBottomColor: selected ? colors.accent : colors.danger,
                      borderLeftColor: selected ? colors.accent : colors.danger,
                    },
                  ]}
                />
                <RankAvatar
                  uri={pin.photo_url}
                  emoji={pin.avatar_emoji}
                  name={pin.display_name}
                  rank={rank}
                  size={FACE}
                  plain
                />
              </View>
            </Pressable>
          )
        })}

        {/* 地図にまだ誰も出ていない / 並べきれない人がいる。どちらも引き出しへ */}
        {(faces.length === 0 || rest > 0) && (
          <Pressable
            onPress={onOpenDrawer}
            accessibilityRole="button"
            accessibilityLabel={rest > 0 ? `ほか${rest}人。一覧を開く` : '地図に出す人を選ぶ'}
            style={({ pressed }) => [
              styles.more,
              { backgroundColor: colors.surfaceAlt, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            {rest > 0 ? (
              <Txt variant="smallMed" tone="muted">+{rest}</Txt>
            ) : (
              <Ionicons name="person-add-outline" size={18} color={colors.textMuted} />
            )}
          </Pressable>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 68,
    paddingLeft: space.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  lead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    height: 52,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
  },
  faces: {
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
  },
  ringBox: {
    width: RING,
    height: RING,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: RING / 2,
    transform: [{ rotate: '45deg' }],
  },
  more: {
    width: FACE,
    height: FACE,
    borderRadius: FACE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
