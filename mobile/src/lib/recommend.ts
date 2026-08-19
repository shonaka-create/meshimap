import { supabase } from './supabase'
import { formatImpressions } from './impressions'

/**
 * 「今日どこ行く？」の提案。
 *
 * ★ 順番を決めているのは supabase/migrations/0011_recommend_spots.sql。
 *   ここは呼び出しと表示だけを持つ。端末で並べ替えないのは、
 *   ①候補を全部ダウンロードすることになる ②端末ごとに順番が変えられる
 *   の2点で、どちらも「なぜこの店が上なのか」を説明できなくするため。
 *
 * 検索との役割分担:
 *   検索 … 名前を知っているものを探す（自由入力）
 *   提案 … 行き先が決まっていないので選ばせる（入力欄を置かない）
 */

/**
 * どこまでを候補にするか。
 *
 * どちらを選んでも RLS より広くはならない。
 * 'all' は「自分に見える投稿」＝ 公開アカウントの公開投稿＋フォロー中＋運営で、
 * 'following' はそこからフォロー中の人だけに絞る。
 */
export type RecommendScope = 'all' | 'following'

export interface RecommendParams {
  situations: string[]
  genres: string[]
  prices: string[]
  scope: RecommendScope
  /** 現在地。null なら距離の加点は効かない（半径も無視される） */
  coords: { latitude: number; longitude: number } | null
  /** 現在地からの半径(km)。null なら距離で絞らない */
  radiusKm: number | null
  /** 自分が既に投稿した店を外すか */
  excludeVisited: boolean
  limit?: number
}

/** recommend_spots RPC の1行。1行 = 1店（同じ店の投稿はまとめてある） */
export interface Spot {
  /** 代表として見せる投稿。写真とキャプションはこれ */
  post_id: string
  location_name: string
  prefecture: string | null
  area: string | null
  location_lat: number
  location_lng: number
  genre: string
  price_range: string
  image_url: string | null
  author_username: string | null
  author_name: string | null
  avg_rating: number
  /** その店に投稿した人数 */
  visitors: number
  /** うち、自分がフォローしている人の数 */
  following_visitors: number
  impressions: number
  is_featured: boolean
  /** デモアカウントの投稿を含むか。含むなら画面で断る（移行0010） */
  has_demo: boolean
  posts_count: number
  last_posted_at: string
  /** 現在地を渡したときだけ入る */
  distance_km: number | null
  /** 選んだ場面のうち、この店で満たされたもの */
  matched_situations: string[]
  score: number
}

/** 現在地から探すときに選べる半径。null は「こだわらない」 */
export const RADIUS_OPTIONS: readonly { label: string; km: number | null }[] = [
  { label: '徒歩圏（1km）', km: 1 },
  { label: '近所（3km）', km: 3 },
  { label: '少し足をのばす（10km）', km: 10 },
  { label: 'どこでも', km: null },
]

export async function fetchRecommendations(p: RecommendParams): Promise<Spot[]> {
  const { data, error } = await supabase.rpc('recommend_spots', {
    p_situations: p.situations,
    p_genres: p.genres,
    p_prices: p.prices,
    p_scope: p.scope,
    p_lat: p.coords?.latitude ?? null,
    p_lng: p.coords?.longitude ?? null,
    // 現在地が無いのに半径を送ると、DB側では距離が NULL になって
    // 絞り込みが素通りする。意図が読めない値は送らない。
    p_radius_km: p.coords ? p.radiusKm : null,
    p_exclude_visited: p.excludeVisited,
    p_limit: p.limit ?? 30,
  })

  if (error) {
    console.warn('[recommend] 提案の取得に失敗', error.message)
    throw new Error(error.message)
  }
  return (data ?? []) as Spot[]
}

/**
 * 「なぜこの店が出たのか」を短い札にして返す。
 *
 * 並び順そのものは説明しない（重みの合計は人には読めない）。
 * 代わりに、上位に来た理由として効いたものだけを、効いた順に並べる。
 * 画面では先頭2〜3枚だけ出せばよい。
 */
export function reasonsOf(spot: Spot): string[] {
  const out: string[] = []

  if (spot.matched_situations.length > 0) {
    out.push(`${spot.matched_situations.join('・')} に合う`)
  }
  if (spot.distance_km !== null) {
    out.push(formatDistance(spot.distance_km))
  }
  if (spot.following_visitors > 0) {
    out.push(`フォロー中の${spot.following_visitors}人が訪問`)
  } else if (spot.visitors > 1) {
    out.push(`${spot.visitors}人が訪問`)
  }
  if (spot.is_featured) {
    out.push('いま注目')
  }
  // 届いた人数は、少ないうちは出さない。「3人が見た」は推す根拠にならない。
  if (spot.impressions >= 100) {
    out.push(`${formatImpressions(spot.impressions)}人が見た`)
  }

  return out
}

/** 1km 未満は m で出す。「0.4km」は距離感がつかみにくい */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 100) * 10}m`
  return `${km.toFixed(1)}km`
}
