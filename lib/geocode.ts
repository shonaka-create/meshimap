import { supabase } from '@/lib/supabase'
import { nearestArea, nearestPrefecture, PREFECTURE_BY_ID } from '@/lib/regions'

/**
 * 投稿地点の都道府県・エリアを決める（Web 版）。
 *
 * mobile/src/lib/geocode.ts と同じ結果を返すことが目的。
 * 判定順も揃えてある:
 *   1. 内蔵データ（47都道府県 + 225エリア）… 通信なし・費用ゼロ
 *   2. セッションキャッシュ … 同じ座標で二度 API を消費しない
 *   3. Google Geocoding（/api/geocode 経由）… 1 と 2 で決まらなかったときだけ
 *   4. 最寄り都道府県 … API も失敗したときの最後の砦
 *
 * 違いは 3 の呼び方だけ。Geocoding はリファラ制限が効かない API なので、
 * ブラウザから直接は呼ばずサーバー側ルートに任せる（app/api/geocode/route.ts）。
 */

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
 * mobile 側と同じ 8km。ここを緩めると
 * 「神楽坂の店が秋葉原と表示される」ような外れ方をする。
 */
const LOCAL_HIT_METERS = 8000

/**
 * 座標 → 判定結果のキャッシュ。
 * 小数3桁（約110m）に丸めてキーにする。mobile は AsyncStorage で端末に永続化するが、
 * Web は投稿のたびにタブを開き直すわけではないのでメモリで足りる。
 */
const cache = new Map<string, RegionInfo>()

function cacheKey(lat: number, lng: number) {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`
}

async function geocodeViaApi(
  lat: number,
  lng: number
): Promise<{ prefecture: string | null; city: string | null }> {
  try {
    // サーバー側ルートは課金対象なので、ログイン済みの人だけが呼べる。
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { prefecture: null, city: null }

    const res = await fetch('/api/geocode', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ lat, lng }),
    })
    if (!res.ok) {
      console.warn('[geocode] /api/geocode が失敗しました:', res.status)
      return { prefecture: null, city: null }
    }
    const json = await res.json()
    return { prefecture: json.prefecture ?? null, city: json.city ?? null }
  } catch (e) {
    console.warn('[geocode] /api/geocode の呼び出しに失敗', e)
    return { prefecture: null, city: null }
  }
}

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
  const cached = cache.get(cacheKey(lat, lng))
  if (cached) return cached

  // 3. Google Geocoding
  const { prefecture, city } = await geocodeViaApi(lat, lng)
  if (prefecture) {
    const result: RegionInfo = { prefecture, city, area: city, source: 'api' }
    cache.set(cacheKey(lat, lng), result)
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
