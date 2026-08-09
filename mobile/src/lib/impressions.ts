import { supabase } from './supabase'

/**
 * インプレッション（表示回数）と、そこから決まる「注目」「月間ランク」。
 *
 * ★ しきい値は supabase/migrations/0008_impressions_featured_monthly.sql と
 *   同じ値。片方だけ変えないこと。
 *   数える・判定するのはDB、見せるのはここ、と役割を分けている
 *   （端末側の値を書き換えても、DBに入る数字は変わらない）。
 */

/** 注目に必要な、直近の閲覧人数 */
export const FEATURED_THRESHOLD = 20

/** 注目の集計期間 兼 表示期間（日） */
export const FEATURED_WINDOW_DAYS = 7

/**
 * 月間ランクの段位。
 *
 * 通算ではなく月で区切るのは、先に始めた人が上に居座り続けると
 * 後から入った人に追いつく道が無くなるため。毎月ゼロから始まる。
 */
export interface MonthlyTier {
  level: number
  name: string
  /** 到達に必要な、その月の表示回数 */
  impressions: number
  color: string
  note: string
}

export const MONTHLY_TIERS: readonly MonthlyTier[] = [
  { level: 0, name: 'ランク外', impressions: 0,    color: '#B9AFA5', note: 'まだ集計中' },
  { level: 1, name: '芽',       impressions: 100,  color: '#B87333', note: '見つかりはじめた' },
  { level: 2, name: '灯',       impressions: 500,  color: '#9AA5B1', note: '読まれている' },
  { level: 3, name: '常連客',   impressions: 2000, color: '#D9A441', note: '街に知られている' },
  { level: 4, name: '今月の顔', impressions: 8000, color: '#C56BD6', note: '今月いちばん届いた層' },
] as const

export function monthlyTierOf(impressions: number): MonthlyTier {
  for (let i = MONTHLY_TIERS.length - 1; i >= 0; i--) {
    if (impressions >= MONTHLY_TIERS[i].impressions) return MONTHLY_TIERS[i]
  }
  return MONTHLY_TIERS[0]
}

export function nextMonthlyTier(current: MonthlyTier): MonthlyTier | null {
  return MONTHLY_TIERS.find((t) => t.level === current.level + 1) ?? null
}

/** monthly_standing RPC の1行 */
export interface MonthlyStanding {
  user_id: string
  /** 月初日（日本時間） */
  period: string
  impressions: number
  tier: number
  /**
   * その月の順位。まだ0件ならランク外なので null。
   * ★ position という名前にはできない（DB側で予約語）。
   */
  rank_position: number | null
  /** その月に1件以上届いた人の数 */
  entrants: number
}

/**
 * 「注目」かどうか。
 *
 * featured_at は、直近 FEATURED_WINDOW_DAYS 日の閲覧人数がしきい値に
 * 達している間だけDBが更新し続ける。閲覧が止まれば更新も止まるので、
 * 期間が過ぎたものは自然に外れる（掃除の仕組みが要らない）。
 */
export function isFeatured(featuredAt: string | null | undefined): boolean {
  if (!featuredAt) return false
  const ms = Date.now() - new Date(featuredAt).getTime()
  return ms >= 0 && ms < FEATURED_WINDOW_DAYS * 86_400_000
}

/**
 * 表示回数を1件記録する。
 *
 * 数える条件（公開投稿・投稿者以外・1人1日1回）はすべてDB側で見ている。
 * ここで条件を判定しないのは、端末側の判定は書き換えられるから。
 * 失敗しても画面の邪魔をしたくないので、握りつぶして null を返す。
 *
 * @returns 記録後の総表示回数。数えられなかった場合は現在値
 */
export async function recordImpression(postId: string): Promise<number | null> {
  const { data, error } = await supabase.rpc('record_impression', { p_post: postId })
  if (error) {
    console.warn('[impressions] 記録に失敗', error.message)
    return null
  }
  return typeof data === 'number' ? data : null
}

/** 表示回数の丸め。4桁を超えたら「1.2万」にして桁で圧迫しない */
export function formatImpressions(n: number): string {
  if (n < 10_000) return n.toLocaleString('ja-JP')
  return `${(n / 10_000).toFixed(1).replace(/\.0$/, '')}万`
}
