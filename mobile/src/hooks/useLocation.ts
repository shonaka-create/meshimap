import { useCallback, useEffect, useRef, useState } from 'react'
import * as Location from 'expo-location'

export interface Coords {
  latitude: number
  longitude: number
}

type PermissionState = 'unknown' | 'granted' | 'denied'

/**
 * 実測を待つ上限(ms)。
 *
 * 屋外なら数秒で返る。ここで切っても、端末が覚えている位置に
 * 落とすだけなので何も映らなくなることはない。
 * 短くしすぎると、少し待てば取れた正確な位置を捨てることになる。
 */
const LOCATE_TIMEOUT_MS = 10_000

/**
 * 時間内に返らなければ null にする。
 *
 * AbortSignal.timeout は Hermes に無いことがあるので自前で組む
 * （lib/geocode.ts と同じ理由）。元の Promise は止められないが、
 * 待つのをやめるだけなので害は無い。
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); console.warn('[location] 実測に失敗', e); resolve(null) }
    )
  })
}

/**
 * 現在地の取得。
 * 位置情報は「あると便利」であって必須ではないので、
 * 拒否されてもアプリは通常どおり使えるようにする。
 */
export function useLocation() {
  const [coords, setCoords] = useState<Coords | null>(null)
  const [permission, setPermission] = useState<PermissionState>('unknown')
  const [locating, setLocating] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const ensurePermission = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync()
    const ok = status === 'granted'
    if (mounted.current) setPermission(ok ? 'granted' : 'denied')
    return ok
  }, [])

  /**
   * いま測り直して現在地を返す。
   *
   * ★ 呼び出し側は、前に取った coords を使い回さないこと。
   *   「現在地に戻る」を押したのにさっきの場所へ飛ぶと、
   *   ボタンが壊れているようにしか見えない。
   *   getCurrentPositionAsync は毎回きちんと測り直す（数秒かかる）。
   *
   * ★ 精度は High。既定の Balanced は基地局や Wi-Fi だけで済ませることがあり、
   *   数百メートルずれる。「現在地」と言って隣の駅が映ると壊れて見える。
   *
   * ★ 必ず打ち切ること。
   *   getCurrentPositionAsync には時間制限が無い。地下や屋内、
   *   機内モードから戻った直後などでは、要求した精度に届かないまま
   *   いつまでも返ってこないことがある。そのあいだ
   *   「現在地に戻る」のくるくるは回りっぱなしで、
   *   起動時の寄せも来ない（＝日本全体が映ったまま）。
   *   打ち切ったら、端末が覚えている位置で代える。
   *   ずれていても、どこも映らないよりはいい。
   */
  const locate = useCallback(async (): Promise<Coords | null> => {
    setLocating(true)
    try {
      if (!(await ensurePermission())) return null

      const pos = await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        LOCATE_TIMEOUT_MS
      )

      if (pos) {
        const next = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        }
        if (mounted.current) setCoords(next)
        return next
      }

      // 時間内に測りきれなかった。端末が覚えている位置で代える
      console.warn('[location] 実測が時間内に返らないので、最後に知っている位置を使う')
      // ★ 古すぎるものは使わない。
      //   時間の上限を付けないと、昨日いた街に飛ぶことがある。
      //   「現在地に戻る」を押して別の街が映るのは、
      //   何も起きないより悪い。
      const known = await Location.getLastKnownPositionAsync({
        maxAge: 30 * 60 * 1000,
      })
      if (!known) return null

      const next = {
        latitude: known.coords.latitude,
        longitude: known.coords.longitude,
      }
      if (mounted.current) setCoords(next)
      return next
    } catch (e) {
      console.warn('[location] 取得に失敗', e)
      return null
    } finally {
      if (mounted.current) setLocating(false)
    }
  }, [ensurePermission])

  /**
   * 端末が最後に知っている位置。衛星を待たないのですぐ返る。
   *
   * 起動直後に使う繋ぎ。locate() は実測するぶん数秒かかり、
   * そのあいだ日本全体が映っていると「位置がおかしい」と感じる。
   * 10分より古いものは返さない（別の街のものを掴むと逆効果なので）。
   * これで確定させず、あとから locate() の結果で寄せ直すこと。
   */
  const lastKnown = useCallback(async (): Promise<Coords | null> => {
    try {
      if (!(await ensurePermission())) return null

      const pos = await Location.getLastKnownPositionAsync({
        maxAge: 10 * 60 * 1000,
        requiredAccuracy: 1000,
      })
      if (!pos) return null

      return {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      }
    } catch {
      return null
    }
  }, [ensurePermission])

  return { coords, permission, locating, locate, lastKnown }
}
