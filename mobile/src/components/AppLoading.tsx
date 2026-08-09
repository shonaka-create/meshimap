import { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'
import { useTheme, space, type } from '../theme'
import { Txt } from './ui'

/**
 * 起動直後（セッション復元中）の画面。
 *
 * 汎用の Loading（ActivityIndicator + 「読み込み中」）を出していたが、
 * これはアプリを開いて最初に見えるものなので、
 * OS標準のくるくるが回っているだけだと「まだ何も作られていない」ように見える。
 *
 * 代わりに銘板を静かに置く。スピナーをやめて細い罫を左右に走らせるのは、
 * 白のギャラリーが「影ではなく線で構造を作る」方針だから。
 * 待ち時間そのものを演出に使わず、待っていることだけが分かればよい。
 */
export function AppLoading() {
  const { colors } = useTheme()

  const sweep = useRef(new Animated.Value(0)).current
  const fade = useRef(new Animated.Value(0)).current

  useEffect(() => {
    // 銘板はふわりと出す。いきなり出ると点滅に見える。
    Animated.timing(fade, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start()

    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      })
    )
    loop.start()
    return () => loop.stop()
  }, [sweep, fade])

  // 細い線が罫の上を左から右へ抜ける
  const translateX = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [-96, 96],
  })
  const lineOpacity = sweep.interpolate({
    inputRange: [0, 0.15, 0.85, 1],
    outputRange: [0, 1, 1, 0],
  })

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <Animated.View style={{ opacity: fade, alignItems: 'center' }}>
        <Txt variant="display" style={{ letterSpacing: 1.2 }}>
          MeshiMap
        </Txt>

        {/* 罫とその上を走る線。ここが「読み込み中」の合図 */}
        <View style={[styles.rule, { backgroundColor: colors.border }]}>
          <Animated.View
            style={[
              styles.sweep,
              {
                backgroundColor: colors.accent,
                opacity: lineOpacity,
                transform: [{ translateX }],
              },
            ]}
          />
        </View>

        <Txt
          variant="small"
          tone="muted"
          style={{ marginTop: space.lg, ...(type.small as object) }}
        >
          食の記憶を、地図に残す。
        </Txt>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  rule: {
    width: 192,
    height: 1,
    marginTop: space.xl,
    overflow: 'hidden',
  },
  sweep: {
    width: 64,
    height: 1,
  },
})
