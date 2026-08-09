import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState,
} from 'react'
import {
  AccessibilityInfo, Animated, Easing, StyleSheet, useWindowDimensions, View,
} from 'react-native'
import { BlurView } from 'expo-blur'
import { useTheme } from '../theme'

export interface CloudTransitionSteps {
  /**
   * 雲が画面を覆いきった瞬間。
   * ここで地図のカメラを飛ばす（切り替わりが見えない）。
   */
  onCovered: () => void
  /**
   * 雲が晴れはじめる瞬間。
   *
   * ここで最後の寄りを見せる。移動を全部 onCovered で済ませると
   * 地面は瞬間移動していて、雲だけが動いている絵になる。
   * 晴れながらカメラが降りると「雲を抜けて近づいた」ように見える。
   */
  onClearing?: () => void
  /** 「視覚効果を減らす」設定のとき。演出せずに済ませる */
  onSkip?: () => void
}

export interface CloudTransitionHandle {
  /** 雲を抜ける演出を再生する */
  fly: (steps: CloudTransitionSteps) => void
}

/**
 * 雲ひとかたまりの輪郭。
 *
 * 以前は真円をそのまま1個ずつ置いていたが、円は「雲」ではなく「玉」に見える。
 * 実際の雲の輪郭は、大きさの違う丸がいくつも重なってできた凹凸なので、
 * ここでは1つの雲を複数の瘤（lobe）の集合として定義する。
 * 単位は雲の基準サイズに対する比率。
 */
const LOBES = [
  { dx: -0.26, dy: 0.06, r: 0.30 },
  { dx: -0.08, dy: -0.10, r: 0.40 },
  { dx: 0.14, dy: -0.04, r: 0.34 },
  { dx: 0.32, dy: 0.08, r: 0.26 },
  { dx: -0.02, dy: 0.14, r: 0.32 },
  { dx: 0.20, dy: 0.16, r: 0.22 },
  { dx: -0.34, dy: 0.16, r: 0.20 },
]

/**
 * 雲の配置。
 *
 * depth は奥行き。手前の雲ほど速く大きく動いて、視差で厚みが出る。
 * 全部が同じ速さで広がると、1枚の絵が拡大しただけに見える。
 */
const CLOUDS = [
  { x: -0.34, y: -0.30, s: 1.05, depth: 1.00, o: 0.97, spin: -7 },
  { x: 0.36, y: -0.20, s: 0.92, depth: 0.86, o: 0.94, spin: 6 },
  { x: -0.10, y: 0.02, s: 1.25, depth: 1.15, o: 0.99, spin: 3 },
  { x: 0.30, y: 0.26, s: 0.88, depth: 0.78, o: 0.92, spin: -5 },
  { x: -0.36, y: 0.28, s: 0.80, depth: 0.68, o: 0.88, spin: 8 },
  { x: 0.06, y: -0.40, s: 0.72, depth: 0.60, o: 0.84, spin: -4 },
  { x: -0.02, y: 0.44, s: 0.68, depth: 0.55, o: 0.82, spin: 5 },
]

/** 覆うまで。呼び出し側もこの間にカメラを寄せはじめるので公開する */
export const COVER_MS = 300
const HOLD_MS = 110    // 覆ったまま保持（この間にカメラを飛ばす）
/** 抜けるまで。呼び出し側はこの間に最後の寄りを見せる */
export const CLEAR_MS = 820

/**
 * 県からエリアへ降りるときの「雲を抜ける」演出。
 *
 * 動きの設計:
 *   1. 雲が下から湧き上がりつつ手前に迫って画面を覆う（速い / ease-in）
 *   2. 覆っている間にカメラを移動する（切り替わりを見せない）
 *   3. 雲が外へ流れながら薄れて抜ける（ゆっくり / ease-out）
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

    // 画面を離れたあとに setState しないための番人と、途中停止用の参照
    const mounted = useRef(true)
    const running = useRef<Animated.CompositeAnimation | null>(null)

    useEffect(() => {
      mounted.current = true
      return () => {
        mounted.current = false
        running.current?.stop()
        running.current = null
        busy.current = false
      }
    }, [])

    const fly = useCallback(
      ({ onCovered, onClearing, onSkip }: CloudTransitionSteps) => {
        if (busy.current) return
        busy.current = true

        /** 演出せずに即座に移動する経路。失敗時もここへ落とす */
        const skip = () => {
          if (onSkip) onSkip()
          else {
            onCovered()
            onClearing?.()
          }
          busy.current = false
        }

        AccessibilityInfo.isReduceMotionEnabled()
          .then((reduce) => {
            // 視覚効果を減らす設定のときは演出しない
            if (reduce || !mounted.current) { skip(); return }

            setActive(true)
            t.setValue(0)

            const cover = Animated.sequence([
              Animated.timing(t, {
                toValue: 1,
                duration: COVER_MS,
                easing: Easing.in(Easing.quad),
                useNativeDriver: true,
              }),
              Animated.delay(HOLD_MS),
            ])
            running.current = cover

            cover.start(({ finished }) => {
              // 途中で止められた（画面を離れた）場合はここで終わり
              if (!finished || !mounted.current) { busy.current = false; return }

              onCovered()

              // 晴れはじめと同時に最後の寄りを走らせる。
              // 雲が薄くなっていく裏で地面が近づくので、
              // 抜けた瞬間には「降りてきた」結果だけが見えている。
              onClearing?.()

              const clear = Animated.timing(t, {
                toValue: 2,
                duration: CLEAR_MS,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
              })
              running.current = clear

              clear.start(() => {
                running.current = null
                if (mounted.current) setActive(false)
                busy.current = false
              })
            })
          })
          .catch(() => {
            // ★ 取得に失敗しても busy を必ず解放する。
            //   ここを握りつぶすと busy が true のまま残り、
            //   その画面では以後すべての地域タップが無視される。
            skip()
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

        {CLOUDS.map((c, i) => {
          const size = base * 0.92 * c.s

          // 手前に迫って、通り過ぎて外へ開いていく。
          // depth が大きい（手前の）雲ほど大きく速く動く。
          const scale = t.interpolate({
            inputRange: [0, 1, 2],
            outputRange: [0.62, 1.06 + c.depth * 0.06, 1.9 + c.depth * 1.6],
          })

          // 中心から外へ逃がす。通過している感を出す
          const tx = t.interpolate({
            inputRange: [0, 1, 2],
            outputRange: [
              c.x * base * 0.42,
              c.x * base * 0.86,
              c.x * base * (1.9 + c.depth * 1.2),
            ],
          })

          // 覆うときは下から湧き上がらせる。上下対称に広がるより雲らしい
          const ty = t.interpolate({
            inputRange: [0, 1, 2],
            outputRange: [
              c.y * base * 0.42 + base * 0.10,
              c.y * base * 0.86,
              c.y * base * (1.9 + c.depth * 1.2) - base * 0.12,
            ],
          })

          // わずかに回して、同じ輪郭の使い回しに見えないようにする
          const rotate = t.interpolate({
            inputRange: [0, 2],
            outputRange: ['0deg', `${c.spin}deg`],
          })

          const opacity = t.interpolate({
            inputRange: [0, 0.7, 1, 1.5, 2],
            outputRange: [0, c.o, c.o, c.o * 0.45, 0],
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
                opacity,
                transform: [
                  { translateX: tx },
                  { translateY: ty },
                  { scale },
                  { rotate },
                ],
              }}
            >
              {/* 瘤を重ねて、ひとつの雲の輪郭を作る。
                  半透明を重ねると濃度の差が出て、平らな白い板にならない */}
              {LOBES.map((l, j) => {
                const d = size * l.r * 2
                return (
                  <View
                    key={j}
                    style={{
                      position: 'absolute',
                      left: size / 2 + l.dx * size - d / 2,
                      top: size / 2 + l.dy * size - d / 2,
                      width: d,
                      height: d,
                      borderRadius: d / 2,
                      backgroundColor: isDark
                        ? 'rgba(226,222,215,0.42)'
                        : 'rgba(255,255,255,0.86)',
                    }}
                  />
                )
              })}
            </Animated.View>
          )
        })}
      </View>
    )
  }
)
