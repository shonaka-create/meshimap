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
/**
 * 1項目に入れる文字数。
 *
 * ★ SecureStore の上限 2048 は「バイト」だが、ここで数えるのは「文字」。
 *   セッションJSONには表示名がそのまま入る（user_metadata）ので、
 *   日本語が混ざる。日本語は UTF-8 で1文字3バイトなので、
 *   1800文字のところに日本語が多く来ると 2048 バイトを超えうる。
 *   最悪でも全部が日本語（3倍）になると考えて、3で割った値にしておく。
 *   分割数が増えるだけで、正しさのほうが大事。
 */
const CHUNK_LIMIT = 600

const secureAdapter = {
  getItem: async (key: string) => {
    const head = await SecureStore.getItemAsync(key)
    if (head === null) return null
    if (!head.startsWith('__chunks__:')) return head

    // ★ NaN を素通りさせないこと。
    //   NaN だとループが0回で回り、空文字を返す。呼び出し側は
    //   「セッションが無い」と解釈するので、原因の分からないログアウトになる。
    const count = Number(head.slice('__chunks__:'.length))
    if (!Number.isInteger(count) || count <= 0) {
      console.warn('[auth] 保存されたセッションの分割数が読めません', head)
      return null
    }

    let out = ''
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(`${key}__${i}`)
      if (part === null) return null // 壊れている → 未ログイン扱い
      out += part
    }
    return out
  },

  /**
   * ★ 先に消してから書かないこと。最後に head を書いて確定させること。
   *
   *   以前は removeItem で全部消してから書き直していた。
   *   消した後の書き込みが1つでも失敗すると（Keychain が一時的に
   *   使えない、その瞬間にプロセスが落ちる）、**古いセッションも
   *   新しいセッションも無い**状態になり、次の起動でログアウトされる。
   *   この経路はトークン更新のたびに通るので、
   *   「久しぶりに開くとログアウトされている」の残っていた原因がこれ。
   *
   *   本体（チャンク）を先に書き、いちばん最後に head を書く。
   *   head が指し示すまで、新しい中身は使われない。
   *   途中で失敗しても head は古いままなので、古いセッションで動き続ける。
   *   余った古いチャンクは、確定した後に掃除する。
   */
  setItem: async (key: string, value: string) => {
    // 掃除の対象を知るために、書く前の状態を控えておく
    const prevHead = await SecureStore.getItemAsync(key)
    const prevCount = prevHead?.startsWith('__chunks__:')
      ? Number(prevHead.slice('__chunks__:'.length))
      : 0

    /** 確定後に残った古いチャンクを消す。失敗しても実害は無いので握り潰す */
    const sweep = async (from: number) => {
      for (let i = from; i < prevCount; i++) {
        try {
          await SecureStore.deleteItemAsync(`${key}__${i}`)
        } catch {
          // 残っても、head が指していないので読まれない
        }
      }
    }

    if (value.length <= CHUNK_LIMIT) {
      // head をそのまま上書きするので、この1回で確定する
      await SecureStore.setItemAsync(key, value)
      await sweep(0)
      return
    }

    const count = Math.ceil(value.length / CHUNK_LIMIT)
    for (let i = 0; i < count; i++) {
      await SecureStore.setItemAsync(`${key}__${i}`, value.slice(i * CHUNK_LIMIT, (i + 1) * CHUNK_LIMIT))
    }
    // ここで確定
    await SecureStore.setItemAsync(key, `__chunks__:${count}`)
    await sweep(count)
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
