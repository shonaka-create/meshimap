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

  /** 許可を求めて現在地を1回取得する。ボタンからも初回ロードからも呼ぶ。 */
  const locate = useCallback(async (): Promise<Coords | null> => {
    setLocating(true)
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') {
        if (mounted.current) setPermission('denied')
        return null
      }
      if (mounted.current) setPermission('granted')

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
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
  }, [])

  return { coords, permission, locating, locate }
}
