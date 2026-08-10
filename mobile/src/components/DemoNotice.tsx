import { StyleSheet, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme, space, radius } from '../theme'
import { Txt } from './ui'

/**
 * デモ用アカウントであることの表示。
 *
 * デモデータには実在の店が入っていて、評価も一律に付けてある。
 * 書いた人物は架空なので、そのまま出すと
 * 「行っていない人のレビュー」を実在の店に載せていることになる。
 *
 * 消してしまうと地図が空になり、アプリを見る側にも審査側にも
 * 何も伝わらない。だから消さずに、デモだと分かるようにする。
 *
 * 目立たせすぎないこと。警告色で大きく出すと、
 * アプリ全体が壊れているように見えてしまう。
 * 読めば分かる、が正しい強さ。
 */
export function DemoNotice({
  /** 一覧に置く小さい版。プロフィール上部は false（既定） */
  compact = false,
}: { compact?: boolean }) {
  const { colors } = useTheme()

  return (
    <View
      style={[
        styles.box,
        {
          backgroundColor: colors.surfaceAlt,
          borderColor: colors.border,
          paddingVertical: compact ? space.sm : space.md,
        },
      ]}
    >
      <Ionicons name="information-circle-outline" size={compact ? 14 : 16} color={colors.textMuted} />
      <Txt variant={compact ? 'caption' : 'small'} tone="muted" style={{ flex: 1 }}>
        {compact
          ? 'デモ用の投稿です（実際の訪問に基づく評価ではありません）'
          : 'デモ用のアカウントです。掲載しているお店は実在しますが、'
            + '評価と本文はアプリの動作を確認するために用意したもので、'
            + '実際の訪問に基づくレビューではありません。'}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
})
