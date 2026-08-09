import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react'
import {
  AccessibilityInfo, Animated, Easing, StyleSheet, useWindowDimensions, View,
} from 'react-native'
import { BlurView } from 'expo-blur'
import { useTheme } from '../theme'

export interface CloudTransitionHandle {
  /**
   * 雲を抜ける演出を再生する。
   * 雲が画面を覆いきった瞬間に onCovered が呼ばれるので、
   * そこで地図のカメラを移動させる（切り替わりが見えない）。
   */
  fly: (onCovered: () => void) => void
}

/** 雲のかたまり。中心からの相対位置で置く */
const PUFFS = [
  { x: -0.30, y: -0.26, r: 0.62, o: 0.95, delay: 0 },
  { x: 0.34, y: -0.14, r: 0.54, o: 0.90, delay: 40 },
  { x: -0.16, y: 0.24, r: 0.70, o: 0.92, delay: 20 },
  { x: 0.28, y: 0.34, r: 0.50, o: 0.86, delay: 60 },
  { x: 0.02, y: -0.02, r: 0.80, o: 0.98, delay: 10 },
  { x: -0.42, y: 0.06, r: 0.44, o: 0.82, delay: 80 },
  { x: 0.46, y: 0.10, r: 0.46, o: 0.84, delay: 50 },
]

const COVER_MS = 260   // 覆うまで
const HOLD_MS = 90     // 覆ったまま保持（この間にカメラを動かす）
const CLEAR_MS = 720   // 抜けるまで

/**
 * 県からエリアへ降りるときの「雲を抜ける」演出。
 *
 * 地図のズームだけだと、どこへ移動したのか分かりにくく、
 * 一段降りた実感も出ない。上空から雲を突き抜けて降りる絵にすることで、
 * 「降りた」ことを body で理解させる。
 *
 * 動きの設計:
 *   1. 雲が手前に迫って画面を覆う（速い / ease-in）
 *   2. 覆っている間にカメラを移動する（切り替わりを見せない）
 *   3. 雲が外へ広がりながら薄れて抜ける（ゆっくり / ease-out）
 *
 * 2 の裏で処理を済ませるので、地図の再描画の重さも隠せる。
 * 「視覚効果を減らす」設定の端末では演出せず即座に移動する。
 */
export const CloudTransition = forwardRef<CloudTransitionHandle>(
  function CloudTransition(_props, ref) {
    const { width, height } = useWindowDimensions()
    const { isDark } = useTheme()
    const [active, setActive] = useState(false)

    // 0 → 1 → 2 の1本のタイムラインで全部動かす。
    // 個別に Animated.Value を持つとズレるため。
    const t = useRef(new Animated.Value(0)).current
    const busy = useRef(false)

    const fly = useCallback(
      (onCovered: () => void) => {
        if (busy.current) return
        busy.current = true

        AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
          if (reduce) {
            // 視覚効果を減らす設定のときは演出しない
            onCovered()
            busy.current = false
            return
          }

          setActive(true)
          t.setValue(0)

          Animated.sequence([
            Animated.timing(t, {
              toValue: 1,
              duration: COVER_MS,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.delay(HOLD_MS),
          ]).start(() => {
            onCovered()
            Animated.timing(t, {
              toValue: 2,
              duration: CLEAR_MS,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }).start(() => {
              setActive(false)
              busy.current = false
            })
          })
        })
      },
      [t]
    )

    useImperativeHandle(ref, () => ({ fly }), [fly])

    if (!active) return null

    const base = Math.max(width, height)

    // 覆う→抜ける、で全体の不透明度を作る
    const veil = t.interpolate({
      inputRange: [0, 1, 1.35, 2],
      outputRange: [0, 1, 0.95, 0],
    })

    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {/* 地図をぼかして、雲の白と地図の境目を曖昧にする */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: veil }]}>
          <BlurView
            intensity={70}
            tint={isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        {PUFFS.map((p, i) => {
          const size = base * p.r

          // 手前に迫って、通り過ぎて外へ開いていく
          const scale = t.interpolate({
            inputRange: [0, 1, 2],
            outputRange: [0.55, 1.1, 3.2],
          })
          // 中心から外へ逃がす。通過している感を出す
          const tx = t.interpolate({
            inputRange: [0, 1, 2],
            outputRange: [p.x * base * 0.5, p.x * base * 0.9, p.x * base * 2.6],
          })
          const ty = t.interpolate({
            inputRange: [0, 1, 2],
            outputRange: [p.y * base * 0.5, p.y * base * 0.9, p.y * base * 2.6],
          })
          const opacity = t.interpolate({
            inputRange: [0, 0.75, 1, 1.5, 2],
            outputRange: [0, p.o, p.o, p.o * 0.5, 0],
          })

          return (
            <Animated.View
              key={i}
              style={{
                position: 'absolute',
                left: width / 2 - size / 2,
                top: height / 2 - size / 2,
                width: size,
                height: size,
                borderRadius: size / 2,
                // 白の平面ではなく、薄い雲を何枚も重ねて厚みを出す
                backgroundColor: isDark ? 'rgba(226,222,215,0.55)' : '#FFFFFF',
                opacity,
                transform: [{ translateX: tx }, { translateY: ty }, { scale }],
              }}
            />
          )
        })}
      </View>
    )
  }
)
