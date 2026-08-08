import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View,
  type PressableProps, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native'
import { Image } from 'expo-image'
import { useState, forwardRef } from 'react'
import { useTheme, radius, space, type } from '../theme'

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

  const bg = {
    primary: colors.accent,
    secondary: colors.surfaceAlt,
    ghost: 'transparent',
    danger: colors.dangerSoft,
  }[variant]

  const fg = {
    primary: colors.accentText,
    secondary: colors.text,
    ghost: colors.accent,
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
          borderColor: variant === 'secondary' ? colors.border : 'transparent',
          borderWidth: variant === 'secondary' ? StyleSheet.hairlineWidth * 2 : 0,
          opacity: isDisabled ? 0.45 : pressed ? 0.82 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.btnInner}>
          {icon}
          <Text style={[type.bodyMed as TextStyle, { color: fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  )
}

/* ─────────────────────────  Input  ───────────────────────── */

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

      <View
        style={[
          styles.field,
          { backgroundColor: colors.surface, borderColor, borderWidth: focused || error ? 2 : 1 },
        ]}
      >
        {prefix && <Txt variant="body" tone="faint">{prefix}</Txt>}
        <TextInput
          ref={ref}
          {...rest}
          onFocus={(e) => { setFocused(true); rest.onFocus?.(e) }}
          onBlur={(e) => { setFocused(false); rest.onBlur?.(e) }}
          placeholderTextColor={colors.textFaint}
          style={[type.body as TextStyle, { color: colors.text, flex: 1, padding: 0 }, style]}
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
  label, selected, onPress, count,
}: { label: string; selected?: boolean; onPress?: () => void; count?: number }) {
  const { colors } = useTheme()

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? colors.accent : colors.surface,
          borderColor: selected ? colors.accent : colors.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text style={[type.smallMed as TextStyle, { color: selected ? colors.accentText : colors.text }]}>
        {label}
      </Text>
      {count !== undefined && (
        <View
          style={[
            styles.chipCount,
            { backgroundColor: selected ? 'rgba(255,255,255,0.22)' : colors.surfaceAlt },
          ]}
        >
          <Text
            style={[
              type.caption as TextStyle,
              { color: selected ? colors.accentText : colors.textMuted },
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
      <Text style={{ fontSize: 44 }}>{emoji}</Text>
      <Txt variant="heading" style={{ marginTop: space.md, textAlign: 'center' }}>{title}</Txt>
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
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [{ alignItems: 'center', opacity: pressed && onPress ? 0.6 : 1 }]}
    >
      <Txt variant="heading">{value.toLocaleString('ja-JP')}</Txt>
      <Txt variant="small" tone="muted">{label}</Txt>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  btn: {
    height: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: 50,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
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
