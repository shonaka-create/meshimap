/**
 * ランク。
 *
 * 「何件投稿したか」だけを見ると、同じ店に通うだけで上がってしまう。
 * 食べ歩きアプリなので「いくつの街で食べたか」を併せて条件にする。
 *
 * ★ しきい値は supabase/migrations/0004_ranks_and_map_pins.sql の
 *   rank_of() と同じ値。片方だけ変えないこと。
 *   表示はここ、解放の可否判定はDB、と役割を分けている
 *   （端末側の値を書き換えても未解放の絵柄は保存されない）。
 */

export interface Rank {
  level: number
  name: string
  /** 到達に必要な投稿数 */
  posts: number
  /** 到達に必要な制覇エリア数 */
  areas: number
  /** アイコンの枠の色 */
  frame: string
  /** 枠の太さ */
  frameWidth: number
  /** ランクアップで解放されるものの説明 */
  note: string
}

export const RANKS: readonly Rank[] = [
  { level: 1, name: '見習い',     posts: 0,   areas: 0,  frame: '#B9AFA5', frameWidth: 2, note: 'はじめの一歩' },
  { level: 2, name: '常連',       posts: 10,  areas: 3,  frame: '#B87333', frameWidth: 2, note: '銅の枠' },
  { level: 3, name: '食べ歩き人', posts: 30,  areas: 10, frame: '#9AA5B1', frameWidth: 3, note: '銀の枠' },
  { level: 4, name: 'グルメ長',   posts: 60,  areas: 20, frame: '#D9A441', frameWidth: 3, note: '金の枠' },
  { level: 5, name: '美食家',     posts: 100, areas: 30, frame: '#C56BD6', frameWidth: 4, note: '最上位の枠' },
] as const

/** 投稿数と制覇エリア数から現在のランクを求める */
export function rankOf(postsCount: number, areasCount: number): Rank {
  // 上から順に、条件を満たす最初のものを返す
  for (let i = RANKS.length - 1; i >= 0; i--) {
    const r = RANKS[i]
    if (postsCount >= r.posts && areasCount >= r.areas) return r
  }
  return RANKS[0]
}

/** 次のランク。最上位なら null */
export function nextRank(current: Rank): Rank | null {
  return RANKS.find((r) => r.level === current.level + 1) ?? null
}

/**
 * 次のランクまでの進捗（0〜1）。
 * 投稿数とエリア数の両方が条件なので、**達成率が低い方**を進捗とする。
 * 「投稿は足りているがエリアが足りない」ときに満タンに見えると嘘になる。
 */
export function progressToNext(
  postsCount: number,
  areasCount: number,
  current: Rank,
  next: Rank | null
): number {
  if (!next) return 1
  const p = (postsCount - current.posts) / Math.max(next.posts - current.posts, 1)
  const a = (areasCount - current.areas) / Math.max(next.areas - current.areas, 1)
  return Math.max(0, Math.min(1, Math.min(p, a)))
}

/** 次のランクに足りていないものを日本語で返す */
export function remainingToNext(
  postsCount: number,
  areasCount: number,
  next: Rank | null
): string | null {
  if (!next) return null
  const parts: string[] = []
  if (postsCount < next.posts) parts.push(`あと${next.posts - postsCount}件の投稿`)
  if (areasCount < next.areas) parts.push(`あと${next.areas - areasCount}エリア`)
  return parts.length ? `${next.name}まで ${parts.join(' / ')}` : `${next.name}に到達できます`
}

/** avatar_emojis テーブルの1行 */
export interface AvatarEmoji {
  emoji: string
  min_rank: number
  sort_order: number
}
