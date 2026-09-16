import Constants from 'expo-constants'
import * as Location from 'expo-location'
import { AREAS, PREFECTURES, PREFECTURE_BY_ID, nearestArea, nearestPrefecture } from './regions'
import { supabase } from './supabase'

/**
 * 場所を言葉で探す。投稿するときにピンを置くために使う。
 *
 * 探し先は4つ。上に出るものほど「狙った店にそのまま当たる」もの:
 *
 *   1. 過去の投稿の店名（known_places / 移行0021）… 通信はするが費用ゼロ
 *   2. 店名の候補（Web の /api/places/search → Google Places）… 費用あり・上限あり
 *   3. 内蔵のエリアデータ（307件）+ 都道府県（47件）… 通信すら無い
 *   4. 端末の地理コーダ（expo-location）… iOS では CLGeocoder。住所・地名向き
 *
 * ★ 2 の鍵をアプリに持たせないこと。
 *   Places は「ウェブサービス API」で、バンドルID制限もリファラ制限も効かない。
 *   鍵はサーバー（Web の /api/places/*）にだけ置き、
 *   アプリはログイン済みトークンを添えて問い合わせる（/api/geocode と同じ作り）。
 *
 * ★ 2 は上限に達すると何も返さない（capped）。
 *   そのときも 1・3・4 で候補は出る。検索そのものは止めない。
 *   上限はサーバー側（consume_place_search）が持っていて、
 *   端末のコードを書き換えても外せない。
 */

export interface PlaceHit {
  /** 一覧に出す見出し */
  name: string
  /** 見出しの下に出す補足。どこの何なのかを取り違えないため */
  detail: string
  /**
   * 座標。店名の候補（source: 'store'）だけは、選ばれるまで座標が無い。
   * 選んだ時点で resolveStoreLocation() を呼んで取りに行く。
   */
  latitude: number | null
  longitude: number | null
  /** どこから来た候補か */
  source: 'known' | 'store' | 'local' | 'device'
  /** source が 'store' のときだけ入る。座標を取りに行くための鍵 */
  placeId?: string
  /**
   * 店そのものを指しているか。
   * true の候補を選んだときは、店名の欄にもその名前を入れてよい。
   * 'local'（街や駅）と 'device'（住所）は店ではないので false。
   */
  isStore: boolean
}

export interface PlaceSearchResult {
  hits: PlaceHit[]
  /** 店名の検索が、今日の上限に達していて使えなかった */
  capped: boolean
}

/** 端末の地理コーダを待つ上限(ms)。返らないことがあるので必ず打ち切る */
const GEOCODE_TIMEOUT_MS = 6000
/** サーバー（Places）を待つ上限(ms) */
const SERVER_TIMEOUT_MS = 8000

/**
 * 日本の範囲。おおよそで、南は波照間、北は択捉、東は南鳥島まで含む。
 *
 * ★ ここから外れた候補は出さないこと。
 *   端末の地理コーダは「paris」でパリを返す。そこにピンを置かれると、
 *   投稿時の resolveRegion が最寄りの「都道府県」を必ず選ぶ作りなので
 *   （lib/geocode.ts の最後の砦）、パリの店が北海道の投稿として
 *   地図に載る。このアプリは47都道府県のデータしか持っていないので、
 *   国外は範囲外だとはっきりさせる。
 */
const JAPAN_BOUNDS = {
  minLat: 20.2,
  maxLat: 45.8,
  minLng: 122.8,
  maxLng: 154.0,
} as const

function isInJapan(lat: number, lng: number): boolean {
  return (
    lat >= JAPAN_BOUNDS.minLat && lat <= JAPAN_BOUNDS.maxLat &&
    lng >= JAPAN_BOUNDS.minLng && lng <= JAPAN_BOUNDS.maxLng
  )
}

/** 出しすぎない。多すぎる候補は選べない */
const MAX_KNOWN = 6
const MAX_STORE = 6
const MAX_LOCAL = 6
const MAX_DEVICE = 3

/** 問い合わせ先。Vercel に公開した Web の URL（lib/geocode.ts と同じ） */
const API_BASE = (
  process.env.EXPO_PUBLIC_WEB_URL ??
  (Constants.expoConfig?.extra?.webUrl as string | undefined) ??
  ''
).replace(/\/+$/, '')

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); console.warn('[place] 検索に失敗', e); resolve(null) }
    )
  })
}

/** 判定用に文字をそろえる。全角英数と大文字の違いで取りこぼさない */
function normalize(s: string): string {
  let t = s.trim()
  if (typeof t.normalize === 'function') t = t.normalize('NFKC')
  return t.toLowerCase()
}

/**
 * 内蔵データから探す。
 *
 * 前方一致を先に、部分一致を後に置く。「新宿」で引いたときに
 * 「新宿」が「西新宿」より下に出ると、探しているものが見つからない。
 */
function searchLocal(query: string): PlaceHit[] {
  const q = normalize(query)
  if (!q) return []

  const scored: { hit: PlaceHit; score: number }[] = []

  for (const area of AREAS) {
    const name = normalize(area.name)
    if (!name.includes(q)) continue

    const pref = PREFECTURE_BY_ID[area.prefId]
    scored.push({
      hit: {
        name: area.name,
        // 「中野」のように同じ名前のエリアが他県にもある。県名を必ず添える
        detail: pref?.name ?? '',
        latitude: area.center[0],
        longitude: area.center[1],
        source: 'local',
        isStore: false,
      },
      score: name === q ? 0 : name.startsWith(q) ? 1 : 2,
    })
  }

  for (const pref of PREFECTURES) {
    const name = normalize(pref.name)
    if (!name.includes(q)) continue
    scored.push({
      hit: {
        name: pref.name,
        detail: '都道府県の中心',
        latitude: pref.center[0],
        longitude: pref.center[1],
        source: 'local',
        isStore: false,
      },
      // 県はエリアより後ろ。粒度が粗いので、狙って選ぶことは少ない
      score: 3,
    })
  }

  return scored
    .sort((a, b) => a.score - b.score || a.hit.name.length - b.hit.name.length)
    .slice(0, MAX_LOCAL)
    .map((s) => s.hit)
}

/**
 * 過去の投稿の店名から探す（費用ゼロ）。
 *
 * 誰かが一度でも登録した店なら、外部を呼ばずに出せる。
 * 非公開の投稿は RLS で最初から入ってこない（移行0021 のコメント参照）。
 */
async function searchKnown(query: string): Promise<PlaceHit[]> {
  const { data, error } = await supabase.rpc('known_places', {
    p_query: query,
    p_limit: MAX_KNOWN,
  })

  if (error) {
    // 移行0021 を流す前のDBではここに来る。候補が減るだけなので黙って続ける。
    console.warn('[place] 過去データの検索に失敗', error.message)
    return []
  }

  const rows = (data ?? []) as {
    name: string
    detail: string | null
    latitude: number
    longitude: number
    posts_count: number
  }[]

  return rows
    .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
    .map((r) => ({
      name: r.name,
      // 「東京都 · 神楽坂 · 3件の投稿」より、場所を先に出したほうが選びやすい
      detail: [r.detail, r.posts_count > 1 ? `${r.posts_count}件の投稿` : null]
        .filter(Boolean)
        .join(' · '),
      latitude: r.latitude,
      longitude: r.longitude,
      source: 'known' as const,
      isStore: true,
    }))
}

/**
 * 店名の候補をサーバー経由で探す（Google Places）。
 *
 * 座標はここでは取らない。候補の時点で全件ぶん取ると、
 * 選ばれなかった候補の分まで課金されるため
 * （選んだ1件だけ resolveStoreLocation で取りに行く）。
 */
async function searchStores(
  query: string,
  coords: { latitude: number; longitude: number } | null
): Promise<{ hits: PlaceHit[]; capped: boolean }> {
  const none = { hits: [], capped: false }

  // 公開先がまだ決まっていない環境（開発中など）では呼ばない
  if (!API_BASE) return none

  let token: string | undefined
  try {
    const { data } = await supabase.auth.getSession()
    token = data.session?.access_token
  } catch (e) {
    console.warn('[place] セッションを読めませんでした', e)
    return none
  }
  if (!token) return none

  // AbortSignal.timeout は Hermes に無いことがあるので自前で組む
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SERVER_TIMEOUT_MS)

  try {
    const res = await fetch(`${API_BASE}/api/places/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        input: query,
        lat: coords?.latitude ?? null,
        lng: coords?.longitude ?? null,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      console.warn('[place] サーバーが', res.status, 'を返しました')
      return none
    }

    const json = (await res.json()) as {
      results?: { placeId: string; name: string; detail: string }[]
      capped?: boolean
    }

    const hits: PlaceHit[] = (json.results ?? []).slice(0, MAX_STORE).map((r) => ({
      name: r.name,
      detail: r.detail,
      latitude: null,
      longitude: null,
      source: 'store',
      placeId: r.placeId,
      isStore: true,
    }))

    return { hits, capped: !!json.capped }
  } catch (e) {
    console.warn('[place] 店名の検索に失敗', e)
    return none
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 選ばれた店の座標を取りに行く。
 *
 * 候補一覧（searchStores）では座標を取っていないので、
 * 押された1件についてだけここで取る。
 * 取れなかったときは null を返し、呼び出し側は
 * 「地図で位置を指定してください」に切り替える。
 */
export async function resolveStoreLocation(
  placeId: string
): Promise<{ latitude: number; longitude: number } | null> {
  if (!API_BASE) return null

  let token: string | undefined
  try {
    const { data } = await supabase.auth.getSession()
    token = data.session?.access_token
  } catch {
    return null
  }
  if (!token) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SERVER_TIMEOUT_MS)

  try {
    const res = await fetch(`${API_BASE}/api/places/detail`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ placeId }),
      signal: controller.signal,
    })

    if (!res.ok) return null

    const json = (await res.json()) as {
      location?: { latitude: number; longitude: number } | null
    }

    const loc = json.location
    if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) return null
    if (!isInJapan(loc.latitude, loc.longitude)) return null

    return { latitude: loc.latitude, longitude: loc.longitude }
  } catch (e) {
    console.warn('[place] 店の座標を取れませんでした', e)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 座標から、この地点をどう呼ぶかを内蔵データで決める。
 *
 * 端末の地理コーダは座標しか返さない（名前を返さない）ので、
 * 補足の行はこちらで作る。逆ジオコーディングを足せばもっと詳しく
 * 出せるが、呼ぶ回数が増えるうえ失敗もするので、内蔵データで足りる
 * ところは内蔵データで済ませる。
 */
function describe(lat: number, lng: number): string {
  const hit = nearestArea(lat, lng, 8000)
  if (hit) {
    const pref = PREFECTURE_BY_ID[hit.area.prefId]
    return [pref?.name, hit.area.name].filter(Boolean).join(' · ')
  }
  return nearestPrefecture(lat, lng).prefecture.name
}

/** 同じ場所を2回出さない。約110m四方に丸めて見る */
function keyOf(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`
}

/**
 * 言葉で場所を探す。
 *
 * 並び順は「店 → 街・住所」。店名を打った人に駅の候補を先に見せない。
 *   1. 過去の投稿にある店（費用ゼロ・座標も表記もこのアプリのもの）
 *   2. 店名の候補（Google Places・上限あり）
 *   3. 内蔵のエリア
 *   4. 端末の地理コーダ
 *
 * どれが失敗しても、残りだけで候補を返す。投稿は止めない。
 * 日本の外に出た候補は落とす（このアプリは国内しか扱えない）。
 */
export async function searchPlaces(
  query: string,
  coords: { latitude: number; longitude: number } | null = null
): Promise<PlaceSearchResult> {
  const q = query.trim()
  if (q.length < 2) return { hits: [], capped: false }

  // ★ 端末の地理コーダはここで走らせ始めること。
  //   サーバーの応答を待ってから始めると、待ち時間が足し算になる
  //   （サーバー8秒 + 端末6秒 = 14秒）。店名検索を足したせいで、
  //   もともと数秒で出ていた駅名の検索まで遅くなる。
  const geocoding = withTimeout(Location.geocodeAsync(q), GEOCODE_TIMEOUT_MS)

  // 過去データと店名の候補は同時に投げる。片方の遅さがもう片方を待たせない。
  const [known, stores] = await Promise.all([
    withTimeout(searchKnown(q), SERVER_TIMEOUT_MS).then((v) => v ?? []),
    withTimeout(searchStores(q, coords), SERVER_TIMEOUT_MS)
      .then((v) => v ?? { hits: [] as PlaceHit[], capped: false }),
  ])

  const local = searchLocal(q)

  // 同じ場所を重ねて出さない。過去データに在る店は、そちらを優先する
  // （座標も店名の表記も、このアプリの中で揃っているため）。
  const seen = new Set<string>()
  for (const h of known) {
    if (h.latitude !== null && h.longitude !== null) seen.add(keyOf(h.latitude, h.longitude))
  }

  // ★ 店名が同じだけで Google の候補を落とさないこと。
  //   チェーン店や同名の店は各地にある。過去データに「用心棒（神保町）」が
  //   あるからといって、いま近くにある同名の別の店を消すと、
  //   目的の店が候補から消えたまま二度と選べない。
  //   過去データには座標があるが、Google の候補は選ばれるまで座標を持たないので、
  //   同じ店かどうかはこの時点では判定できない。判定できないものは残す。
  const storeHits = stores.hits

  const localHits: PlaceHit[] = []
  for (const h of local) {
    if (h.latitude === null || h.longitude === null) continue
    const key = keyOf(h.latitude, h.longitude)
    if (seen.has(key)) continue
    seen.add(key)
    localHits.push(h)
  }

  const geocoded = await geocoding

  const device: PlaceHit[] = []
  for (const g of geocoded ?? []) {
    if (!Number.isFinite(g.latitude) || !Number.isFinite(g.longitude)) continue
    // 国外は出さない。置かれても正しい地域として保存できない
    if (!isInJapan(g.latitude, g.longitude)) continue

    const key = keyOf(g.latitude, g.longitude)
    if (seen.has(key)) continue
    seen.add(key)

    device.push({
      // 端末の地理コーダは名前を返さないので、打った言葉をそのまま見出しにする
      name: q,
      detail: describe(g.latitude, g.longitude),
      latitude: g.latitude,
      longitude: g.longitude,
      source: 'device',
      isStore: false,
    })

    if (device.length >= MAX_DEVICE) break
  }

  return {
    hits: [...known, ...storeHits, ...localHits, ...device],
    capped: stores.capped,
  }
}
