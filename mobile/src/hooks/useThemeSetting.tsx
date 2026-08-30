import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react'
import { useColorScheme } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * 画面の見た目（ライト / ダーク）の設定。
 *
 * それまでは端末の設定にそのまま従っていた（useColorScheme）。
 * ただ「アプリ全体は明るいまま使いたいが、このアプリだけ暗くしたい」
 * （逆も）という要望は普通にあるので、アプリ側でも選べるようにする。
 *
 * ★ 端末に保存する。アカウントには紐づけない。
 *   見え方の好みは「この端末で今どう見たいか」であって、
 *   アカウントの属性ではない。明るい部屋の iPad と暗い寝室の iPhone で
 *   同じ設定を強制されるほうがおかしい。
 *   ログインしていなくても効くべき、という理由もある。
 *
 * ★ SecureStore ではなく AsyncStorage に置く。
 *   秘密ではないし、Keychain は容量が小さい（lib/supabase.ts 参照）。
 */

export type ThemeSetting = 'system' | 'light' | 'dark'

/** 保存先。値の意味を変えるときは v を上げること */
const STORAGE_KEY = 'theme-setting:v1'

export const THEME_SETTINGS: readonly { value: ThemeSetting; label: string; note: string }[] = [
  { value: 'system', label: '端末の設定に合わせる', note: 'iPhone の外観モードに従います' },
  { value: 'light', label: 'ライト', note: '常に明るい配色にします' },
  { value: 'dark', label: 'ダーク', note: '常に暗い配色にします' },
] as const

interface ThemeSettingValue {
  /** 選ばれている設定 */
  setting: ThemeSetting
  /** 実際に適用される配色 */
  resolved: 'light' | 'dark'
  setSetting: (next: ThemeSetting) => void
  /** 保存済みの設定を読み終えたか。読む前に描くと一瞬ちらつく */
  ready: boolean
}

const ThemeSettingContext = createContext<ThemeSettingValue | null>(null)

export function ThemeSettingProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme()
  const [setting, setSettingState] = useState<ThemeSetting>('system')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let active = true

    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (!active) return
        if (saved === 'light' || saved === 'dark' || saved === 'system') {
          setSettingState(saved)
        }
      })
      .catch((e) => {
        // 読めなくても端末の設定で動く。止める理由が無い
        console.warn('[theme] 設定の読み込みに失敗', e)
      })
      .finally(() => { if (active) setReady(true) })

    return () => { active = false }
  }, [])

  const setSetting = useCallback((next: ThemeSetting) => {
    // ★ 保存を待たずに画面へ反映する。
    //   書き込みを待つと、押してから色が変わるまで間が空いて
    //   反応していないように見える。保存に失敗しても、
    //   その場の見た目は正しい（次回の起動で戻るだけ）。
    setSettingState(next)
    AsyncStorage.setItem(STORAGE_KEY, next).catch((e) => {
      console.warn('[theme] 設定の保存に失敗', e)
    })
  }, [])

  const value = useMemo<ThemeSettingValue>(() => ({
    setting,
    resolved: setting === 'system' ? (system === 'dark' ? 'dark' : 'light') : setting,
    setSetting,
    ready,
  }), [setting, system, setSetting, ready])

  return (
    <ThemeSettingContext.Provider value={value}>{children}</ThemeSettingContext.Provider>
  )
}

/**
 * 設定画面から使う。
 * ★ Provider の外で呼ばないこと（設定を変えても保存されない）。
 */
export function useThemeSetting(): ThemeSettingValue {
  const ctx = useContext(ThemeSettingContext)
  if (!ctx) throw new Error('useThemeSetting は ThemeSettingProvider の内側で使ってください')
  return ctx
}

/**
 * いま適用する配色。theme.ts の useTheme から呼ぶ。
 *
 * ★ こちらは Provider の外でも落ちないようにしてある。
 *   useTheme はアプリ中の至るところで呼ばれるので、
 *   1箇所でも Provider の外にあると画面が真っ白になる。
 *   その場合は端末の設定に従う（これまでと同じ挙動）。
 */
export function useResolvedScheme(): 'light' | 'dark' {
  const ctx = useContext(ThemeSettingContext)
  const system = useColorScheme()
  if (ctx) return ctx.resolved
  return system === 'dark' ? 'dark' : 'light'
}
