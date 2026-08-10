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
  /** 制覇したエリア数。ランクの判定に使う。トリガーが維持する */
  areas_count: number
  /** 自分の投稿が通算で何回表示されたか。月間ランクは monthly_standing で別に引く */
  impressions_count: number
  /**
   * デモ用のアカウントか。
   *
   * デモデータには実在の店が入っているが、書いた人物は架空で、
   * 評価も一律に付けてある。実際の訪問に基づくレビューと
   * 見分けがつかないと困るので、画面に明示する。
   * アプリからは変更できない（移行0010 のトリガーが差し戻す）。
   */
  is_demo: boolean
  /** 選択中のアバター絵柄。ランクで解放される。null なら photo_url を使う */
  avatar_emoji: string | null
  created_at: string
}

/**
 * 地図に出す人のアイコン（map_pins RPC）。
 * 現在地ではなく「最後に投稿したお店」の座標。
 */
export interface MapPin {
  user_id: string
  username: string
  display_name: string
  photo_url: string | null
  avatar_emoji: string | null
  rank: number
  posts_count: number
  areas_count: number
  location_name: string
  location_lat: number
  location_lng: number
  posted_at: string
  is_me: boolean
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
  /** 表示回数。1人1日1回、投稿者以外の閲覧だけを数える */
  impressions_count: number
  /**
   * 直近でよく見られている間だけDBが更新し続ける時刻。
   * 「注目」かどうかの判定は isFeatured() を使う（期限が入るため）。
   */
  featured_at: string | null
  created_at: string
  /**
   * 結合で載る。
   * posts_count / areas_count はランク（rankOf）の判定に要る。
   * 検索結果で「どのランクの人の投稿か」を出すために持つ。
   */
  author?: Pick<
    Profile,
    'id' | 'username' | 'display_name' | 'photo_url' | 'is_demo'
    | 'posts_count' | 'areas_count' | 'avatar_emoji'
  >
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
