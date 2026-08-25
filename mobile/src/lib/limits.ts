/**
 * 無料でできることの線引き。
 *
 * 課金の線は「フォローできる人数」ではなく「地図に出せる人数」。
 * フォローは何人でもできる。増やしたフォローを地図に出そうとした
 * ところで初めて上限に当たる（移行 0013）。
 *
 * ★ 数値は supabase/migrations/0013_map_audience_gate.sql の
 *   free_map_users() と対。片方だけ変えないこと。
 *   ここは表示用で、実際に止めているのは
 *   DB の set_map_visible() と map_pins()
 *   （端末側のチェックだけだと API を直接叩けば回避できる）。
 *
 * 運営アカウントはこの数に含まれない。掲載枠なので、
 * 数に入れると実質1人しか地図に出せなくなってしまう。
 */
export const FREE_MAP_LIMIT = 2

/** my_map_quota() の戻り */
export interface MapQuota {
  /** 地図に出している人数（運営を除く） */
  used: number
  limit_count: number
  subscribed: boolean
  /** フォローしている人数（運営を除く）。上限に関わらず増やせる */
  follows_cnt: number
}

/**
 * DBが「もう地図に出せない」と言ったエラーかどうか。
 * メッセージで判定しているのは、PostgREST が独自のエラーコードを
 * そのまま返さないため。set_map_visible() 側の文字列と対になっている。
 */
export function isMapLimitError(e: unknown): boolean {
  const msg = (e as { message?: string })?.message ?? ''
  return msg.includes('map_limit_reached')
}

/**
 * 移行 0013 を流す前のDBが投げるエラー。
 *
 * 0005 のトリガーは、フォローそのものを2人で止めていた。
 * アプリだけ先に更新された端末では、フォローの時点で
 * まだこれが飛んでくるので、拾って案内できるようにしておく。
 */
export function isFollowLimitError(e: unknown): boolean {
  const msg = (e as { message?: string })?.message ?? ''
  return msg.includes('follow_limit_reached')
}
