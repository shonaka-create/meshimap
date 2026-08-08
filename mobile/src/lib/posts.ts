import type { Post } from './types'

/**
 * 投稿を取得するときの共通 select 句。
 * author の別名は profiles への外部キー名で明示しないと
 * Supabase が関係を解決できない（posts_user_id_fkey）。
 */
export const POST_SELECT =
  '*, author:profiles!posts_user_id_fkey(id, username, display_name, photo_url), post_images(url, position)'

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
    images,
  }
}
