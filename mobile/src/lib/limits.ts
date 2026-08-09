/**
 * フォローの上限。
 *
 * ★ 数値は supabase/migrations/0005_admin_pin_and_follow_limit.sql の
 *   enforce_follow_limit() と対。片方だけ変えないこと。
 *   ここは表示用で、実際に止めているのはDBのトリガー
 *   （端末側のチェックだけだと API を直接叩けば回避できる）。
 *
 * 運営アカウントはこの数に含まれない。掲載枠なので、
 * 数に入れると実質1人しかフォローできなくなってしまう。
 */
export const FREE_FOLLOW_LIMIT = 2

/** my_follow_quota() の戻り */
export interface FollowQuota {
  used: number
  limit_count: number
  subscribed: boolean
}

/**
 * DBのトリガーが投げたエラーかどうか。
 * メッセージで判定しているのは、PostgREST が独自のエラーコードを
 * そのまま返さないため。トリガー側の文字列と対になっている。
 */
export function isFollowLimitError(e: unknown): boolean {
  const msg = (e as { message?: string })?.message ?? ''
  return msg.includes('follow_limit_reached')
}
