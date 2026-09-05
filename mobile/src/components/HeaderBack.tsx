import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useTheme } from '../theme'
import type { ReactNode } from 'react'

/**
 * ヘッダーのアイコン。
 *
 * ★ アイコンフォントは Text として描かれる。
 *   何もしないと中央に置かれるのは「文字の行ボックス」であって、
 *   絵柄そのものではない。ずれる原因が2つある。
 *
 *   1. Android は includeFontPadding が既定で有効で、
 *      フォントの top/bottom メトリクスぶんの余白が上下に付く。
 *      左右のボタンで別のアイコンを使うと付く量が変わり、
 *      「枠の中で少し上（下）にずれている」ように見える。
 *   2. 行の高さをフォント任せにすると lineGap が入り、
 *      端末やOSのバージョンで中央がわずかに動く。
 *
 *   fontSize と同じ辺の正方形と行の高さを明示し、Android の余白を切る。
 *   こうすると絵柄の箱が size×size に固定され、
 *   親（44x44）の中央寄せが、そのまま絵柄の中央寄せになる。
 *
 * ★ size は「フォントの大きさ」であって「見える大きさ」ではない。
 *   同じ size を渡しても、絵柄によって見える大きさは全く違う。
 *   Ionicons.ttf（unitsPerEm=512）を実測した、墨（塗られている部分）の高さ:
 *
 *     chevron-back    0.660em
 *     flag-outline    0.879em
 *     trash-outline   0.873em
 *     close           0.535em
 *
 *   つまり戻る矢印(26)と通報の旗(22)を並べると、
 *   見える高さは 17.2px と 19.3px で、旗のほうが1割以上大きい。
 *   左右で重さが違うので、これも「ずれている」ように見える。
 *   下の値は、見える高さを 17〜17.6px に揃えたもの。
 *
 *   ★ 新しいアイコンを足すときは、fontSize を目分量で決めないこと。
 *     ここに載っていない名前は既定(24)で描かれるので、
 *     実測して仲間に入れること。
 */
const ICON_SIZE: Record<string, number> = {
  'chevron-back': 26,  // 0.660em → 17.2px
  'flag-outline': 20,  // 0.879em → 17.6px
  'trash-outline': 20, // 0.873em → 17.5px
  close: 32,           // 0.535em → 17.1px
}

export function HeaderIcon({
  name, color,
}: { name: React.ComponentProps<typeof Ionicons>['name']; color: string }) {
  const size = ICON_SIZE[name] ?? 24

  return (
    <Ionicons
      name={name}
      size={size}
      color={color}
      style={{
        width: size,
        height: size,
        lineHeight: size,
        textAlign: 'center',
        textAlignVertical: 'center',
        includeFontPadding: false,
      }}
    />
  )
}

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
      <HeaderIcon name="chevron-back" color={colors.text} />
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
      <HeaderIcon name="close" color={colors.text} />
    </HeaderButton>
  )
}

const styles = StyleSheet.create({
  /** 44x44 は Apple のヒットターゲットの下限。見た目より押せる範囲を優先する */
  btn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
})
