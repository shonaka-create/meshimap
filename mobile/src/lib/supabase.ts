import 'react-native-url-polyfill/auto'
import { createClient } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppState, Platform } from 'react-native'
import Constants from 'expo-constants'

const extra = Constants.expoConfig?.extra ?? {}

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? (extra.supabaseUrl as string | undefined)
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? (extra.supabaseAnonKey as string | undefined)

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Supabase の URL / anon key が未設定です。mobile/.env に ' +
      'EXPO_PUBLIC_SUPABASE_URL と EXPO_PUBLIC_SUPABASE_ANON_KEY を設定して、' +
      'expo を再起動してください（--clear 推奨）。'
  )
}

/**
 * 認証トークンの保存先。
 * SecureStore は Keychain に入るので AsyncStorage より安全だが、
 * 1項目 2048 バイト制限がある。Supabase のセッションは JWT を含み
 * これを超えることがあるため、溢れたら分割して保存する。
 */
const CHUNK_LIMIT = 1800

const secureAdapter = {
  getItem: async (key: string) => {
    const head = await SecureStore.getItemAsync(key)
    if (head === null) return null
    if (!head.startsWith('__chunks__:')) return head

    const count = Number(head.slice('__chunks__:'.length))
    let out = ''
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(`${key}__${i}`)
      if (part === null) return null // 壊れている → 未ログイン扱い
      out += part
    }
    return out
  },

  setItem: async (key: string, value: string) => {
    // 前回の分割データが残っていると混ざるので先に掃除する
    await secureAdapter.removeItem(key)

    if (value.length <= CHUNK_LIMIT) {
      await SecureStore.setItemAsync(key, value)
      return
    }
    const count = Math.ceil(value.length / CHUNK_LIMIT)
    for (let i = 0; i < count; i++) {
      await SecureStore.setItemAsync(`${key}__${i}`, value.slice(i * CHUNK_LIMIT, (i + 1) * CHUNK_LIMIT))
    }
    await SecureStore.setItemAsync(key, `__chunks__:${count}`)
  },

  removeItem: async (key: string) => {
    const head = await SecureStore.getItemAsync(key)
    if (head?.startsWith('__chunks__:')) {
      const count = Number(head.slice('__chunks__:'.length))
      for (let i = 0; i < count; i++) {
        await SecureStore.deleteItemAsync(`${key}__${i}`)
      }
    }
    await SecureStore.deleteItemAsync(key)
  },
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Web(Expo Go のブラウザ確認用)では SecureStore が使えない
    storage: Platform.OS === 'web' ? AsyncStorage : secureAdapter,
    autoRefreshToken: true,
    persistSession: true,
    // React Native は URL からセッションを拾わない
    detectSessionInUrl: false,
  },
})

/**
 * RN ではタイマーがバックグラウンドで止まるため、
 * フォアグラウンド復帰時にトークン自動更新を回し直す。
 * これが無いと「久しぶりに開くとログアウトされている」が起きる。
 *
 * ★ これをモジュール直下（import された瞬間）で呼ばないこと。
 *   AppState.addEventListener は TurboModule の void メソッドを叩く。
 *   バンドル評価中に叩くと、ネイティブ側が例外を投げたときに
 *   React Native が JS スレッド以外から Hermes を触りにいく
 *   （RCTTurboModule.mm の performVoidMethodInvocation）。
 *   Hermes はスレッドセーフではないのでヒープが壊れ、
 *   原因の分からない SIGSEGV で起動即死する。
 *   マウント後（AuthProvider の effect）から呼べばこの窓に入らない。
 *
 * 戻り値は解除関数。effect の後始末でそのまま返せる。
 */
export function startAuthAutoRefresh(): () => void {
  if (Platform.OS === 'web') return () => {}

  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh()
    else supabase.auth.stopAutoRefresh()
  })

  return () => sub.remove()
}
