import type { Post } from './types'

/**
 * 投稿を取得するときの共通 select 句。
 * author の別名は profiles への外部キー名で明示しないと
 * Supabase が関係を解決できない（posts_user_id_fkey）。
 *
 * ★ author は列を並べずに * にしてある。
 *   列名を並べると、まだ移行を流していないDBに対しては
 *   「そんな列は無い」で投稿の取得ごと失敗する。
 *   アプリを先に更新した瞬間に、地図も検索も全部空になる。
 *   profiles は1行が小さいので、余分に取る不利より
 *   順序を間違えても壊れないことを取る。
 */
export const POST_SELECT =
  '*, author:profiles!posts_user_id_fkey(*), post_images(url, position)'

/** Supabase の行を Post 型へ。画像は position 順に並べ直す。 */
export function toPost(row: Record<string, any>): Post {
  const images = ((row.post_images as { url: string; position: number }[]) ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((i) => i.url)

  return {
    ...(row as Post),
    hashtags: row.hashtags ?? [],
    author: row.author ?? undefined,
    // 移行 0008 を流す前のDBでは列が無いので、無ければ 0 として扱う
    impressions_count: row.impressions_count ?? 0,
    featured_at: row.featured_at ?? null,
    images,
  }
}
