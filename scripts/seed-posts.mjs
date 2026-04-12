/**
 * シードデータ投入スクリプト
 * 5アカウント × 各4〜5投稿 + フォロー関係 + いいね + コメント
 *
 * 前提:
 *   - schema.sql を Supabase に適用済み
 *   - Supabase Dashboard > Authentication > Settings > 「Enable email confirmations」をOFF
 *
 * 実行:
 *   node scripts/seed-posts.mjs
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://eeyfbohwyvxwglzmpgov.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_Nc-UnYPPW2PMveOS_FaHhg_hGRlYooI'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ============================================================
// 5アカウント定義（コンセプト付き）
// ============================================================
const USERS = [
  {
    email: 'taro.meshimap@gmail.com',
    password: 'password123',
    displayName: '田中太郎',
    bio: '🍜 ラーメン命！東京のラーメン屋を食べ歩き中。週3回はラーメン食べてます',
    avatarImg: 11, // pravatar img番号
  },
  {
    email: 'hanako.meshimap@gmail.com',
    password: 'password123',
    displayName: '佐藤花子',
    bio: '☕ カフェ・スイーツ大好き女子。おしゃれで美味しいお店を発信中✨ フォロバします',
    avatarImg: 5,
  },
  {
    email: 'kenji.meshimap@gmail.com',
    password: 'password123',
    displayName: '鈴木健二',
    bio: '🥩 肉食系グルメリスト。焼肉・ステーキ・フレンチまで、ちょっといい食事が好き',
    avatarImg: 33,
  },
  {
    email: 'yuki.meshimap@gmail.com',
    password: 'password123',
    displayName: '伊藤由紀',
    bio: '🍣 和食愛好家。寿司・天ぷら・懐石を中心に、日本の食文化を伝えていきたい',
    avatarImg: 20,
  },
  {
    email: 'yamada.meshimap@gmail.com',
    password: 'password123',
    displayName: '山田翔太',
    bio: '🌏 アジアン料理探求家。韓国・中国・タイ・ベトナム料理を東京で食べ歩き！',
    avatarImg: 44,
  },
  {
    email: 'nakaebisu.shotaro1543@gmail.com',
    password: '1543baske',
    displayName: 'demo_ebi',
    bio: '🍽️ 恵比寿・中目黒エリアのグルメを中心に食べ歩き。美味しいお店を発信中！',
    avatarImg: 68,
  },
]

// ============================================================
// 各ユーザーの投稿データ
// ============================================================
const POSTS_BY_USER = {
  '田中太郎': [
    {
      caption: '渋谷の路地裏で見つけた煮干し系ラーメン🍜 スープが濃厚すぎてやばい。チャーシューも分厚くて大満足でした！また絶対来る',
      rating: 5,
      genre: 'ラーメン',
      price_range: '¥1,001〜¥3,000',
      location_name: '一蘭 渋谷店',
      location_lat: 35.6583,
      location_lng: 139.6980,
      hashtags: ['ラーメン', '渋谷グルメ', '煮干し', '東京ラーメン'],
      images: ['https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=800'],
      daysAgo: 0.5,
    },
    {
      caption: '池袋の二郎系ラーメン🍜 野菜マシマシにんにく増しで注文！ボリューム満点すぎて後悔したけど完食。二郎系はやっぱり最高',
      rating: 4,
      genre: 'ラーメン',
      price_range: '¥1,001〜¥3,000',
      location_name: '豚山 池袋東口店',
      location_lat: 35.7294,
      location_lng: 139.7110,
      hashtags: ['二郎系', '池袋グルメ', 'ラーメン', 'がっつり'],
      images: ['https://images.unsplash.com/photo-1557872943-16a5ac26437e?w=800'],
      daysAgo: 2,
    },
    {
      caption: '新宿で食べた鶏白湯ラーメン✨ クリーミーなスープに細麺がよく絡んで絶品。夜11時まで営業してるのも最高',
      rating: 5,
      genre: 'ラーメン',
      price_range: '¥1,001〜¥3,000',
      location_name: '麺屋武蔵 新宿本店',
      location_lat: 35.6912,
      location_lng: 139.6946,
      hashtags: ['鶏白湯', '新宿グルメ', 'ラーメン', '深夜グルメ'],
      images: ['https://images.unsplash.com/photo-1591814468924-caf88d1232e1?w=800'],
      daysAgo: 5,
    },
    {
      caption: '上野の老舗中華でチャーハン定食🍚 パラパラで香ばしくて、これぞ中華チャーハンって感じ。スープとのセットで800円はコスパ最高',
      rating: 4,
      genre: '中華',
      price_range: '〜¥1,000',
      location_name: '東天紅 上野本店',
      location_lat: 35.7141,
      location_lng: 139.7748,
      hashtags: ['中華', 'チャーハン', '上野グルメ', 'コスパ最高'],
      images: ['https://images.unsplash.com/photo-1512058564366-18510be2db19?w=800'],
      daysAgo: 8,
    },
    {
      caption: '六本木のつけ麺専門店🍜 濃厚魚介豚骨のつけ汁が最高すぎ。麺は太麺で食べごたえあり。スープ割りも絶品でした',
      rating: 5,
      genre: 'ラーメン',
      price_range: '¥1,001〜¥3,000',
      location_name: '一風堂 六本木店',
      location_lat: 35.6630,
      location_lng: 139.7315,
      hashtags: ['つけ麺', '六本木グルメ', '魚介豚骨', 'ラーメン'],
      images: ['https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=800&q=90'],
      daysAgo: 12,
    },
  ],

  '佐藤花子': [
    {
      caption: '青山のフルーツサンド🍓 旬のいちごとクリームがたっぷりで幸せな気持ちになれる一品。毎日でも食べたいくらい好き！',
      rating: 5,
      genre: 'スイーツ',
      price_range: '〜¥1,000',
      location_name: 'ピエール・エルメ・パリ 青山',
      location_lat: 35.6700,
      location_lng: 139.7155,
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
      location_lng: 139.7120,
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
      location_lat: 35.7030,
      location_lng: 139.5785,
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
      hashtags: ['アフタヌーンティー', '渋谷', 'カフェ', '女子会', 'スコーン'],
      images: ['https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800'],
      daysAgo: 10,
    },
  ],

  '鈴木健二': [
    {
      caption: '神田の老舗洋食ランチ🍖 毎日変わる日替わりが最高にコスパ良い。ポークソテーに山盛りキャベツ、スープ付きで850円！通い続けたい',
      rating: 4,
      genre: '洋食',
      price_range: '〜¥1,000',
      location_name: 'キッチン南海 神保町',
      location_lat: 35.6966,
      location_lng: 139.7576,
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
      location_lng: 139.7310,
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
      hashtags: ['洋食', 'ハンバーグ', '麻布十番', '老舗', 'デミグラス'],
      images: ['https://images.unsplash.com/photo-1571091718767-18b5b1457add?w=800'],
      daysAgo: 14,
    },
  ],

  '伊藤由紀': [
    {
      caption: '鎌倉の江ノ島でしらす丼🐟 生しらすと釜揚げしらすのハーフ&ハーフ！鮮度が全然違う。海を見ながら食べる最高のランチでした',
      rating: 5,
      genre: '和食',
      price_range: '¥1,001〜¥3,000',
      location_name: 'しらす問屋 とびっちょ 江ノ島',
      location_lat: 35.2998,
      location_lng: 139.4796,
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
      location_lng: 139.6990,
      hashtags: ['寿司', '新宿', 'おまかせ', '江戸前寿司', '和食'],
      images: [
        'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=800',
        'https://images.unsplash.com/photo-1617196034183-421b4040ed20?w=800',
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
      hashtags: ['天ぷら', '浅草', '和食', 'ごま油', '老舗'],
      images: ['https://images.unsplash.com/photo-1516901408873-81eed5ee17e5?w=800'],
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
      hashtags: ['ウニ丼', '築地', '海鮮', '朝ごはん', '和食'],
      images: ['https://images.unsplash.com/photo-1562802378-063ec186a863?w=800'],
      daysAgo: 13,
    },
  ],

  '山田翔太': [
    {
      caption: '新大久保のサムギョプサル🥓 厚切り豚バラを炭火で焼いてエゴマの葉で包んでパクッ！キムチとの相性が最高。お腹いっぱい食べて3500円はコスパよすぎ',
      rating: 5,
      genre: '韓国料理',
      price_range: '¥3,001〜¥5,000',
      location_name: 'ハヌリ 新宿店',
      location_lat: 35.7006,
      location_lng: 139.7008,
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
      location_lat: 35.4430,
      location_lng: 139.6511,
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
      hashtags: ['ベトナム料理', 'フォー', '渋谷', 'パクチー', 'ヘルシー'],
      images: ['https://images.unsplash.com/photo-1582878826629-29b7ad1cdc43?w=800'],
      daysAgo: 10,
    },
    {
      caption: '神田の台湾まぜそば🍜 肉味噌×卵黄×にら×魚粉の組み合わせが最高！最後に追い飯して二度美味しいやつ。週一で通いたい',
      rating: 5,
      genre: 'アジア料理',
      price_range: '〜¥1,000',
      location_name: '台湾まぜそば はなび 中野店',
      location_lat: 35.7073,
      location_lng: 139.6623,
      hashtags: ['台湾まぜそば', '神田', '追い飯', 'まぜそば', 'アジア料理'],
      images: ['https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=800&crop=top'],
      daysAgo: 15,
    },
  ],

  'demo_ebi': [
    {
      caption: '恵比寿の絶品パスタ🍝 ランチのカルボナーラが本格的すぎてびっくり！生パスタのもちもち感がたまらない。ここは定期的に来たい',
      rating: 5,
      genre: 'イタリアン',
      price_range: '¥1,001〜¥3,000',
      location_name: 'ラ・ボエム 恵比寿',
      location_lat: 35.6467,
      location_lng: 139.7101,
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
      location_lat: 35.6440,
      location_lng: 139.6988,
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
      location_lat: 35.6490,
      location_lng: 139.7028,
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
      hashtags: ['寿司', '広尾', 'おまかせ', '記念日', '大トロ'],
      images: [
        'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=800',
        'https://images.unsplash.com/photo-1569050467447-ce54b3bbc37d?w=800',
      ],
      daysAgo: 12,
    },
  ],
}

// フォロー関係（全員相互フォロー）
const FOLLOWS = []
for (let i = 0; i < 6; i++) {
  for (let j = 0; j < 6; j++) {
    if (i !== j) FOLLOWS.push([i, j])
  }
}

// ============================================================
// メイン処理
// ============================================================

const userClients = []
const userProfiles = []

console.log('🚀 シードデータ投入開始\n')

// Step 1: 全ユーザーのサインアップ & サインイン
for (const [i, u] of USERS.entries()) {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

  // サインアップ（既存の場合はエラーが返るがOK）
  const { error: signUpError } = await client.auth.signUp({
    email: u.email,
    password: u.password,
    options: { data: { full_name: u.displayName } },
  })
  if (signUpError && !signUpError.message.includes('already registered') && !signUpError.message.includes('User already registered')) {
    console.warn(`  ⚠️  サインアップ: ${u.displayName} - ${signUpError.message}`)
  }
  await sleep(800)

  // サインイン
  const { data: signInData, error: signInError } = await client.auth.signInWithPassword({
    email: u.email,
    password: u.password,
  })
  if (signInError) {
    console.error(`❌ サインイン失敗: ${u.displayName} - ${signInError.message}`)
    console.error('   → Supabase Dashboard > Authentication > Settings > Email confirmations をOFFにしてください')
    process.exit(1)
  }

  const userId = signInData.user.id
  userProfiles.push({ ...u, id: userId })
  userClients.push(client)

  // プロフィール更新（bio追加）
  await client.from('profiles').upsert(
    { id: userId, display_name: u.displayName, bio: u.bio, photo_url: `https://i.pravatar.cc/150?img=${u.avatarImg}` },
    { onConflict: 'id' }
  )

  console.log(`✅ [${i + 1}/${USERS.length}] ${u.displayName} ログイン完了 (${userId.slice(0, 8)}...)`)
  await sleep(300)
}

console.log('\n📝 投稿を作成中...\n')

// Step 2: 各ユーザーで投稿作成
const postIds = {}
for (const [i, profile] of userProfiles.entries()) {
  const client = userClients[i]
  const posts = POSTS_BY_USER[profile.displayName] ?? []
  postIds[profile.id] = []

  for (const post of posts) {
    const createdAt = new Date(Date.now() - post.daysAgo * 24 * 60 * 60 * 1000).toISOString()

    const { data: postData, error: postError } = await client.from('posts').insert({
      user_id: profile.id,
      caption: post.caption,
      rating: post.rating,
      genre: post.genre,
      price_range: post.price_range,
      location_name: post.location_name,
      location_lat: post.location_lat,
      location_lng: post.location_lng,
      hashtags: post.hashtags,
      created_at: createdAt,
    }).select('id').single()

    if (postError) {
      console.error(`  ❌ 投稿失敗 (${profile.displayName}): ${postError.message}`)
      continue
    }

    // 投稿画像
    for (const [pos, url] of post.images.entries()) {
      await client.from('post_images').insert({ post_id: postData.id, url, position: pos })
    }

    postIds[profile.id].push(postData.id)
    process.stdout.write(`  📸 ${profile.displayName}: "${post.location_name}"\n`)
    await sleep(200)
  }
}

console.log('\n👥 フォロー関係を作成中...\n')

// Step 3: フォロー関係
for (const [fromIdx, toIdx] of FOLLOWS) {
  const client = userClients[fromIdx]
  const follower = userProfiles[fromIdx]
  const following = userProfiles[toIdx]

  const { error } = await client.from('follows').upsert(
    { follower_id: follower.id, following_id: following.id },
    { onConflict: 'follower_id,following_id', ignoreDuplicates: true }
  )
  if (!error) {
    console.log(`  ➡️  ${follower.displayName} → ${following.displayName}`)
  }
  await sleep(100)
}

console.log('\n❤️  いいねを作成中...\n')

// Step 4: いいね（各ユーザーが他ユーザーの投稿にいいね）
for (const [i, profile] of userProfiles.entries()) {
  const client = userClients[i]
  // 他のユーザーの投稿にランダムにいいね
  for (const [j, otherProfile] of userProfiles.entries()) {
    if (i === j) continue
    const theirPosts = postIds[otherProfile.id] ?? []
    // 半分の投稿にいいね
    for (const [k, pid] of theirPosts.entries()) {
      if (k % 2 === 0) {
        await client.from('likes').upsert(
          { user_id: profile.id, post_id: pid },
          { onConflict: 'user_id,post_id', ignoreDuplicates: true }
        )
        await sleep(50)
      }
    }
  }
  console.log(`  ❤️  ${profile.displayName} がいいね完了`)
}

console.log('\n💬 コメントを作成中...\n')

// Step 5: コメント
const COMMENTS = [
  { fromIdx: 1, targetUser: '田中太郎', postIdx: 0, text: 'ここ気になってました！煮干し系大好きなので今度行ってみます🍜' },
  { fromIdx: 2, targetUser: '田中太郎', postIdx: 0, text: '渋谷にこんなお店あったんですね。情報ありがとうございます！' },
  { fromIdx: 0, targetUser: '佐藤花子', postIdx: 0, text: 'パンケーキふわっふわそう！彼女連れて行きたい😍' },
  { fromIdx: 3, targetUser: '佐藤花子', postIdx: 0, text: '先日行ってきました！写真通りで大満足でしたよ✨' },
  { fromIdx: 4, targetUser: '佐藤花子', postIdx: 1, text: 'タルト美しい😭 これは食べたい' },
  { fromIdx: 0, targetUser: '鈴木健二', postIdx: 0, text: 'A5和牛うらやましい！今月のご褒美にしようかな' },
  { fromIdx: 3, targetUser: '鈴木健二', postIdx: 1, text: 'ビストロのランチ良さそうですね。記念日に使おうかな' },
  { fromIdx: 1, targetUser: '伊藤由紀', postIdx: 0, text: '江戸前寿司いいですね✨ おまかせって緊張するけど楽しそう' },
  { fromIdx: 4, targetUser: '伊藤由紀', postIdx: 0, text: '私も寿司大好きです！今度一緒に行きましょう' },
  { fromIdx: 2, targetUser: '伊藤由紀', postIdx: 1, text: '大黒屋さん有名ですよね！浅草観光ついでに行ってみます' },
  { fromIdx: 0, targetUser: '山田翔太', postIdx: 0, text: '新大久保のサムギョプサル！コスパ最高すぎますね🔥' },
  { fromIdx: 1, targetUser: '山田翔太', postIdx: 1, text: '横浜中華街懐かしい😊 小籠包また食べたくなってきた' },
  { fromIdx: 3, targetUser: '山田翔太', postIdx: 2, text: 'タイ料理好きなので絶対行きます！パッタイ美味しそう🌿' },
]

for (const c of COMMENTS) {
  const fromProfile = userProfiles[c.fromIdx]
  const targetProfile = userProfiles.find(p => p.displayName === c.targetUser)
  if (!targetProfile) continue
  const targetPosts = postIds[targetProfile.id] ?? []
  const postId = targetPosts[c.postIdx]
  if (!postId) continue

  const client = userClients[c.fromIdx]
  const { error } = await client.from('comments').insert({
    post_id: postId,
    user_id: fromProfile.id,
    text: c.text,
  })
  if (!error) {
    console.log(`  💬 ${fromProfile.displayName} → ${c.targetUser}: "${c.text.slice(0, 20)}..."`)
  }
  await sleep(100)
}

console.log('\n✅ シードデータ投入完了！')
console.log('\n📋 ログイン情報:')
for (const u of USERS) {
  console.log(`   ${u.displayName}: ${u.email} / password123`)
}
