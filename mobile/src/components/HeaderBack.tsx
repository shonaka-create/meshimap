import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useTheme } from '../theme'
import type { ReactNode } from 'react'

/**
 * ヘッダーに置くボタンの共通の枠。
 *
 * ★ 中身は必ず中央に置くこと。
 *   以前は左のボタンが flex-start、右のボタンが flex-end で、
 *   それぞれ 44px の枠の外側の端に貼り付いていた。
 *   ヘッダー自身の余白と合わさって左右が違う量だけ外へ寄り、
 *   タイトルに対しても左右で見え方がずれていた。
 *   枠の中央に置けば、左右どちらも「画面の端から同じ距離」になる。
 *
 * ★ 44x44 は Apple のヒットターゲットの下限。
 *   アイコンだけを裸で置くと iOS のヘッダーは幅を測れず、
 *   右端に食い込んだり潰れたりする。枠は必ず自分で持つ。
 */
export function HeaderButton({
  onPress, disabled, accessibilityLabel, children, style,
}: {
  onPress: () => void
  disabled?: boolean
  accessibilityLabel: string
  children: ReactNode
  style?: StyleProp<ViewStyle>
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => [
        styles.btn,
        { opacity: disabled ? 0.3 : pressed ? 0.45 : 1 },
        style,
      ]}
    >
      {children}
    </Pressable>
  )
}

/**
 * ヘッダーの戻るボタン。
 *
 * ★ 自前で持っている理由。
 *   iOS 標準の戻る矢印は、ラベルを消すと（headerBackButtonDisplayMode: 'minimal'）
 *   矢印そのものの幅しか押せなくなる。以前ラベルが出ていたあたり——
 *   指が自然に行く位置——を押しても何も起きないので、
 *   「戻るボタンが反応しないことがある」ように見えていた。
 *   Apple のヒットターゲットの下限は 44x44。ここで確実に確保する。
 *
 * ★ 戻り先が無いときは何も描かない。
 *   通知やリンクから直接開かれると、この画面がスタックの最初になる。
 *   押しても何も起きないボタンを出すくらいなら、出さないほうがいい。
 */
export function HeaderBack() {
  const { colors } = useTheme()
  const router = useRouter()

  if (!router.canGoBack()) return null

  return (
    <HeaderButton onPress={() => router.back()} accessibilityLabel="戻る">
      <Ionicons name="chevron-back" size={26} color={colors.text} />
    </HeaderButton>
  )
}

/**
 * モーダルを閉じるボタン。
 *
 * ★ モーダルには戻る矢印が出ない（iOS の仕様）。
 *   下向きのスワイプで閉じられることになっているが、
 *   中身が縦に長い画面では、スクロールが先に効いて閉じられない。
 *   キーボードが出ていればなおさら。閉じる手段を必ず置くこと。
 */
export function HeaderClose({
  onPress, disabled,
}: { onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme()

  return (
    <HeaderButton onPress={onPress} disabled={disabled} accessibilityLabel="閉じる">
      <Ionicons name="close" size={24} color={colors.text} />
    </HeaderButton>
  )
}

const styles = StyleSheet.create({
  /** 44x44 は Apple のヒットターゲットの下限。見た目より押せる範囲を優先する */
  btn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
})
