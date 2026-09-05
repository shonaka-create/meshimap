/**
 * スモークテスト（screens.test.tsx）が使う、DBの返事の見本。
 *
 * ★ 別ファイルにしてある理由。
 *   jest.mock の工場は巻き上げられて、外の変数より先に走る。
 *   同じファイルに定数を置くと、工場の中から触れない
 *   （「Invalid variable access」で落ちる）。
 *   工場の中で require するぶんには実行時なので問題ない。
 *
 * ★ 空にしないこと。
 *   0件だと、どの画面も EmptyState だけ描いて終わってしまい、
 *   一覧を組み立てる本体のコードが一度も走らない。
 *   それでは「開いたら落ちる」を捕まえるという目的を果たさない。
 */

export const ME = '11111111-1111-1111-1111-111111111111'

export const PROFILE = {
  id: ME,
  username: 'ebichan',
  display_name: 'えびちゃん',
  bio: 'テスト',
  photo_url: null,
  avatar_emoji: null,
  is_public: true,
  is_admin: false,
  is_demo: false,
  posts_count: 1,
  areas_count: 1,
  followers_count: 0,
  following_count: 0,
  impressions_count: 0,
  created_at: '2026-08-01T00:00:00.000Z',
}

export const POST = {
  id: 'p1',
  user_id: ME,
  caption: 'テスト投稿',
  rating: 5,
  genre: 'イタリアン',
  price_range: '¥3,001〜¥5,000',
  location_name: 'テスト店',
  location_lat: 35.7018,
  location_lng: 139.7405,
  prefecture: '東京都',
  area: '神楽坂',
  city: null,
  situations: ['デート'],
  hashtags: ['テスト'],
  is_public: true,
  likes_count: 1,
  comments_count: 0,
  impressions_count: 3,
  created_at: '2026-09-01T00:00:00.000Z',
  post_images: [{ url: 'https://example.com/a.jpg', position: 0 }],
  profiles: {
    id: ME,
    username: 'ebichan',
    display_name: 'えびちゃん',
    photo_url: null,
    avatar_emoji: null,
    is_demo: false,
  },
}
