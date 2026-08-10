import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View,
  type PressableProps, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native'
import { Image } from 'expo-image'
import { useState, forwardRef } from 'react'
import { useTheme, radius, shadow, space, type } from '../theme'

/* ─────────────────────────  Text  ───────────────────────── */

type Variant = keyof typeof type

export function Txt({
  variant = 'body', tone = 'default', style, children, ...rest
}: {
  variant?: Variant
  tone?: 'default' | 'muted' | 'faint' | 'accent' | 'danger' | 'inverse'
  style?: TextStyle | TextStyle[]
  children: React.ReactNode
} & React.ComponentProps<typeof Text>) {
  const { colors } = useTheme()
  const toneColor = {
    default: colors.text,
    muted: colors.textMuted,
    faint: colors.textFaint,
    accent: colors.accent,
    danger: colors.danger,
    inverse: colors.accentText,
  }[tone]

  return (
    <Text {...rest} style={[type[variant] as TextStyle, { color: toneColor }, style]}>
      {children}
    </Text>
  )
}

/* ─────────────────────────  Button  ───────────────────────── */

export function Button({
  title, onPress, variant = 'primary', loading, disabled, style, icon,
}: {
  title: string
  onPress?: PressableProps['onPress']
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  loading?: boolean
  disabled?: boolean
  style?: ViewStyle
  icon?: React.ReactNode
}) {
  const { colors } = useTheme()
  const isDisabled = disabled || loading

  // 主ボタンは墨のベタ塗り。真鍮は選択状態やリンクのために取っておく。
  // 差し色をボタンにも使うと、画面の中で色が主張しすぎる。
  const bg = {
    primary: colors.text,
    secondary: 'transparent',
    ghost: 'transparent',
    danger: 'transparent',
  }[variant]

  const fg = {
    primary: colors.bg,
    secondary: colors.text,
    ghost: colors.accent,
    danger: colors.danger,
  }[variant]

  const borderColor = {
    primary: 'transparent',
    secondary: colors.borderStrong,
    ghost: 'transparent',
    danger: colors.danger,
  }[variant]

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: bg,
          borderColor,
          borderWidth: variant === 'primary' || variant === 'ghost' ? 0 : 1,
          opacity: isDisabled ? 0.35 : pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.btnInner}>
          {icon}
          {/* ボタンの文字は字間を開ける。詰まっていると野暮ったく見える */}
          <Text
            style={[
              type.smallMed as TextStyle,
              { color: fg, letterSpacing: 1.2 },
            ]}
          >
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  )
}

/* ─────────────────────────  Input  ───────────────────────── */

/**
 * 入力欄とその前後に置く文字で共通に使う字形指標。
 *
 * type.body から lineHeight をわざと落としてある。
 * TextInput は lineHeight を Text と同じようには扱わないので、
 * 同じ値を渡しても文字の座る位置が揃わない。
 * 両方から外して字形本来の高さに任せるほうが確実に揃う。
 */
const inputText: TextStyle = {
  fontSize: type.body.fontSize,
  fontWeight: type.body.fontWeight,
}

export const Field = forwardRef<TextInput, {
  label?: string
  hint?: string
  error?: string | null
  /** 入力欄の先頭に固定表示する記号（ユーザーIDの「@」など） */
  prefix?: string
  right?: React.ReactNode
} & TextInputProps>(function Field(
  { label, hint, error, prefix, right, style, ...rest }, ref
) {
  const { colors } = useTheme()
  const [focused, setFocused] = useState(false)

  const borderColor = error ? colors.danger : focused ? colors.accent : colors.border

  return (
    <View style={{ gap: space.xs }}>
      {label && <Txt variant="smallMed" tone="muted">{label}</Txt>}

      {/* 囲み枠ではなく下線だけにする。枠は画面に線を増やしてうるさくなる */}
      <View
        style={[
          styles.field,
          { borderBottomColor: borderColor, borderBottomWidth: focused || error ? 2 : 1 },
        ]}
      >
        {/* ★ prefix と入力欄は同じ字形指標で置くこと。
            以前は prefix が <Txt variant="body">（lineHeight 25 つき）で、
            入力欄も同じ 25 を渡していた。ところが TextInput は
            lineHeight を Text と同じようには扱わず、文字の座る位置が
            上下にずれる。alignItems:'center' は「箱」を揃えるだけなので、
            箱の中の文字がずれていれば「@」と入力文字の高さが合わない。

            lineHeight を両方から外すと、どちらも字形本来の高さで
            箱ができるため、中央揃えがそのまま文字の揃えになる。 */}
        {prefix && (
          <Text style={[inputText, { color: colors.textFaint }]}>{prefix}</Text>
        )}
        <TextInput
          ref={ref}
          {...rest}
          onFocus={(e) => { setFocused(true); rest.onFocus?.(e) }}
          onBlur={(e) => { setFocused(false); rest.onBlur?.(e) }}
          placeholderTextColor={colors.textFaint}
          style={[
            inputText,
            // 複数行のときだけ行間を戻す。キャプションや自己紹介は
            // 2行以上になるので、字形任せだと行がくっついて読みにくい。
            // 複数行の入力欄に prefix は付かないため、揃えの問題も起きない。
            rest.multiline ? { lineHeight: type.body.lineHeight } : null,
            { color: colors.text, flex: 1, padding: 0 },
            style,
          ]}
        />
        {right}
      </View>

      {error ? (
        <Txt variant="small" tone="danger">{error}</Txt>
      ) : hint ? (
        <Txt variant="small" tone="faint">{hint}</Txt>
      ) : null}
    </View>
  )
})

/* ─────────────────────────  Avatar  ───────────────────────── */

export function Avatar({
  uri, name, size = 44,
}: { uri?: string | null; name?: string | null; size?: number }) {
  const { colors } = useTheme()

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surfaceAlt }}
        contentFit="cover"
        transition={150}
      />
    )
  }

  return (
    <View
      style={{
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: colors.accentSoft,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Text style={{ color: colors.accent, fontSize: size * 0.4, fontWeight: '700' }}>
        {(name ?? '?').trim().charAt(0).toUpperCase()}
      </Text>
    </View>
  )
}

/* ─────────────────────────  Chip  ───────────────────────── */

export function Chip({
  label, selected, onPress, count, onMap,
}: {
  label: string
  selected?: boolean
  onPress?: () => void
  count?: number
  /**
   * 地図の上に置くとき用。
   * 通常のチップは未選択だと背景が透明で、紙の上なら軽くて良いが、
   * 地図の上では下の地形や道路が透けて文字が読めなくなる。
   * これを立てると面を不透明にして、輪郭も一段濃くする。
   */
  onMap?: boolean
}) {
  const { colors } = useTheme()

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [
        styles.chip,
        onMap && shadow.card,
        {
          backgroundColor: selected ? colors.text : onMap ? colors.surface : 'transparent',
          borderColor: selected ? colors.text : onMap ? colors.borderStrong : colors.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text
        style={[
          type.smallMed as TextStyle,
          { color: selected ? colors.bg : colors.textMuted, letterSpacing: 0.6 },
        ]}
      >
        {label}
      </Text>
      {count !== undefined && (
        <View
          style={[
            styles.chipCount,
            { backgroundColor: selected ? 'rgba(255,255,255,0.18)' : colors.surfaceAlt },
          ]}
        >
          <Text
            style={[
              type.caption as TextStyle,
              { color: selected ? colors.bg : colors.textMuted },
            ]}
          >
            {count}
          </Text>
        </View>
      )}
    </Pressable>
  )
}

/* ─────────────────────────  States  ───────────────────────── */

export function EmptyState({
  emoji, title, body, action,
}: { emoji: string; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <View style={styles.empty}>
      {/* 大きな絵文字は幼く見えるので小さく添えるだけにする */}
      <Text style={{ fontSize: 22, opacity: 0.45 }}>{emoji}</Text>
      <Txt variant="title" style={{ marginTop: space.lg, textAlign: 'center' }}>{title}</Txt>
      {body && (
        <Txt variant="small" tone="muted" style={{ marginTop: space.xs, textAlign: 'center' }}>
          {body}
        </Txt>
      )}
      {action && <View style={{ marginTop: space.lg }}>{action}</View>}
    </View>
  )
}

export function Loading({ label }: { label?: string }) {
  const { colors } = useTheme()
  return (
    <View style={styles.empty}>
      <ActivityIndicator color={colors.accent} />
      {label && <Txt variant="small" tone="muted" style={{ marginTop: space.sm }}>{label}</Txt>}
    </View>
  )
}

/** 統計値（投稿数・フォロワー数など）の縦並び表示 */
export function Stat({
  value, label, onPress,
}: { value: number; label: string; onPress?: () => void }) {
  const { colors } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [{ alignItems: 'center', opacity: pressed && onPress ? 0.6 : 1 }]}
    >
      <Text style={[type.title as TextStyle, { color: colors.text, fontSize: 20, lineHeight: 28 }]}>
        {value.toLocaleString('ja-JP')}
      </Text>
      <Txt variant="caption" tone="faint">{label}</Txt>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  btn: {
    height: 52,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: 2,
    paddingBottom: space.sm,
    minHeight: 44,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: 7,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  chipCount: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xxl,
  },
})
