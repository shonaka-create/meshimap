import Constants from 'expo-constants'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { nearestArea, nearestPrefecture, PREFECTURE_BY_ID } from './regions'
import { supabase } from './supabase'

/**
 * 逆ジオコーディングを頼む先。Web 側の /api/geocode。
 *
 * ★ Google の鍵をアプリに持たせてはいけない。
 *
 *   EXPO_PUBLIC_ を付けた値も、app.config.ts の extra に入れた値も、
 *   配布物の中に入る。取り出すのは難しくない。
 *   そして Geocoding は「ウェブサービス API」なので、
 *   HTTP リファラ制限もバンドルID制限も効かない。
 *   つまり鍵を抜かれたあと、請求を止める手段が無い。
 *
 *   Maps SDK の鍵（ios.config.googleMapsApiKey）とは事情が違う。
 *   あちらはバンドルIDで縛れるので、アプリに入っていてよい。
 *
 *   そこで鍵はサーバーにだけ置き、アプリは自分のログイン済み
 *   トークンを添えて Web のルートに問い合わせる。
 *   誰でも叩ける口にはなっていない（route.ts で検証している）。
 */
const API_BASE = (
  process.env.EXPO_PUBLIC_WEB_URL ??
  (Constants.expoConfig?.extra?.webUrl as string | undefined) ??
  ''
).replace(/\/+$/, '')

export interface RegionInfo {
  prefecture: string | null
  /** 市区町村。API を使ったときだけ入る（ローカル判定では null） */
  city: string | null
  /** 地図の第2階層。「新宿」「すすきの」など。市区町村名が入ることもある */
  area: string | null
  /** どうやって判定したか。計測・デバッグ用 */
  source: 'local' | 'api' | 'fallback'
}

/**
 * 内蔵データで判定を試みる距離のしきい値。
 * これより近いエリアがあれば Google Geocoding を呼ばない。
 *
 * 当初は 15km にしていたが、それだと都市部で
 * 「神楽坂の店が秋葉原と表示される」ような外れ方をした。
 * エリアを225件に増やしたうえで 8km に詰めてある。
 * これを超える地点は素直に API に投げて市区町村名をもらう。
 */
const LOCAL_HIT_METERS = 8000

/* ─────────────────────────  キャッシュ  ─────────────────────────
 * 同じ店に何度も投稿すると同じ座標を何度もジオコーディングすることになる。
 * 座標を小数3桁（約110m）に丸めてキーにし、結果を端末に保存する。
 * 一度引いた場所は二度と API を消費しない。
 */
const CACHE_PREFIX = 'geocache:'
const CACHE_VERSION = 'v1'

function cacheKey(lat: number, lng: number) {
  return `${CACHE_PREFIX}${CACHE_VERSION}:${lat.toFixed(3)},${lng.toFixed(3)}`
}

async function readCache(lat: number, lng: number): Promise<RegionInfo | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(lat, lng))
    return raw ? (JSON.parse(raw) as RegionInfo) : null
  } catch {
    return null
  }
}

async function writeCache(lat: number, lng: number, value: RegionInfo) {
  try {
    await AsyncStorage.setItem(cacheKey(lat, lng), JSON.stringify(value))
  } catch {
    // キャッシュは書けなくても機能に影響しない
  }
}

/* ─────────────────────────  サーバー経由の逆ジオコーディング  ───────────────────────── */

/**
 * 緯度経度 → 都道府県 / 市区町村。
 *
 * 実際に Google を呼ぶのは Web 側の app/api/geocode/route.ts。
 * 日本の住所の組み立て方（政令指定都市の「市＋区」など）も向こうにある。
 * ここで同じ規則を書くと、片方だけ直したときに集計単位がずれる。
 *
 * 失敗しても投稿は止めない。呼び出し元が内蔵データで続けられるよう、
 * どの失敗も { null, null } に畳んで返す。
 */
async function geocodeViaServer(
  lat: number,
  lng: number
): Promise<{ prefecture: string | null; city: string | null }> {
  const none = { prefecture: null, city: null }

  // 公開先がまだ決まっていない環境（開発中など）では呼ばない。
  if (!API_BASE) return none

  // ルートはログイン済みの利用者にだけ答える。1回ごとに課金される口なので、
  // 誰でも叩けるようにはしていない。
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return none

  // AbortSignal.timeout は Hermes に無いことがあるので自前で組む。
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)

  try {
    const res = await fetch(`${API_BASE}/api/geocode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ lat, lng }),
      signal: controller.signal,
    })

    if (!res.ok) {
      console.warn('[geocode] サーバーが', res.status, 'を返しました')
      return none
    }

    const json = (await res.json()) as { prefecture?: string | null; city?: string | null }
    return { prefecture: json.prefecture ?? null, city: json.city ?? null }
  } catch (e) {
    console.warn('[geocode] 問い合わせに失敗', e)
    return none
  } finally {
    clearTimeout(timer)
  }
}

/* ─────────────────────────  本体  ───────────────────────── */

/**
 * 投稿地点の都道府県・エリアを決める。
 *
 * API 消費を抑えるため、次の順に試す:
 *   1. 内蔵データ（47都道府県 + 主要エリア）… 通信なし・費用ゼロ
 *   2. 端末キャッシュ … 一度引いた座標は二度と課金されない
 *   3. サーバー経由の Geocoding … 1 と 2 で決まらなかったときだけ
 *   4. 最寄り都道府県 … それも失敗したときの最後の砦
 *
 * 都市部の投稿はほぼ 1 で解決するので、実運用では
 * Geocoding API はほとんど呼ばれない。
 */
export async function resolveRegion(lat: number, lng: number): Promise<RegionInfo> {
  // 1. 内蔵データ
  const hit = nearestArea(lat, lng, LOCAL_HIT_METERS)
  if (hit) {
    const pref = PREFECTURE_BY_ID[hit.area.prefId]
    return {
      prefecture: pref?.name ?? null,
      city: null,
      area: hit.area.name,
      source: 'local',
    }
  }

  // 2. キャッシュ
  const cached = await readCache(lat, lng)
  if (cached) return cached

  // 3. サーバー経由の Geocoding
  const { prefecture, city } = await geocodeViaServer(lat, lng)
  if (prefecture) {
    const result: RegionInfo = { prefecture, city, area: city, source: 'api' }
    await writeCache(lat, lng, result)
    return result
  }

  // 4. 最後の砦。県境付近では外れうるが、投稿を取りこぼすよりはよい。
  const fallback = nearestPrefecture(lat, lng)
  return {
    prefecture: fallback.prefecture.name,
    city: null,
    area: null,
    source: 'fallback',
  }
}

/** 設定画面などから呼ぶ。キャッシュを消す。 */
export async function clearGeocodeCache() {
  const keys = await AsyncStorage.getAllKeys()
  const mine = keys.filter((k) => k.startsWith(CACHE_PREFIX))
  if (mine.length) await AsyncStorage.multiRemove(mine)
  return mine.length
}
