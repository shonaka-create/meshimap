import * as Location from 'expo-location'
import { AREAS, PREFECTURES, PREFECTURE_BY_ID, nearestArea, nearestPrefecture } from './regions'

/**
 * 場所を言葉で探す。投稿するときにピンを置くために使う。
 *
 * それまでは「現在地」か「地図をタップ」の2つしか無かった。
 * 家に帰ってから昼の店を投稿する、というのがいちばん多い使われ方なのに、
 * その場合は地図を指でたぐって店を探すしかなかった。
 *
 * ★ 費用をかけないこと。
 *
 *   Places API（テキスト検索）を使えば店名で引けるが、
 *   単価が Geocoding の6倍以上（約 $32/1,000）で無料枠も半分しかない。
 *   このアプリは地図の階層データを内蔵することで Places を外してある
 *   （docs/IOS_RELEASE.md の 2-1）。ここで戻すと、その判断が無になる。
 *
 *   代わりに、費用の出ない2つだけを使う:
 *     1. 内蔵のエリアデータ（307件）+ 都道府県（47件）… 通信すら無い
 *     2. 端末の地理コーダ（expo-location の geocodeAsync）
 *        iOS では CLGeocoder。住所・地名・主要な施設が引けて、
 *        Apple のサービスなので呼び出し料金が発生しない。
 *
 *   店名そのもの（「麺屋 こうじ」など）は 2 では引けないことがある。
 *   そのときは近くの駅名や住所で寄せてから、地図で微調整してもらう。
 *   店名で直接引きたくなったら Places の契約が要る、という線引き。
 */

export interface PlaceHit {
  /** 一覧に出す見出し */
  name: string
  /** 見出しの下に出す補足。どこの何なのかを取り違えないため */
  detail: string
  latitude: number
  longitude: number
  /** どこから来た候補か。内蔵は必ず上に出す */
  source: 'local' | 'device'
}

/** 端末の地理コーダを待つ上限(ms)。返らないことがあるので必ず打ち切る */
const GEOCODE_TIMEOUT_MS = 6000

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
const MAX_LOCAL = 8
const MAX_DEVICE = 5

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
 * 内蔵データの結果を先に返し、端末の地理コーダの結果を後ろに足す。
 * どちらも失敗しても空配列を返すだけで、投稿は止めない。
 * 日本の外に出た候補は落とす（このアプリは国内しか扱えない）。
 */
export async function searchPlaces(query: string): Promise<PlaceHit[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const local = searchLocal(q)
  const seen = new Set(local.map((h) => keyOf(h.latitude, h.longitude)))

  const geocoded = await withTimeout(Location.geocodeAsync(q), GEOCODE_TIMEOUT_MS)

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
    })

    if (device.length >= MAX_DEVICE) break
  }

  return [...local, ...device]
}
