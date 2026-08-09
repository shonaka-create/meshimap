import Constants from 'expo-constants'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { nearestArea, nearestPrefecture, PREFECTURE_BY_ID } from './regions'

const KEY =
  process.env.EXPO_PUBLIC_GOOGLE_GEOCODING_KEY ??
  (Constants.expoConfig?.extra?.googleGeocodingKey as string | undefined)

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

/* ─────────────────────────  Google Geocoding  ───────────────────────── */

interface AddressComponent {
  long_name: string
  short_name: string
  types: string[]
}

function pick(components: AddressComponent[], type: string): string | null {
  return components.find((c) => c.types.includes(type))?.long_name ?? null
}

/**
 * 緯度経度 → 都道府県 / 市区町村（Google Geocoding API）
 *
 * 日本の住所は自治体の種類で構成要素が変わるので素直に取れない:
 *   東京都新宿区   → administrative_area_level_1=東京都, locality=新宿区
 *   大阪府大阪市北区 → administrative_area_level_1=大阪府, locality=大阪市,
 *                     sublocality_level_1=北区
 * 政令指定都市は「市＋区」を繋げないと集計単位として粗すぎるため、
 * locality が「市」で終わり sublocality_level_1 がある場合だけ連結する。
 */
async function geocodeViaApi(
  lat: number,
  lng: number
): Promise<{ prefecture: string | null; city: string | null }> {
  if (!KEY) return { prefecture: null, city: null }

  try {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?latlng=${lat},${lng}&language=ja&result_type=street_address|premise|political&key=${KEY}`
    const res = await fetch(url)
    const json = await res.json()

    if (json.status !== 'OK' || !json.results?.length) {
      // ZERO_RESULTS は海上などで普通に起きるので警告に留める
      if (json.status !== 'ZERO_RESULTS') {
        console.warn('[geocode] API:', json.status, json.error_message ?? '')
      }
      return { prefecture: null, city: null }
    }

    const components: AddressComponent[] = json.results[0].address_components ?? []

    const prefecture = pick(components, 'administrative_area_level_1')
    const locality = pick(components, 'locality')
    const ward = pick(components, 'sublocality_level_1')
    const level2 = pick(components, 'administrative_area_level_2')

    let city: string | null = locality ?? level2 ?? ward
    if (locality && ward && locality.endsWith('市')) {
      city = `${locality}${ward}` // 例: 大阪市北区
    }

    return { prefecture, city }
  } catch (e) {
    console.warn('[geocode] API 呼び出しに失敗', e)
    return { prefecture: null, city: null }
  }
}

/* ─────────────────────────  本体  ───────────────────────── */

/**
 * 投稿地点の都道府県・エリアを決める。
 *
 * API 消費を抑えるため、次の順に試す:
 *   1. 内蔵データ（47都道府県 + 主要144エリア）… 通信なし・費用ゼロ
 *   2. 端末キャッシュ … 一度引いた座標は二度と課金されない
 *   3. Google Geocoding … 1 と 2 で決まらなかったときだけ
 *   4. 最寄り都道府県 … API も失敗したときの最後の砦
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

  // 3. Google Geocoding
  const { prefecture, city } = await geocodeViaApi(lat, lng)
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
