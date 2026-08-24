import { useCallback, useEffect, useRef, useState } from 'react'
import * as Location from 'expo-location'

export interface Coords {
  latitude: number
  longitude: number
}

type PermissionState = 'unknown' | 'granted' | 'denied'

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
   */
  const locate = useCallback(async (): Promise<Coords | null> => {
    setLocating(true)
    try {
      if (!(await ensurePermission())) return null

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      })
      const next = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
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
