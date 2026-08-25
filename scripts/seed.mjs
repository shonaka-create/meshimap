/**
 * デモデータ投入スクリプト（新スキーマ対応版）
 *
 *   運営アカウント1件 + デモ6アカウント × 各5投稿
 *   + 相互フォロー + いいね + コメント
 *
 * 旧 seed-users / seed-posts / seed-follows を1本に統合した。
 * 分かれていた頃は3本ともユーザー作成をやっていて、
 * どれを何回流したかで結果が変わっていたため。
 *
 * 新スキーマでの変更点:
 *   - username(ユーザーID) と display_name(アカウント名) を分けて登録する。
 *     username は signUp のメタデータで渡す。DBトリガー handle_new_user が
 *     それを見て profiles を作る（渡さないと自動採番される）。
 *   - profiles.is_public / posts.is_public は既定 false。
 *     デモは見えないと意味がないので明示的に true にする。
 *   - フォローの status はサーバー側トリガーが決める（クライアントは送らない）。
 *     公開アカウントなら accepted。だから **プロフィールを公開にしてから**
 *     フォローを入れる必要がある。
 *   - 各種カウンタはトリガーが更新するので、手動 UPDATE はしない。
 *   - posts に prefecture / area / situations を入れる。
 *
 * 前提:
 *   - supabase/schema.sql と migrations/0001, 0002 を適用済み
 *   - Authentication > Sign In / Providers > 「Confirm email」を OFF
 *
 * 実行:
 *   SEED_PASSWORD='デモ用パスワード' \
 *   SEED_ADMIN_PASSWORD='運営用の別パスワード' \
 *   node scripts/seed.mjs
 *
 * ※ パスワードをこのファイルに書かないこと。
 *   デモ用とはいえ認証情報であり、このリポジトリは公開されている。
 *
 * 投入後、管理者権限の付与だけは SQL Editor から行う:
 *   supabase/scripts/grant-admin.sql
 * （アプリ側からは昇格できないよう移行0003 でトリガーを入れてある）
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** .env.local を読む。既に環境変数にあるものは上書きしない。 */
function loadEnvLocal() {
  const file = path.join(ROOT, '.env.local')
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    const value = m[2].trim().replace(/^["']|["']$/g, '')
    if (value && !process.env[m[1]]) process.env[m[1]] = value
  }
}
loadEnvLocal()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const PASSWORD = process.env.SEED_PASSWORD

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定です')
  console.error('   .env.local に書くか、環境変数で渡してください')
  process.exit(1)
}
if (!PASSWORD || PASSWORD.length < 8) {
  console.error('❌ SEED_PASSWORD が未設定です（8文字以上）')
  console.error("   例: SEED_PASSWORD='choose-your-own' node scripts/seed.mjs")
  process.exit(1)
}

// 運営アカウントはデモ用と同じパスワードにしたくないので分けられるようにする。
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || PASSWORD
if (ADMIN_PASSWORD === PASSWORD) {
  console.warn('⚠️  運営アカウントがデモ用と同じパスワードです。')
  console.warn('   SEED_ADMIN_PASSWORD を別途指定することを推奨します。\n')
}

/**
 * デモアカウントのメールアドレスの作り方。
 *
 * 以前は example.com を直書きしていたが、Supabase(GoTrue) が
 * example.com を「偽ドメイン」として拒否するようになり、
 * `Email address "taro@example.com" is invalid` で全滅するようになった。
 *
 * 環境ごとに通るドメインが違う（MXレコードを見る設定もある）ので、
 * .env.local の SEED_EMAIL_TEMPLATE で差し替えられるようにする。
 * `{u}` が username に置き換わる。
 *   例: 'meshimap+{u}@gmail.com'  … 実在アドレスの + 別名。確実に通る
 *       '{u}@meshimap.app'        … 自前ドメインがあるならこちら
 */
const EMAIL_TEMPLATE = process.env.SEED_EMAIL_TEMPLATE || '{u}@example.com'
const emailFor = (username) => EMAIL_TEMPLATE.replace('{u}', username)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ============================================================
// 運営（管理者）アカウント
//   通報の確認・対応を行うためのアカウント。投稿はしない。
//   is_admin は移行0003 のトリガーによりアプリからは立てられないので、
//   このスクリプトの後に SQL Editor で付与する。
// ============================================================
const ADMIN = {
  username: 'admin',
  // 運営だけは実運用で受信できるアドレスにしたいことが多いので個別に上書きできる。
  // 既に運営アカウントがある環境では、その既存アドレスを指定すること。
  // 違うアドレスを渡すと username 'admin' が衝突し、トリガーが別名を採番して
  // 「二人目の運営」ができてしまう。
  email: process.env.SEED_ADMIN_EMAIL || emailFor('admin'),
  displayName: 'MeshiMap 運営',
  bio: '📮 MeshiMap 運営アカウントです。通報の確認・お問い合わせ対応を行っています。',
  avatarImg: 60,
}

// ============================================================
// アカウント
//   username: 小文字英字のみ3〜20文字（DBの CHECK 制約）。一意。
//   displayName: アプリ上の表示名。重複可。
//   メールは username から SEED_EMAIL_TEMPLATE で組み立てる（上の emailFor）。
// ============================================================
const ALL_USERS = [
  {
    username: 'taro',
    email: emailFor('taro'),
    displayName: '田中太郎',
    // 投稿の語り口と揃える。京都の大学 → 東京、味の基準は関西の出汁のまま。
    // プロフィールと投稿がずれていると、それだけで作り物に見える。
    //
    // ★ 表示名は据え置いてある。ご自身の名義で出すならここを変えること。
    //   username と email は変えないこと（別アカウントが作られる）。
    bio: '同志社→東京。学生時代を京都で過ごしたので、いまも味の基準が関西の出汁のまま。東京と大阪を行き来しながら食べています',
    avatarImg: 11, // pravatar の img 番号
  },
  {
    username: 'hanako',
    email: emailFor('hanako'),
    displayName: '佐藤花子',
    bio: '☕ カフェ・スイーツ大好き女子。おしゃれで美味しいお店を発信中✨ フォロバします',
    avatarImg: 5,
  },
  {
    username: 'kenji',
    email: emailFor('kenji'),
    displayName: '鈴木健二',
    bio: '🥩 肉食系グルメリスト。焼肉・ステーキ・フレンチまで、ちょっといい食事が好き',
    avatarImg: 33,
  },
  {
    username: 'yuki',
    email: emailFor('yuki'),
    displayName: '伊藤由紀',
    bio: '🍣 和食愛好家。寿司・天ぷら・懐石を中心に、日本の食文化を伝えていきたい',
    avatarImg: 20,
  },
  {
    username: 'yamada',
    email: emailFor('yamada'),
    displayName: '山田翔太',
    bio: '🌏 アジアン料理探求家。韓国・中国・タイ・ベトナム料理を東京で食べ歩き！',
    avatarImg: 44,
  },
  {
    username: 'ebisu',
    email: emailFor('ebisu'),
    displayName: 'えびちゃん',
    bio: '🍽️ 恵比寿・中目黒エリアのグルメを中心に食べ歩き。美味しいお店を発信中！',
    avatarImg: 68,
  },
]

/**
 * 実際に作るアカウント。
 *
 * 既定は全6件だが、Supabase のメール送信レート制限に当たる環境や、
 * 「1件だけ見られればいい」ときのために SEED_USERS で絞れるようにする。
 *   例: SEED_USERS='taro'          … taro だけ
 *       SEED_USERS='taro,hanako'   … 2件
 *
 * 絞った場合、フォロー・いいね・コメントは
 * 「作った人どうし」の範囲でしか作られない（1件ならどれも作られない）。
 */
const USERS = (() => {
  const want = (process.env.SEED_USERS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!want.length) return ALL_USERS

  const known = new Set(ALL_USERS.map((u) => u.username))
  const unknown = want.filter((w) => !known.has(w))
  if (unknown.length) {
    console.error(`❌ SEED_USERS に知らない username があります: ${unknown.join(', ')}`)
    console.error(`   選べるのは: ${[...known].join(', ')}`)
    process.exit(1)
  }
  return ALL_USERS.filter((u) => want.includes(u.username))
})()

// ============================================================
// 投稿
//
// prefecture / area は mobile/src/lib/regions.ts の内蔵データで
// 座標から判定した結果を、そのまま値として持たせている。
// （全30件が内蔵データだけで解決し、Geocoding API は1回も呼んでいない）
// situations は theme.ts の SITUATIONS から選ぶ。
// ============================================================
const POSTS_BY_USER = {
  taro: [
    /* ────────────────────────────────────────────────
     * ★ 実在の店。評価は一律★5。
     *
     *   本文は「その店が実際に何で知られているか」だけで書いている。
     *   行った日の出来事や、店主と話した内容のような
     *   確かめようのない作り話は入れていない。
     *   実在の店に架空の体験談を付けると、事実と区別がつかなくなる。
     *
     *   語り口は一人の人物として揃えてある（京都の大学 → 東京。
     *   味の基準が関西の出汁のまま）。関西の店を高く買う理由が
     *   その一貫性から出るようにしてあり、
     *   一件ごとにばらばらの人格が書いたようには見えないようにした。
     *
     *   座標は街区の目安で、建物単位の精度は無い。
     *   エリア判定（最寄り8km）には十分。
     *   npm run check:seed で座標とエリアの食い違いは検出できる。
     * ──────────────────────────────────────────────── */

    /* ── 東京 / ラーメン ───────────────────────── */
    {
      caption: '巣鴨の醤油そば。ミシュランの星が付いたラーメン店として名前が知られているが、実際に食べると納得が先に来る。黒トリュフの香りを乗せても出汁が負けていない。関西の澄んだ汁で育った人間にも、これは通じる',
      rating: 5,
      genre: 'ラーメン',
      price_range: '¥1,001〜¥3,000',
      location_name: 'Japanese Soba Noodles 蔦',
      location_lat: 35.7338,
      location_lng: 139.7385,
      prefecture: '東京都',
      area: '巣鴨',
      situations: ['一人ランチにおすすめ'],
      hashtags: ['ラーメン', '巣鴨', '醤油そば', 'トリュフ'],
      images: ['https://images.unsplash.com/photo-1591814468924-caf88d1232e1?w=800&q=90'],
      daysAgo: 0.5,
    },
    {
      caption: '魚介と動物系を合わせるダブルスープを広めた店。いま当たり前になっている作り方の出どころがここだと思うと、一杯の意味が変わる。中野本店は今も行列が絶えない',
      rating: 5,
      genre: 'ラーメン',
      price_range: '〜¥1,000',
      location_name: '中華そば 青葉 中野本店',
      location_lat: 35.706,
      location_lng: 139.6655,
      prefecture: '東京都',
      area: '中野',
      situations: ['一人ランチにおすすめ'],
      hashtags: ['ラーメン', '中野', 'ダブルスープ', '老舗'],
      images: ['https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=800&q=90'],
      daysAgo: 2,
    },
    {
      caption: '全国に広がった二郎の、いちばん最初の店。慶應の正門前という立地込みで文化になっている。関西にいた頃は縁がなかったので、東京に来て初めて意味が分かった。小でも量は覚悟すること',
      rating: 5,
      genre: 'ラーメン',
      price_range: '〜¥1,000',
      location_name: 'ラーメン二郎 三田本店',
      location_lat: 35.6452,
      location_lng: 139.7463,
      prefecture: '東京都',
      area: '田町・三田',
      situations: ['一人ランチにおすすめ'],
      hashtags: ['ラーメン', '三田', '二郎', '本店'],
      images: ['https://images.unsplash.com/photo-1591814468924-caf88d1232e1?w=800&q=90'],
      daysAgo: 4,
    },
    {
      caption: '蛤の貝出汁で知られる一杯。ここも星が付いた店。貝の出汁は関西でもよく使うが、これは方向が違っていて、澄んでいるのに輪郭が太い。カウンターだけの小さな店',
      rating: 5,
      genre: 'ラーメン',
      price_range: '¥1,001〜¥3,000',
      location_name: '金色不如帰 新宿御苑本店',
      location_lat: 35.689,
      location_lng: 139.7085,
      prefecture: '東京都',
      area: '新宿',
      situations: ['一人ランチにおすすめ', '隠れ家'],
      hashtags: ['ラーメン', '新宿御苑', '貝出汁', 'トリュフ'],
      images: ['https://images.unsplash.com/photo-1557872943-16a5ac26437e?w=800&q=90'],
      daysAgo: 7,
    },
    {
      caption: '和食の出汁の考え方でラーメンを組み立てている店。日替わりの限定が有名で、それ目当ての人が開店前から並ぶ。関西の吸い地に近い感覚があって、東京で一番落ち着いて食べられる一杯かもしれない',
      rating: 5,
      genre: 'ラーメン',
      price_range: '¥1,001〜¥3,000',
      location_name: '饗 くろ喜',
      location_lat: 35.699,
      location_lng: 139.777,
      prefecture: '東京都',
      area: '秋葉原',
      situations: ['一人ランチにおすすめ'],
      hashtags: ['ラーメン', '秋葉原', '和出汁', '限定'],
      images: ['https://images.unsplash.com/photo-1591814468924-caf88d1232e1?w=800&q=90'],
      daysAgo: 10,
    },

    /* ── 東京 / ラーメン以外 ─────────────────── */
    {
      caption: '神田須田町の老舗蕎麦。建物が東京都の歴史的建造物に選ばれている、あの一角の店。汁は濃いめの江戸前で、関西の蕎麦とは完全に別物。どちらが上という話ではなく、こういう作法なのだと納得して食べる店',
      rating: 5,
      genre: '和食',
      price_range: '¥1,001〜¥3,000',
      location_name: 'まつや',
      location_lat: 35.6957,
      location_lng: 139.769,
      prefecture: '東京都',
      // 住所は神田須田町だが、内蔵エリアの中心点で測ると
      // 神田駅より秋葉原のほうが近い。座標を動かして辻褄を合わせると
      // 実在の店の位置を偽ることになるので、区分のほうを実際に合わせる。
      area: '秋葉原',
      situations: ['一人ランチにおすすめ', '仕事で'],
      hashtags: ['蕎麦', '神田', '老舗', '江戸前'],
      images: ['https://images.unsplash.com/photo-1618841557871-b4664fbf0cb3?w=800&q=90'],
      daysAgo: 3,
    },
    {
      caption: '清澄白河が「コーヒーの街」と呼ばれる前からある自家焙煎。大手が進出してくる以前からこの界隈で焼いていた店で、今の空気を作った側だと思っている。浅煎りが中心',
      rating: 5,
      genre: 'カフェ',
      price_range: '〜¥1,000',
      location_name: 'ARiSE COFFEE ROASTERS',
      location_lat: 35.6806,
      location_lng: 139.801,
      prefecture: '東京都',
      area: '清澄白河',
      situations: ['一人ランチにおすすめ', '隠れ家'],
      hashtags: ['コーヒー', '清澄白河', '自家焙煎'],
      images: ['https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800&q=90'],
      daysAgo: 5,
    },
    {
      caption: '予約が取れない鮨の代名詞として名前が挙がる店。三つ星を長く維持していて、いまは紹介がないと難しい。関西の鮨とは間の取り方がまるで違う。座れる機会があるなら迷わず',
      rating: 5,
      genre: '寿司',
      price_range: '¥10,001〜',
      location_name: '鮨 さいとう',
      location_lat: 35.6669,
      location_lng: 139.7399,
      prefecture: '東京都',
      area: '六本木',
      situations: ['記念日', 'デート', '隠れ家'],
      hashtags: ['寿司', '六本木', 'おまかせ', '予約困難'],
      images: ['https://images.unsplash.com/photo-1583623025817-d180a2221d0a?w=800&q=90'],
      daysAgo: 8,
    },
    {
      caption: '東京で讃岐うどんといえば、まずここの名前が出る。昼は必ず並ぶが回転は速い。関西のうどんとは出汁もコシも違う系統だが、これはこれで完成している。天ぷらは揚げ置きしない',
      rating: 5,
      genre: '和食',
      price_range: '〜¥1,000',
      location_name: '丸香',
      location_lat: 35.6968,
      location_lng: 139.759,
      prefecture: '東京都',
      area: '神保町',
      situations: ['一人ランチにおすすめ', 'ランチにおすすめ'],
      hashtags: ['うどん', '神保町', '讃岐', '行列'],
      images: ['https://images.unsplash.com/photo-1618841557871-b4664fbf0cb3?w=800&q=90'],
      daysAgo: 12,
    },
    {
      caption: '落合務さんの店。日本のイタリアンをここまで広めた人の一軒で、ウニのスパゲッティが看板。この内容でこの値段が成立しているのが不思議なくらい。予約は早めに取ること',
      rating: 5,
      genre: 'イタリアン',
      price_range: '¥5,001〜¥10,000',
      location_name: 'ラ・ベットラ・ダ・オチアイ',
      location_lat: 35.6745,
      location_lng: 139.767,
      prefecture: '東京都',
      area: '銀座',
      situations: ['デート', '記念日'],
      hashtags: ['イタリアン', '銀座', 'ウニのパスタ', '落合務'],
      images: ['https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=800&q=90'],
      daysAgo: 16,
    },

    /* ── 大阪 ─────────────────────────────────
     * 学生時代を関西で過ごした人物という設定なので、
     * このあたりは土地勘のある書き方になる。
     * 都道府県をまたぐ移動の演出も、ここが無いと確かめられない。
     */
    {
      caption: 'きつねうどん発祥の店として知られる一軒。名物のおじやうどんは、うどんの後に雑炊が来るような構成で、他所では見ない。関西の出汁が基準になっているのは、この系統の店で育ったからだと思う',
      rating: 5,
      genre: '和食',
      price_range: '〜¥1,000',
      location_name: 'うさみ亭マツバヤ',
      location_lat: 34.6755,
      location_lng: 135.502,
      prefecture: '大阪府',
      area: '難波・心斎橋',
      situations: ['一人ランチにおすすめ', 'ランチにおすすめ'],
      hashtags: ['うどん', '心斎橋', '大阪', 'きつねうどん'],
      images: ['https://images.unsplash.com/photo-1618841557871-b4664fbf0cb3?w=800&q=90'],
      daysAgo: 6,
    },
    {
      caption: '鶴橋の焼肉の老舗。駅を降りた時点で街全体が煙の匂いで、着く前から食べる気になっている。学生の頃から変わらない値段と量。東京の焼肉に慣れると、ここの安さが異常に思える',
      rating: 5,
      genre: '焼肉',
      price_range: '¥3,001〜¥5,000',
      location_name: '鶴一 本店',
      location_lat: 34.6655,
      location_lng: 135.5305,
      prefecture: '大阪府',
      area: '鶴橋',
      situations: ['飲み会', '家族で'],
      hashtags: ['焼肉', '鶴橋', '大阪', 'ホルモン'],
      images: ['https://images.unsplash.com/photo-1594041680534-e8c8cdebd659?w=800&q=90'],
      daysAgo: 9,
    },
    {
      caption: '北新地の日本料理。星付きの店として名前が通っている。関西の椀物はこれが基準だと言いたくなる一杯が出てくる。足すのではなく引く方向で、出汁の輪郭がはっきり残る',
      rating: 5,
      genre: '和食',
      price_range: '¥10,001〜',
      location_name: '北新地 弧柳',
      location_lat: 34.6955,
      location_lng: 135.4975,
      prefecture: '大阪府',
      area: '北新地',
      situations: ['仕事で', '記念日'],
      hashtags: ['日本料理', '北新地', '大阪', 'カウンター'],
      images: ['https://images.unsplash.com/photo-1534482421-64566f976cfa?w=800&q=90'],
      daysAgo: 14,
    },
    {
      caption: '大阪駅前ビルの地下にある、昭和のまま時間が止まった喫茶店。金色の壁と赤いソファ。学生の頃から新幹線の前に必ず寄っていて、いま東京から戻るたびに確認しに行っている',
      rating: 5,
      genre: 'カフェ',
      price_range: '〜¥1,000',
      location_name: 'マヅラ喫茶店',
      location_lat: 34.6997,
      location_lng: 135.497,
      prefecture: '大阪府',
      area: '梅田',
      situations: ['一人ランチにおすすめ'],
      hashtags: ['喫茶店', '梅田', '大阪', 'レトロ'],
      images: ['https://images.unsplash.com/photo-1521017432531-fbd92d768814?w=800&q=90'],
      daysAgo: 20,
    },
    {
      caption: '新世界の洋食。ヘレカツサンドで知られていて、手土産に買って帰る人が多い。串カツの街という印象の場所に、こういう一軒があるのが大阪の面白さだと思う',
      rating: 5,
      genre: '洋食',
      price_range: '¥3,001〜¥5,000',
      location_name: 'グリル梵',
      location_lat: 34.652,
      location_lng: 135.5048,
      prefecture: '大阪府',
      area: '新世界',
      situations: ['一人ランチにおすすめ', '飲み会'],
      hashtags: ['洋食', '新世界', '大阪', 'カツサンド'],
      images: ['https://images.unsplash.com/photo-1580442151529-343f2f6e0e27?w=800&q=90'],
      daysAgo: 25,
    },
  ],

  hanako: [
    {
      caption: '青山のフルーツサンド🍓 旬のいちごとクリームがたっぷりで幸せな気持ちになれる一品。毎日でも食べたいくらい好き！',
      rating: 5,
      genre: 'スイーツ',
      price_range: '〜¥1,000',
      location_name: 'ピエール・エルメ・パリ 青山',
      location_lat: 35.67,
      location_lng: 139.7155,
      prefecture: '東京都',
      area: '表参道・青山',
      situations: ['女子会'],
      hashtags: ['スイーツ', 'フルーツサンド', '青山', 'カフェ活', 'いちご'],
      images: ['https://images.unsplash.com/photo-1484723091739-30a097e8f929?w=800'],
      daysAgo: 0.2,
    },
    {
      caption: '代官山の新しいカフェ☕ パンケーキがふわっふわで感動😍 インテリアもおしゃれで写真撮りがいがある！週末は並ぶので平日がおすすめ',
      rating: 5,
      genre: 'カフェ',
      price_range: '¥1,001〜¥3,000',
      location_name: 'IVY PLACE 代官山',
      location_lat: 35.6481,
      location_lng: 139.7006,
      prefecture: '東京都',
      area: '代官山',
      situations: ['デート', '女子会'],
      hashtags: ['カフェ', 'パンケーキ', '代官山', 'おしゃれカフェ', '東京カフェ'],
      images: [
        'https://images.unsplash.com/photo-1551024601-bec78aea704b?w=800',
        'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800',
      ],
      daysAgo: 1,
    },
    {
      caption: '表参道のフルーツタルト🍓 イチゴとフランボワーズがたっぷりで見た目も最高✨ お土産にも使えそう！値段は少し高いけど納得のクオリティ',
      rating: 5,
      genre: 'スイーツ',
      price_range: '¥1,001〜¥3,000',
      location_name: 'キル フェ ボン 表参道ヒルズ',
      location_lat: 35.6653,
      location_lng: 139.712,
      prefecture: '東京都',
      area: '表参道・青山',
      situations: ['女子会'],
      hashtags: ['スイーツ', 'タルト', '表参道', 'パティスリー', '東京スイーツ'],
      images: ['https://images.unsplash.com/photo-1488477181946-6428a0291777?w=800'],
      daysAgo: 3,
    },
    {
      caption: '吉祥寺のアンティークカフェ☕ レトロな雰囲気でコーヒーがすごく美味しい。読書しながら過ごす休日が最高すぎた☺️',
      rating: 4,
      genre: 'カフェ',
      price_range: '〜¥1,000',
      location_name: 'HATTIFNATT 吉祥寺',
      location_lat: 35.703,
      location_lng: 139.5785,
      prefecture: '東京都',
      area: '吉祥寺',
      situations: ['隠れ家', '一人ランチにおすすめ'],
      hashtags: ['カフェ', '吉祥寺', 'レトロカフェ', 'コーヒー', '休日カフェ'],
      images: [
        'https://images.unsplash.com/photo-1442512595331-e89e73853f31?w=800',
        'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=800',
      ],
      daysAgo: 6,
    },
    {
      caption: '渋谷のアフタヌーンティー🫖 3段のケーキスタンドにサンドイッチとスコーン、スイーツが並んで夢みたいな時間でした✨ 女子会にぴったり！',
      rating: 5,
      genre: 'カフェ',
      price_range: '¥3,001〜¥5,000',
      location_name: 'セルリアンタワー東急ホテル 渋谷',
      location_lat: 35.6549,
      location_lng: 139.6977,
      prefecture: '東京都',
      area: '渋谷',
      situations: ['女子会', '記念日'],
      hashtags: ['アフタヌーンティー', '渋谷', 'カフェ', '女子会', 'スコーン'],
      images: ['https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800'],
      daysAgo: 10,
    },
  ],

  kenji: [
    {
      caption: '神田の老舗洋食ランチ🍖 毎日変わる日替わりが最高にコスパ良い。ポークソテーに山盛りキャベツ、スープ付きで850円！通い続けたい',
      rating: 4,
      genre: '洋食',
      price_range: '〜¥1,000',
      location_name: 'キッチン南海 神保町',
      location_lat: 35.6966,
      location_lng: 139.7576,
      prefecture: '東京都',
      area: '神保町',
      situations: ['ランチにおすすめ', '一人ランチにおすすめ'],
      hashtags: ['洋食', 'ランチ', '神田', 'コスパ', '日替わり'],
      images: ['https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=800'],
      daysAgo: 0.4,
    },
    {
      caption: '恵比寿の和牛焼肉🥩 A5ランクの黒毛和牛をたっぷり堪能！口の中でとろけるような脂がたまらない。特上カルビと特上ロースは必食',
      rating: 5,
      genre: '焼肉',
      price_range: '¥5,001〜¥10,000',
      location_name: '叙々苑 恵比寿ガーデンプレイス店',
      location_lat: 35.6471,
      location_lng: 139.7156,
      prefecture: '東京都',
      area: '恵比寿',
      situations: ['記念日', '飲み会'],
      hashtags: ['焼肉', '和牛', '恵比寿', 'A5', 'ご褒美飯'],
      images: ['https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800'],
      daysAgo: 1,
    },
    {
      caption: '銀座のビストロでランチ🍽️ 前菜のテリーヌからデザートまで全て完璧。ワインとのペアリングが素晴らしく、2時間があっという間でした',
      rating: 5,
      genre: 'フレンチ',
      price_range: '¥5,001〜¥10,000',
      location_name: 'Chez Inno 銀座',
      location_lat: 35.6714,
      location_lng: 139.7653,
      prefecture: '東京都',
      area: '銀座',
      situations: ['デート', '記念日'],
      hashtags: ['フレンチ', '銀座', 'ビストロ', 'ランチ', 'ワイン'],
      images: [
        'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800',
        'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800',
      ],
      daysAgo: 4,
    },
    {
      caption: '六本木の鉄板焼きステーキ🥩 目の前で焼いてもらうパフォーマンスも込みで最高の体験。記念日ディナーに使えるお店です',
      rating: 5,
      genre: '洋食',
      price_range: '¥10,001〜',
      location_name: 'レストラン瀬里奈 六本木',
      location_lat: 35.6628,
      location_lng: 139.731,
      prefecture: '東京都',
      area: '六本木',
      situations: ['記念日', 'デート', '夜景が見える'],
      hashtags: ['鉄板焼き', 'ステーキ', '六本木', '記念日', 'ディナー'],
      images: ['https://images.unsplash.com/photo-1558030006-450675393462?w=800'],
      daysAgo: 7,
    },
    {
      caption: '麻布十番の老舗洋食屋さん🍖 ハンバーグのデミグラスソースが絶品！昭和の雰囲気漂う内装も好き。週替わりランチが900円でコスパ最高',
      rating: 4,
      genre: '洋食',
      price_range: '¥1,001〜¥3,000',
      location_name: 'グリル満天星 麻布十番',
      location_lat: 35.6558,
      location_lng: 139.7368,
      prefecture: '東京都',
      area: '麻布十番',
      situations: ['ランチにおすすめ', '家族で'],
      hashtags: ['洋食', 'ハンバーグ', '麻布十番', '老舗', 'デミグラス'],
      images: ['https://images.unsplash.com/photo-1571091718767-18b5b1457add?w=800'],
      daysAgo: 14,
    },
  ],

  yuki: [
    {
      caption: '鎌倉の江ノ島でしらす丼🐟 生しらすと釜揚げしらすのハーフ&ハーフ！鮮度が全然違う。海を見ながら食べる最高のランチでした',
      rating: 5,
      genre: '和食',
      price_range: '¥1,001〜¥3,000',
      location_name: 'しらす問屋 とびっちょ 江ノ島',
      location_lat: 35.2998,
      location_lng: 139.4796,
      prefecture: '神奈川県',
      area: '江の島',
      situations: ['家族で', 'ランチにおすすめ'],
      hashtags: ['しらす丼', '江ノ島', '和食', '鎌倉', '海鮮'],
      images: ['https://images.unsplash.com/photo-1534482421-64566f976cfa?w=800'],
      daysAgo: 0.6,
    },
    {
      caption: '新宿の老舗寿司屋さん🍣 おまかせコースで旬のネタを堪能。大将の話が楽しく、食べながら日本の食文化を学べる貴重な体験でした',
      rating: 5,
      genre: '寿司',
      price_range: '¥5,001〜¥10,000',
      location_name: '久兵衛 新宿高島屋店',
      location_lat: 35.6896,
      location_lng: 139.699,
      prefecture: '東京都',
      area: '新宿',
      situations: ['記念日', '仕事で'],
      hashtags: ['寿司', '新宿', 'おまかせ', '江戸前寿司', '和食'],
      images: [
        'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=800',
      ],
      daysAgo: 0.8,
    },
    {
      caption: '浅草の老舗天ぷら屋🍤 ごま油で揚げるサクサクの天ぷらが最高！海老と穴子は特に絶品。お昼の定食は行列必至だけど待つ価値あり',
      rating: 5,
      genre: '和食',
      price_range: '¥3,001〜¥5,000',
      location_name: '天ぷら 大黒屋 浅草',
      location_lat: 35.7148,
      location_lng: 139.7967,
      prefecture: '東京都',
      area: '浅草',
      situations: ['ランチにおすすめ', '家族で'],
      hashtags: ['天ぷら', '浅草', '和食', 'ごま油', '老舗'],
      images: ['https://images.unsplash.com/photo-1547592180-85f173990554?w=800'],
      daysAgo: 3,
    },
    {
      caption: '神楽坂の懐石料理🍱 四季折々の食材を使った一品一品に感動。器も美しく、日本の美意識を感じる素晴らしいひとときでした',
      rating: 5,
      genre: '和食',
      price_range: '¥10,001〜',
      location_name: '石かわ 神楽坂',
      location_lat: 35.7003,
      location_lng: 139.7429,
      prefecture: '東京都',
      area: '神楽坂',
      situations: ['記念日', 'デート', '隠れ家'],
      hashtags: ['懐石', '神楽坂', '和食', '日本料理', '特別な日'],
      images: ['https://images.unsplash.com/photo-1547592180-85f173990554?w=800'],
      daysAgo: 9,
    },
    {
      caption: '築地の場外市場でウニ丼🦔 朝獲れの新鮮なウニがたっぷり！甘みが全然違う。早起きして行く価値あり。朝7時からオープンしてます',
      rating: 5,
      genre: '寿司',
      price_range: '¥3,001〜¥5,000',
      location_name: '寿司清 築地本店',
      location_lat: 35.6647,
      location_lng: 139.7698,
      prefecture: '東京都',
      // エリアを225→307件に増やしたとき「築地」が入り、
      // この座標の判定が銀座から築地に変わった。宣言も合わせる。
      area: '築地',
      situations: ['ランチにおすすめ'],
      hashtags: ['ウニ丼', '築地', '海鮮', '朝ごはん', '和食'],
      images: ['https://images.unsplash.com/photo-1562802378-063ec186a863?w=800'],
      daysAgo: 13,
    },
  ],

  yamada: [
    {
      caption: '新大久保のサムギョプサル🥓 厚切り豚バラを炭火で焼いてエゴマの葉で包んでパクッ！キムチとの相性が最高。お腹いっぱい食べて3500円はコスパよすぎ',
      rating: 5,
      genre: '韓国料理',
      price_range: '¥3,001〜¥5,000',
      location_name: 'ハヌリ 新宿店',
      location_lat: 35.7006,
      location_lng: 139.7008,
      prefecture: '東京都',
      area: '新宿',
      situations: ['飲み会', '女子会'],
      hashtags: ['韓国料理', 'サムギョプサル', '新大久保', 'コリアタウン', 'キムチ'],
      images: ['https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800'],
      daysAgo: 0.3,
    },
    {
      caption: '横浜中華街で食べた小籠包💕 皮が薄くてスープがじゅわっと溢れる本格派！上海蟹の季節に合わせて来たかいがあった。食べ歩きが楽しすぎる',
      rating: 5,
      genre: '中華',
      price_range: '¥1,001〜¥3,000',
      location_name: '聘珍楼 横浜中華街',
      location_lat: 35.443,
      location_lng: 139.6511,
      prefecture: '神奈川県',
      area: '関内・中華街',
      situations: ['家族で', 'デート'],
      hashtags: ['中華', '小籠包', '横浜中華街', '食べ歩き', '上海料理'],
      images: [
        'https://images.unsplash.com/photo-1563245372-f21724e3856d?w=800',
        'https://images.unsplash.com/photo-1585032226651-759b368d7246?w=800',
      ],
      daysAgo: 4,
    },
    {
      caption: '高田馬場のタイ料理屋🌿 本場のパッタイとグリーンカレーを堪能！スパイスが本格的でタイ人スタッフにも認められた味。ナンプラーの香りがたまらない',
      rating: 4,
      genre: 'アジア料理',
      price_range: '¥1,001〜¥3,000',
      location_name: 'ティーヌン 高田馬場',
      location_lat: 35.7124,
      location_lng: 139.7037,
      prefecture: '東京都',
      area: '高田馬場',
      situations: ['ランチにおすすめ', '一人ランチにおすすめ'],
      hashtags: ['タイ料理', 'パッタイ', 'グリーンカレー', '高田馬場', 'アジア料理'],
      images: ['https://images.unsplash.com/photo-1455619452474-d2be8b1e70cd?w=800'],
      daysAgo: 6,
    },
    {
      caption: '渋谷のベトナム料理🍜 フォーのスープが澄んでいて優しい味。パクチー増しにしてもらってハーブの香りが最高！ヘルシーで体に優しいランチでした',
      rating: 4,
      genre: 'アジア料理',
      price_range: '¥1,001〜¥3,000',
      location_name: 'フォーベトナム 渋谷',
      location_lat: 35.6591,
      location_lng: 139.6999,
      prefecture: '東京都',
      area: '渋谷',
      situations: ['ランチにおすすめ', '一人ランチにおすすめ'],
      hashtags: ['ベトナム料理', 'フォー', '渋谷', 'パクチー', 'ヘルシー'],
      images: ['https://images.unsplash.com/photo-1582878826629-29b7ad1cdc43?w=800'],
      daysAgo: 10,
    },
    {
      caption: '中野の台湾まぜそば🍜 肉味噌×卵黄×にら×魚粉の組み合わせが最高！最後に追い飯して二度美味しいやつ。週一で通いたい',
      rating: 5,
      genre: 'アジア料理',
      price_range: '〜¥1,000',
      location_name: '台湾まぜそば はなび 中野店',
      location_lat: 35.7073,
      location_lng: 139.6623,
      prefecture: '東京都',
      area: '中野',
      situations: ['一人ランチにおすすめ'],
      hashtags: ['台湾まぜそば', '中野', '追い飯', 'まぜそば', 'アジア料理'],
      images: ['https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=800&crop=top'],
      daysAgo: 15,
    },
  ],

  ebisu: [
    {
      caption: '恵比寿の絶品パスタ🍝 ランチのカルボナーラが本格的すぎてびっくり！生パスタのもちもち感がたまらない。ここは定期的に来たい',
      rating: 5,
      genre: 'イタリアン',
      price_range: '¥1,001〜¥3,000',
      location_name: 'ラ・ボエム 恵比寿',
      location_lat: 35.6467,
      location_lng: 139.7101,
      prefecture: '東京都',
      area: '恵比寿',
      situations: ['ランチにおすすめ', 'デート'],
      hashtags: ['イタリアン', '恵比寿', 'パスタ', 'カルボナーラ', 'ランチ'],
      images: [
        'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?w=800',
        'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800',
      ],
      daysAgo: 0.5,
    },
    {
      caption: '中目黒の川沿いカフェ☕ 桜の時期に来たかったけど、新緑もすごくきれい🌿 コーヒーとワッフルが最高のコンビでした',
      rating: 5,
      genre: 'カフェ',
      price_range: '¥1,001〜¥3,000',
      location_name: 'ONIBUS COFFEE 中目黒',
      location_lat: 35.644,
      location_lng: 139.6988,
      prefecture: '東京都',
      area: '中目黒',
      situations: ['デート', '一人ランチにおすすめ'],
      hashtags: ['カフェ', '中目黒', '川沿い', 'コーヒー', 'おしゃれカフェ'],
      images: [
        'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=800',
        'https://images.unsplash.com/photo-1442512595331-e89e73853f31?w=800',
      ],
      daysAgo: 2,
    },
    {
      caption: '恵比寿横丁で友達と飲み🍺 焼き鳥×日本酒のコンビは最強！雰囲気も良くてついつい長居してしまう。2軒目もここでいいじゃんってなった',
      rating: 5,
      genre: '和食',
      price_range: '¥1,001〜¥3,000',
      location_name: '恵比寿横丁',
      location_lat: 35.6474,
      location_lng: 139.7104,
      prefecture: '東京都',
      area: '恵比寿',
      situations: ['飲み会'],
      hashtags: ['焼き鳥', '恵比寿', '日本酒', '横丁', '夜ごはん'],
      images: ['https://images.unsplash.com/photo-1529042410759-befb1204b468?w=800'],
      daysAgo: 5,
    },
    {
      caption: '代官山のフレンチブランチ🥐 クロワッサンがバターたっぷりでサクサク！エッグベネディクトとのセットが最高でした。週末の定番にしたい',
      rating: 4,
      genre: 'フレンチ',
      price_range: '¥1,001〜¥3,000',
      location_name: 'ル・パン・コティディアン 代官山',
      location_lat: 35.649,
      location_lng: 139.7028,
      prefecture: '東京都',
      area: '代官山',
      situations: ['ランチにおすすめ', '家族で'],
      hashtags: ['フレンチ', '代官山', 'ブランチ', 'クロワッサン', 'パン'],
      images: ['https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=800'],
      daysAgo: 8,
    },
    {
      caption: '広尾の高級寿司でお祝い🍣🎉 握りたての江戸前寿司を目の前で。特にのどぐろと本マグロ大トロが最高すぎた。特別な日に絶対また来たい！',
      rating: 5,
      genre: '寿司',
      price_range: '¥10,001〜',
      location_name: '鮨 なかむら 広尾',
      location_lat: 35.6522,
      location_lng: 139.7198,
      prefecture: '東京都',
      area: '広尾',
      situations: ['記念日', 'デート'],
      hashtags: ['寿司', '広尾', 'おまかせ', '記念日', '大トロ'],
      images: [
        'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=800',
        'https://images.unsplash.com/photo-1569050467447-ce54b3bbc37d?w=800',
      ],
      daysAgo: 12,
    },
  ],
}

// コメント。from / to は username で指定する。
const COMMENTS = [
  { from: 'hanako', to: 'taro', postIdx: 0, text: 'ここ気になってました！煮干し系大好きなので今度行ってみます🍜' },
  { from: 'kenji', to: 'taro', postIdx: 0, text: '渋谷にこんなお店あったんですね。情報ありがとうございます！' },
  { from: 'taro', to: 'hanako', postIdx: 1, text: 'パンケーキふわっふわそう！今度行ってみます😍' },
  { from: 'yuki', to: 'hanako', postIdx: 1, text: '先日行ってきました！写真通りで大満足でしたよ✨' },
  { from: 'yamada', to: 'hanako', postIdx: 2, text: 'タルト美しい😭 これは食べたい' },
  { from: 'taro', to: 'kenji', postIdx: 1, text: 'A5和牛うらやましい！今月のご褒美にしようかな' },
  { from: 'yuki', to: 'kenji', postIdx: 2, text: 'ビストロのランチ良さそうですね。記念日に使おうかな' },
  { from: 'hanako', to: 'yuki', postIdx: 1, text: '江戸前寿司いいですね✨ おまかせって緊張するけど楽しそう' },
  { from: 'yamada', to: 'yuki', postIdx: 1, text: '私も寿司大好きです！今度一緒に行きましょう' },
  { from: 'kenji', to: 'yuki', postIdx: 2, text: '大黒屋さん有名ですよね！浅草観光ついでに行ってみます' },
  { from: 'taro', to: 'yamada', postIdx: 0, text: '新大久保のサムギョプサル！コスパ最高すぎますね🔥' },
  { from: 'hanako', to: 'yamada', postIdx: 1, text: '横浜中華街懐かしい😊 小籠包また食べたくなってきた' },
  { from: 'yuki', to: 'yamada', postIdx: 2, text: 'タイ料理好きなので絶対行きます！パッタイ美味しそう🌿' },
  { from: 'kenji', to: 'ebisu', postIdx: 2, text: '恵比寿横丁いいですね🍺 金曜に行ってみます' },
  { from: 'hanako', to: 'ebisu', postIdx: 1, text: 'ONIBUS 好きです☕ あの2階の窓際が最高ですよね' },
]

// ============================================================
// 実行
// ============================================================

console.log(`🚀 デモデータ投入開始  (${SUPABASE_URL})\n`)

/** username が空いているか。既存アカウントの取り違えを事前に検出するのに使う。 */
async function usernameIsFree(client, username) {
  const { data, error } = await client.rpc('is_username_available', { p_username: username })
  // RPC が無い環境（移行未適用など）では判定できない。判定不能は「不明」として扱い、
  // 誤った断定をするより、そのまま先へ進めて GoTrue の返事を見る。
  return error ? null : data === true
}

/**
 * アカウントを作る（既にあればサインインするだけ）。
 * プロフィールを揃えて、ログイン済みクライアントを返す。
 *
 * ★ サインアップより先にサインインを試す。
 *   逆にすると、既存アカウントに対して毎回サインアップを投げることになり、
 *   アドレスを1文字でも変えた瞬間に「新規登録」と解釈されて
 *   username が衝突し、GoTrue が理由を隠したまま
 *   'Database error saving new user' だけを返してくる。
 *   先にサインインしておけば、既存アカウントはその経路に入らない。
 */
async function ensureAccount(u, password, { optional = false } = {}) {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const signInAs = () => client.auth.signInWithPassword({ email: u.email, password })

  let { data: signIn, error: signInError } = await signInAs()

  if (signInError) {
    if (signInError.message?.includes('Email not confirmed')) {
      console.error(`❌ サインイン失敗 @${u.username}: ${signInError.message}`)
      console.error('   → Authentication > Sign In / Providers > Confirm email を OFF にしてください')
      process.exit(1)
    }

    // サインインできない = このアドレスのアカウントが無いか、パスワードが違う。
    // username が既に埋まっているなら、サインアップしても必ず衝突する。
    // 投げる前に止めて、何を直せばいいかを出す。
    const free = await usernameIsFree(client, u.username)
    if (free === false) {
      // 既にアカウントはあるが入れない。運営アカウントのように
      // 投稿を持たないものは、ここで全体を止める理由が無い。
      // デモデータの投入は続けられるので、警告だけ出して先へ進む。
      if (optional) {
        console.warn(`⚠️  @${u.username} にサインインできませんでした（${signInError.message}）`)
        console.warn(`   username '${u.username}' は既に存在します。このアカウントは飛ばして続行します。`)
        console.warn('   アドレスは SEED_ADMIN_EMAIL、パスワードは SEED_ADMIN_PASSWORD で指定できます。')
        console.warn('   登録済みのアドレスを調べる SQL:')
        console.warn('     SELECT p.username, u.email FROM profiles p')
        console.warn('     JOIN auth.users u ON u.id = p.id ORDER BY p.username;\n')
        return null
      }
      console.error(`❌ @${u.username} にサインインできませんでした: ${signInError.message}`)
      console.error('')
      console.error(`   username '${u.username}' は既に使われています。`)
      console.error('   つまりアカウント自体はあり、次のどちらかがずれています。')
      console.error('')
      console.error(`     ・メールアドレス … いま指定しているのは ${u.email}`)
      console.error('       （SEED_EMAIL_TEMPLATE を前回と違う値にすると別アカウント扱いになります）')
      console.error('     ・パスワード     … 前回 SEED_PASSWORD に指定した値と同じか')
      console.error('')
      console.error('   登録済みのアドレスを調べる SQL:')
      console.error('     SELECT p.username, u.email FROM profiles p')
      console.error('     JOIN auth.users u ON u.id = p.id ORDER BY p.username;')
      console.error('')
      console.error('   出てきたアドレスに合わせて SEED_EMAIL_TEMPLATE を指定してください。')
      process.exit(1)
    }

    // username は空いている。新規登録してよい。
    // username / display_name はここで渡す。DBトリガーがこれを見て profiles を作る。
    const { error: signUpError } = await client.auth.signUp({
      email: u.email,
      password,
      options: { data: { username: u.username, display_name: u.displayName } },
    })
    if (signUpError) {
      console.error(`❌ サインアップ失敗 @${u.username}: ${signUpError.message}`)

      // GoTrue は handle_new_user() が落ちた理由を返してくれず、
      // どんな原因でもこの一文になる。上で username は空いていると確認済みなので、
      // ここに来る場合はトリガー側の別の失敗を疑う。
      if (signUpError.message?.includes('Database error saving new user')) {
        console.error('')
        console.error('   登録時のDBトリガー handle_new_user() が失敗しています。')
        console.error(`   username '${u.username}' は空いていることを確認済みなので、`)
        console.error('   移行(0001〜)が全て適用されているかを確認してください。')
        console.error('   supabase/check_state.sql を SQL Editor で実行すると一覧できます。')
      }
      process.exit(1)
    }
    await sleep(600)

    ;({ data: signIn, error: signInError } = await signInAs())
    if (signInError) {
      console.error(`❌ サインイン失敗 @${u.username}: ${signInError.message}`)
      if (signInError.message?.includes('Email not confirmed')) {
        console.error('   → Authentication > Sign In / Providers > Confirm email を OFF にしてください')
      }
      process.exit(1)
    }
  }

  if (!signIn?.user) {
    console.error(`❌ サインイン失敗 @${u.username}: ユーザーが取得できませんでした`)
    process.exit(1)
  }

  const id = signIn.user.id

  // 既存アカウントだと username が自動採番のままなので、ここで確定させる。
  // is_public はフォローの status 判定に使われるので投稿より先に立てる。
  const { error: profileError } = await client
    .from('profiles')
    .update({
      username: u.username,
      display_name: u.displayName,
      bio: u.bio,
      photo_url: `https://i.pravatar.cc/150?img=${u.avatarImg}`,
      is_public: true,
    })
    .eq('id', id)
  if (profileError) {
    console.error(`❌ プロフィール更新失敗 @${u.username}: ${profileError.message}`)
    process.exit(1)
  }

  return { ...u, id, client }
}

/** username -> { client, id, ...user } */
const sessions = new Map()

// ---- Step 0: 運営アカウント --------------------------------
// 運営は投稿を持たない。既にあって入れないだけなら、デモデータの投入は
// 問題なく続けられるので optional にしてある（入れないと全部止まるのは割に合わない）。
const admin = await ensureAccount(ADMIN, ADMIN_PASSWORD, { optional: true })
if (admin) console.log(`🛡️  @${admin.username} (${admin.displayName}) 準備完了`)

// ---- Step 1: デモアカウント作成 & 公開設定 ------------------
for (const [i, u] of USERS.entries()) {
  sessions.set(u.username, await ensureAccount(u, PASSWORD))
  console.log(`✅ [${i + 1}/${USERS.length}] @${u.username} (${u.displayName}) 準備完了`)
  await sleep(200)
}

// ---- Step 2: 投稿 -------------------------------------------
console.log('\n📝 投稿を作成中...\n')

/** username -> postId[]（投稿順） */
const postIds = new Map()

for (const u of USERS) {
  const { client, id, username } = sessions.get(u.username)
  const posts = POSTS_BY_USER[username] ?? []
  const ids = []

  // 2回流しても増えないよう、既に入っている店名は飛ばす
  const { data: existing } = await client
    .from('posts')
    .select('id, location_name')
    .eq('user_id', id)
  const existingByName = new Map((existing ?? []).map((p) => [p.location_name, p.id]))

  for (const post of posts) {
    if (existingByName.has(post.location_name)) {
      ids.push(existingByName.get(post.location_name))
      console.log(`  ⏭️  @${username}: "${post.location_name}" は投稿済み`)
      continue
    }

    const createdAt = new Date(Date.now() - post.daysAgo * 86_400_000).toISOString()
    const { data: created, error } = await client
      .from('posts')
      .insert({
        user_id: id,
        caption: post.caption,
        rating: post.rating,
        genre: post.genre,
        price_range: post.price_range,
        location_name: post.location_name,
        location_lat: post.location_lat,
        location_lng: post.location_lng,
        prefecture: post.prefecture,
        area: post.area,
        situations: post.situations,
        hashtags: post.hashtags,
        is_public: true, // 既定は非公開。デモなので明示的に公開する
        created_at: createdAt,
      })
      .select('id')
      .single()

    if (error) {
      console.error(`  ❌ 投稿失敗 @${username} "${post.location_name}": ${error.message}`)
      continue
    }

    for (const [position, url] of post.images.entries()) {
      await client.from('post_images').insert({ post_id: created.id, url, position })
    }

    ids.push(created.id)
    console.log(`  📸 @${username}: ${post.location_name}（${post.prefecture} / ${post.area}）`)
    await sleep(150)
  }

  postIds.set(username, ids)
}

// ---- Step 3: 相互フォロー -----------------------------------
// status はトリガーが決める（全員 is_public=true なので accepted）。
console.log('\n👥 フォロー関係を作成中...\n')

for (const u of USERS) {
  const me = sessions.get(u.username)
  const targets = USERS.filter((o) => o.username !== u.username).map((o) => sessions.get(o.username).id)
  // SEED_USERS で1件だけ作った場合、相手がいないので空配列になる。
  // 空のまま upsert に渡さない。
  if (!targets.length) {
    console.log(`  ⏭️  @${u.username}: フォローする相手がいません`)
    continue
  }
  const { error } = await me.client
    .from('follows')
    .upsert(
      targets.map((following_id) => ({ follower_id: me.id, following_id })),
      { onConflict: 'follower_id,following_id', ignoreDuplicates: true }
    )
  if (error) console.error(`  ❌ @${u.username}: ${error.message}`)
  else console.log(`  ➡️  @${u.username} → ${targets.length}人`)
  await sleep(150)
}

// ---- Step 4: いいね -----------------------------------------
console.log('\n❤️  いいねを作成中...\n')

for (const u of USERS) {
  const me = sessions.get(u.username)
  const rows = []
  for (const other of USERS) {
    if (other.username === u.username) continue
    // 全部だと不自然なので1件おきに
    for (const [k, postId] of (postIds.get(other.username) ?? []).entries()) {
      if (k % 2 === 0) rows.push({ user_id: me.id, post_id: postId })
    }
  }
  if (!rows.length) continue
  const { error } = await me.client
    .from('likes')
    .upsert(rows, { onConflict: 'user_id,post_id', ignoreDuplicates: true })
  if (error) console.error(`  ❌ @${u.username}: ${error.message}`)
  else console.log(`  ❤️  @${u.username} が ${rows.length}件にいいね`)
  await sleep(150)
}

// ---- Step 5: コメント ---------------------------------------
console.log('\n💬 コメントを作成中...\n')

for (const c of COMMENTS) {
  const me = sessions.get(c.from)
  const targetPosts = postIds.get(c.to) ?? []
  const postId = targetPosts[c.postIdx]
  if (!me || !postId) continue

  // 同じ人が同じ投稿に二重コメントしないよう確認する
  const { count } = await me.client
    .from('comments')
    .select('id', { count: 'exact', head: true })
    .eq('post_id', postId)
    .eq('user_id', me.id)
  if (count) {
    console.log(`  ⏭️  @${c.from} → @${c.to} はコメント済み`)
    continue
  }

  const { error } = await me.client.from('comments').insert({
    post_id: postId,
    user_id: me.id,
    text: c.text,
  })
  if (error) console.error(`  ❌ @${c.from} → @${c.to}: ${error.message}`)
  else console.log(`  💬 @${c.from} → @${c.to}: ${c.text.slice(0, 22)}…`)
  await sleep(120)
}

// ---- 後始末 -------------------------------------------------
if (admin) await admin.client.auth.signOut()
for (const s of sessions.values()) await s.client.auth.signOut()

console.log('\n✅ 完了')
console.log('\n📋 ログイン情報（パスワードは環境変数で指定した値）:')
if (admin) console.log(`   @${ADMIN.username.padEnd(8)} ${ADMIN.displayName}  ${ADMIN.email}  ← 運営`)
for (const u of USERS) {
  console.log(`   @${u.username.padEnd(8)} ${u.displayName}  ${u.email}`)
}

console.log('\n👉 最後に SQL Editor で管理者権限を付与してください:')
console.log(`   UPDATE profiles SET is_admin = true WHERE username = '${ADMIN.username}';`)
