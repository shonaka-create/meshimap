import { Pressable, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useTheme } from '../theme'

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
    <Pressable
      onPress={() => router.back()}
      accessibilityRole="button"
      accessibilityLabel="戻る"
      hitSlop={8}
      style={({ pressed }) => [styles.btn, { opacity: pressed ? 0.45 : 1 }]}
    >
      <Ionicons name="chevron-back" size={26} color={colors.text} />
    </Pressable>
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
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="閉じる"
      hitSlop={8}
      style={({ pressed }) => [
        styles.btn,
        { opacity: disabled ? 0.3 : pressed ? 0.45 : 1 },
      ]}
    >
      <Ionicons name="close" size={24} color={colors.text} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  /** 44x44 は Apple のヒットターゲットの下限。見た目より押せる範囲を優先する */
  btn: { width: 44, height: 44, alignItems: 'flex-start', justifyContent: 'center' },
})
