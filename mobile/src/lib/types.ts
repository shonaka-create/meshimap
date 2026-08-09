import type { Genre, PriceRange } from '../theme'

/** profiles テーブル */
export interface Profile {
  id: string
  /** ユーザーID(@handle)。小文字英字のみ・一意・変更可だが重複不可 */
  username: string
  /** アカウント名。表示名。重複OK */
  display_name: string
  photo_url: string | null
  bio: string
  /** 公開アカウントかどうか。false なら投稿はフォロワー限定 */
  is_public: boolean
  followers_count: number
  following_count: number
  posts_count: number
  created_at: string
}

/** posts テーブル + 結合結果 */
export interface Post {
  id: string
  user_id: string
  caption: string
  rating: number
  genre: Genre
  price_range: PriceRange
  location_name: string
  location_lat: number
  location_lng: number
  /** 初期は false（非公開）。ユーザーが明示的に公開する */
  is_public: boolean
  prefecture: string | null
  city: string | null
  /** 地図の第2階層。「新宿」「すすきの」など。内蔵データから決まる */
  area: string | null
  /** 「デート」「女子会」など。複数選択 */
  situations: string[]
  hashtags: string[]
  likes_count: number
  comments_count: number
  created_at: string
  /** 結合で載る */
  author?: Pick<Profile, 'id' | 'username' | 'display_name' | 'photo_url'>
  images: string[]
}

/**
 * 地図のドリルダウン階層。
 * 第2階層の「エリア」は主要駅・繁華街（新宿・すすきの・河原町 など）で、
 * 内蔵の座標データから判定するため API を消費しない。
 */
export type RegionLevel = 'prefecture' | 'area'

export interface RegionCount {
  name: string
  post_count: number
  center_lat: number
  center_lng: number
}

export type FollowStatus = 'pending' | 'accepted'

export const REPORT_REASONS = [
  'スパムまたは詐欺',
  'ヌードまたは性的な内容',
  'ヘイトスピーチや差別',
  '暴力的・危険な内容',
  '虚偽の情報',
  '知的財産権の侵害',
  'その他',
] as const

export type ReportReason = (typeof REPORT_REASONS)[number]
