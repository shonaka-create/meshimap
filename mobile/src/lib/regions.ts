/**
 * 日本の都道府県と主要エリアの座標データ。
 *
 * 出典: 同じ作者の gourmet-atlas プロトタイプから移植（スクリプトで機械的に抽出）。
 * 都道府県名は Google Geocoding や一般表記に合わせて正式名称（〜県/〜都/〜府）に正規化した。
 *
 * これがあることで、緯度経度から都道府県・エリアを **API を一切使わずに** 判定できる。
 * 主要駅（札幌駅・梅田 など）を含むため、地図の最下層を「駅・繁華街」単位にできる。
 */

export interface Prefecture {
  id: string
  /** 正式名称。posts.prefecture に入る値 */
  name: string
  center: readonly [number, number]
  zoom: number
}

export interface Area {
  /** 「札幌駅」「すすきの」など。posts.area に入る値 */
  name: string
  prefId: string
  center: readonly [number, number]
  zoom: number
}

export const PREFECTURES: readonly Prefecture[] = [
  { id: 'hokkaido', name: '北海道', center: [43.0621, 141.3544], zoom: 10 },
  { id: 'aomori', name: '青森県', center: [40.8244, 140.7473], zoom: 11 },
  { id: 'iwate', name: '岩手県', center: [39.7036, 141.1527], zoom: 11 },
  { id: 'miyagi', name: '宮城県', center: [38.2682, 140.8694], zoom: 11 },
  { id: 'akita', name: '秋田県', center: [39.7186, 140.1024], zoom: 11 },
  { id: 'yamagata', name: '山形県', center: [38.2554, 140.3396], zoom: 11 },
  { id: 'fukushima', name: '福島県', center: [37.7608, 140.4747], zoom: 11 },
  { id: 'ibaraki', name: '茨城県', center: [36.3659, 140.4714], zoom: 11 },
  { id: 'tochigi', name: '栃木県', center: [36.5658, 139.8836], zoom: 11 },
  { id: 'gunma', name: '群馬県', center: [36.3895, 139.0634], zoom: 11 },
  { id: 'saitama', name: '埼玉県', center: [35.8617, 139.6453], zoom: 11 },
  { id: 'chiba', name: '千葉県', center: [35.6074, 140.103], zoom: 11 },
  { id: 'tokyo', name: '東京都', center: [35.6812, 139.7671], zoom: 11 },
  { id: 'kanagawa', name: '神奈川県', center: [35.4437, 139.638], zoom: 11 },
  { id: 'niigata', name: '新潟県', center: [37.9022, 139.0236], zoom: 11 },
  { id: 'toyama', name: '富山県', center: [36.6959, 137.2137], zoom: 11 },
  { id: 'ishikawa', name: '石川県', center: [36.5947, 136.6256], zoom: 11 },
  { id: 'fukui', name: '福井県', center: [36.0652, 136.2216], zoom: 11 },
  { id: 'yamanashi', name: '山梨県', center: [35.6639, 138.5683], zoom: 11 },
  { id: 'nagano', name: '長野県', center: [36.6513, 138.181], zoom: 11 },
  { id: 'gifu', name: '岐阜県', center: [35.4158, 136.7599], zoom: 11 },
  { id: 'shizuoka', name: '静岡県', center: [34.9756, 138.3828], zoom: 11 },
  { id: 'aichi', name: '愛知県', center: [35.1814, 136.9064], zoom: 11 },
  { id: 'mie', name: '三重県', center: [34.7303, 136.5086], zoom: 11 },
  { id: 'shiga', name: '滋賀県', center: [35.0045, 135.8686], zoom: 11 },
  { id: 'kyoto', name: '京都府', center: [35.0116, 135.7681], zoom: 11 },
  { id: 'osaka', name: '大阪府', center: [34.6937, 135.5023], zoom: 11 },
  { id: 'hyogo', name: '兵庫県', center: [34.6901, 135.1955], zoom: 11 },
  { id: 'nara', name: '奈良県', center: [34.6851, 135.8276], zoom: 11 },
  { id: 'wakayama', name: '和歌山県', center: [34.23, 135.1708], zoom: 11 },
  { id: 'tottori', name: '鳥取県', center: [35.5011, 134.2351], zoom: 11 },
  { id: 'shimane', name: '島根県', center: [35.4722, 133.0505], zoom: 11 },
  { id: 'okayama', name: '岡山県', center: [34.6618, 133.935], zoom: 11 },
  { id: 'hiroshima', name: '広島県', center: [34.3853, 132.4553], zoom: 11 },
  { id: 'yamaguchi', name: '山口県', center: [34.1785, 131.4737], zoom: 11 },
  { id: 'tokushima', name: '徳島県', center: [34.0711, 134.5516], zoom: 11 },
  { id: 'kagawa', name: '香川県', center: [34.3428, 134.0466], zoom: 11 },
  { id: 'ehime', name: '愛媛県', center: [33.8417, 132.7661], zoom: 11 },
  { id: 'kochi', name: '高知県', center: [33.5597, 133.5311], zoom: 11 },
  { id: 'fukuoka', name: '福岡県', center: [33.5902, 130.4017], zoom: 11 },
  { id: 'saga', name: '佐賀県', center: [33.2635, 130.3009], zoom: 11 },
  { id: 'nagasaki', name: '長崎県', center: [32.7501, 129.8773], zoom: 11 },
  { id: 'kumamoto', name: '熊本県', center: [32.7898, 130.7417], zoom: 11 },
  { id: 'oita', name: '大分県', center: [33.2382, 131.6126], zoom: 11 },
  { id: 'miyazaki', name: '宮崎県', center: [31.9077, 131.4202], zoom: 11 },
  { id: 'kagoshima', name: '鹿児島県', center: [31.5966, 130.5571], zoom: 11 },
  { id: 'okinawa', name: '沖縄県', center: [26.2124, 127.6809], zoom: 11 },
] as const

export const AREAS: readonly Area[] = [
  { name: '札幌駅', prefId: 'hokkaido', center: [43.0686, 141.3508], zoom: 14 },
  { name: 'すすきの', prefId: 'hokkaido', center: [43.0556, 141.3533], zoom: 14 },
  { name: '大通', prefId: 'hokkaido', center: [43.0598, 141.3523], zoom: 14 },
  { name: '小樽', prefId: 'hokkaido', center: [43.1907, 141.0037], zoom: 14 },
  { name: '函館', prefId: 'hokkaido', center: [41.7687, 140.7291], zoom: 14 },
  { name: '旭川', prefId: 'hokkaido', center: [43.7706, 142.365], zoom: 13 },
  { name: '帯広', prefId: 'hokkaido', center: [42.924, 143.196], zoom: 13 },
  { name: '青森駅周辺', prefId: 'aomori', center: [40.8282, 140.7342], zoom: 14 },
  { name: '弘前', prefId: 'aomori', center: [40.6031, 140.4633], zoom: 14 },
  { name: '八戸', prefId: 'aomori', center: [40.5123, 141.4883], zoom: 14 },
  { name: '盛岡', prefId: 'iwate', center: [39.702, 141.1356], zoom: 14 },
  { name: '一関', prefId: 'iwate', center: [38.9304, 141.1356], zoom: 14 },
  { name: '仙台駅周辺', prefId: 'miyagi', center: [38.2601, 140.8824], zoom: 14 },
  { name: '国分町', prefId: 'miyagi', center: [38.2638, 140.8705], zoom: 14 },
  { name: '秋田駅周辺', prefId: 'akita', center: [39.7169, 140.1292], zoom: 14 },
  { name: '横手', prefId: 'akita', center: [39.3142, 140.5615], zoom: 14 },
  { name: '山形駅周辺', prefId: 'yamagata', center: [38.2484, 140.3273], zoom: 14 },
  { name: '米沢', prefId: 'yamagata', center: [37.9113, 140.1166], zoom: 14 },
  { name: '酒田', prefId: 'yamagata', center: [38.9142, 139.8402], zoom: 14 },
  { name: '福島駅周辺', prefId: 'fukushima', center: [37.7547, 140.4578], zoom: 14 },
  { name: '郡山', prefId: 'fukushima', center: [37.3979, 140.3879], zoom: 14 },
  { name: '会津若松', prefId: 'fukushima', center: [37.4948, 139.9297], zoom: 14 },
  { name: 'いわき', prefId: 'fukushima', center: [37.0504, 140.8876], zoom: 14 },
  { name: '水戸', prefId: 'ibaraki', center: [36.3708, 140.4764], zoom: 14 },
  { name: 'つくば', prefId: 'ibaraki', center: [36.0835, 140.0764], zoom: 14 },
  { name: '日立', prefId: 'ibaraki', center: [36.5902, 140.6559], zoom: 14 },
  { name: '宇都宮', prefId: 'tochigi', center: [36.5591, 139.8983], zoom: 14 },
  { name: '日光', prefId: 'tochigi', center: [36.7554, 139.5986], zoom: 14 },
  { name: '小山', prefId: 'tochigi', center: [36.3145, 139.8092], zoom: 14 },
  { name: '前橋', prefId: 'gunma', center: [36.3895, 139.0634], zoom: 14 },
  { name: '高崎', prefId: 'gunma', center: [36.3219, 139.0125], zoom: 14 },
  { name: '伊勢崎', prefId: 'gunma', center: [36.3217, 139.1979], zoom: 14 },
  { name: '大宮', prefId: 'saitama', center: [35.9069, 139.6247], zoom: 14 },
  { name: '浦和', prefId: 'saitama', center: [35.8617, 139.6453], zoom: 14 },
  { name: '川越', prefId: 'saitama', center: [35.9251, 139.4858], zoom: 14 },
  { name: '所沢', prefId: 'saitama', center: [35.7871, 139.4731], zoom: 14 },
  { name: '越谷', prefId: 'saitama', center: [35.891, 139.791], zoom: 13 },
  { name: '春日部', prefId: 'saitama', center: [35.975, 139.752], zoom: 13 },
  { name: '熊谷', prefId: 'saitama', center: [36.147, 139.388], zoom: 13 },
  { name: '千葉駅周辺', prefId: 'chiba', center: [35.6133, 140.113], zoom: 14 },
  { name: '浦安', prefId: 'chiba', center: [35.6631, 139.8988], zoom: 14 },
  { name: '船橋', prefId: 'chiba', center: [35.6974, 139.9877], zoom: 14 },
  { name: '松戸', prefId: 'chiba', center: [35.7845, 139.9007], zoom: 14 },
  { name: '柏', prefId: 'chiba', center: [35.862, 139.971], zoom: 13 },
  { name: '幕張', prefId: 'chiba', center: [35.648, 140.04], zoom: 13 },
  { name: '成田', prefId: 'chiba', center: [35.776, 140.318], zoom: 13 },
  { name: '木更津', prefId: 'chiba', center: [35.381, 139.917], zoom: 13 },
  { name: '新宿', prefId: 'tokyo', center: [35.6909, 139.7003], zoom: 14 },
  { name: '渋谷', prefId: 'tokyo', center: [35.658, 139.7016], zoom: 14 },
  { name: '銀座', prefId: 'tokyo', center: [35.6718, 139.765], zoom: 14 },
  { name: '浅草', prefId: 'tokyo', center: [35.7148, 139.7967], zoom: 14 },
  { name: '六本木', prefId: 'tokyo', center: [35.6641, 139.7317], zoom: 14 },
  { name: '池袋', prefId: 'tokyo', center: [35.7295, 139.7109], zoom: 14 },
  { name: '吉祥寺', prefId: 'tokyo', center: [35.7031, 139.5798], zoom: 14 },
  { name: '秋葉原', prefId: 'tokyo', center: [35.6983, 139.7715], zoom: 14 },
  { name: '上野', prefId: 'tokyo', center: [35.714, 139.7773], zoom: 14 },
  { name: '中目黒', prefId: 'tokyo', center: [35.6443, 139.699], zoom: 14 },
  { name: '恵比寿', prefId: 'tokyo', center: [35.6467, 139.71], zoom: 14 },
  { name: '代官山', prefId: 'tokyo', center: [35.6485, 139.7031], zoom: 14 },
  { name: '表参道・青山', prefId: 'tokyo', center: [35.6654, 139.7127], zoom: 14 },
  { name: '原宿', prefId: 'tokyo', center: [35.6702, 139.7027], zoom: 14 },
  { name: '神楽坂', prefId: 'tokyo', center: [35.7018, 139.7405], zoom: 14 },
  { name: '神保町', prefId: 'tokyo', center: [35.6959, 139.7576], zoom: 14 },
  { name: '高田馬場', prefId: 'tokyo', center: [35.7127, 139.7038], zoom: 14 },
  { name: '中野', prefId: 'tokyo', center: [35.7056, 139.6659], zoom: 14 },
  { name: '下北沢', prefId: 'tokyo', center: [35.6613, 139.6681], zoom: 14 },
  { name: '三軒茶屋', prefId: 'tokyo', center: [35.6434, 139.6689], zoom: 14 },
  { name: '自由が丘', prefId: 'tokyo', center: [35.6076, 139.669], zoom: 14 },
  { name: '目黒', prefId: 'tokyo', center: [35.6339, 139.7158], zoom: 14 },
  { name: '五反田', prefId: 'tokyo', center: [35.6262, 139.7233], zoom: 14 },
  { name: '品川', prefId: 'tokyo', center: [35.6285, 139.7387], zoom: 14 },
  { name: '田町・三田', prefId: 'tokyo', center: [35.6457, 139.7476], zoom: 14 },
  { name: '新橋', prefId: 'tokyo', center: [35.6664, 139.7583], zoom: 14 },
  { name: '東京駅・丸の内', prefId: 'tokyo', center: [35.6812, 139.7671], zoom: 14 },
  { name: '日本橋', prefId: 'tokyo', center: [35.6839, 139.7745], zoom: 14 },
  { name: '神田', prefId: 'tokyo', center: [35.6918, 139.7708], zoom: 14 },
  { name: '御茶ノ水', prefId: 'tokyo', center: [35.6994, 139.7654], zoom: 14 },
  { name: '四谷', prefId: 'tokyo', center: [35.6862, 139.73], zoom: 14 },
  { name: '麻布十番', prefId: 'tokyo', center: [35.6553, 139.7364], zoom: 14 },
  { name: '広尾', prefId: 'tokyo', center: [35.6522, 139.7212], zoom: 14 },
  { name: '白金台', prefId: 'tokyo', center: [35.6379, 139.7275], zoom: 14 },
  { name: '錦糸町', prefId: 'tokyo', center: [35.697, 139.8144], zoom: 14 },
  { name: '押上・スカイツリー', prefId: 'tokyo', center: [35.7101, 139.8107], zoom: 14 },
  { name: '北千住', prefId: 'tokyo', center: [35.7497, 139.805], zoom: 14 },
  { name: '赤羽', prefId: 'tokyo', center: [35.7778, 139.7209], zoom: 14 },
  { name: '巣鴨', prefId: 'tokyo', center: [35.7335, 139.7391], zoom: 14 },
  { name: '日暮里', prefId: 'tokyo', center: [35.728, 139.771], zoom: 14 },
  { name: '両国', prefId: 'tokyo', center: [35.6959, 139.793], zoom: 14 },
  { name: '豊洲', prefId: 'tokyo', center: [35.6551, 139.7967], zoom: 14 },
  { name: '月島', prefId: 'tokyo', center: [35.6647, 139.7836], zoom: 14 },
  { name: 'お台場', prefId: 'tokyo', center: [35.6297, 139.7756], zoom: 14 },
  { name: '高円寺', prefId: 'tokyo', center: [35.7053, 139.6497], zoom: 14 },
  { name: '荻窪', prefId: 'tokyo', center: [35.7046, 139.6202], zoom: 14 },
  { name: '練馬', prefId: 'tokyo', center: [35.7358, 139.6538], zoom: 14 },
  { name: '蒲田', prefId: 'tokyo', center: [35.5626, 139.7161], zoom: 14 },
  { name: '大井町', prefId: 'tokyo', center: [35.6062, 139.7343], zoom: 14 },
  { name: '二子玉川', prefId: 'tokyo', center: [35.6116, 139.6266], zoom: 14 },
  { name: '調布', prefId: 'tokyo', center: [35.6519, 139.5442], zoom: 13 },
  { name: '立川', prefId: 'tokyo', center: [35.6979, 139.4139], zoom: 13 },
  { name: '町田', prefId: 'tokyo', center: [35.5427, 139.4467], zoom: 13 },
  { name: '国分寺', prefId: 'tokyo', center: [35.7002, 139.4805], zoom: 13 },
  { name: '八王子', prefId: 'tokyo', center: [35.6558, 139.3389], zoom: 13 },
  { name: '横浜みなとみらい', prefId: 'kanagawa', center: [35.4578, 139.6324], zoom: 14 },
  { name: '関内・中華街', prefId: 'kanagawa', center: [35.4442, 139.6457], zoom: 14 },
  { name: '鎌倉', prefId: 'kanagawa', center: [35.3191, 139.5467], zoom: 14 },
  { name: '箱根', prefId: 'kanagawa', center: [35.1953, 139.0253], zoom: 13 },
  { name: '川崎', prefId: 'kanagawa', center: [35.5312, 139.7016], zoom: 14 },
  { name: '横浜駅周辺', prefId: 'kanagawa', center: [35.4657, 139.6222], zoom: 14 },
  { name: '新横浜', prefId: 'kanagawa', center: [35.5079, 139.6172], zoom: 14 },
  { name: '武蔵小杉', prefId: 'kanagawa', center: [35.5766, 139.6598], zoom: 14 },
  { name: '溝の口', prefId: 'kanagawa', center: [35.5997, 139.6104], zoom: 14 },
  { name: '藤沢', prefId: 'kanagawa', center: [35.3387, 139.4869], zoom: 14 },
  { name: '江の島', prefId: 'kanagawa', center: [35.2999, 139.4805], zoom: 14 },
  { name: '横須賀', prefId: 'kanagawa', center: [35.2811, 139.6722], zoom: 13 },
  { name: '本厚木', prefId: 'kanagawa', center: [35.4425, 139.3644], zoom: 13 },
  { name: '小田原', prefId: 'kanagawa', center: [35.2561, 139.1553], zoom: 13 },
  { name: '平塚', prefId: 'kanagawa', center: [35.3272, 139.3494], zoom: 13 },
  { name: '新潟駅周辺', prefId: 'niigata', center: [37.9122, 139.0617], zoom: 14 },
  { name: '長岡', prefId: 'niigata', center: [37.4475, 138.8517], zoom: 14 },
  { name: '上越', prefId: 'niigata', center: [37.1492, 138.2517], zoom: 14 },
  { name: '富山駅周辺', prefId: 'toyama', center: [36.7022, 137.2137], zoom: 14 },
  { name: '高岡', prefId: 'toyama', center: [36.7456, 137.0137], zoom: 14 },
  { name: '金沢・片町', prefId: 'ishikawa', center: [36.5586, 136.6517], zoom: 14 },
  { name: '加賀', prefId: 'ishikawa', center: [36.3022, 136.3517], zoom: 14 },
  { name: '七尾', prefId: 'ishikawa', center: [37.0422, 136.9517], zoom: 14 },
  { name: '福井駅周辺', prefId: 'fukui', center: [36.0622, 136.2216], zoom: 14 },
  { name: '敦賀', prefId: 'fukui', center: [35.6522, 136.0717], zoom: 14 },
  { name: '甲府', prefId: 'yamanashi', center: [35.6622, 138.5683], zoom: 14 },
  { name: '富士吉田', prefId: 'yamanashi', center: [35.4856, 138.8022], zoom: 14 },
  { name: '長野駅周辺', prefId: 'nagano', center: [36.6431, 138.1883], zoom: 14 },
  { name: '松本', prefId: 'nagano', center: [36.2331, 137.9717], zoom: 14 },
  { name: '軽井沢', prefId: 'nagano', center: [36.3431, 138.6317], zoom: 14 },
  { name: '岐阜駅周辺', prefId: 'gifu', center: [35.4095, 136.7569], zoom: 14 },
  { name: '大垣', prefId: 'gifu', center: [35.3622, 136.6117], zoom: 14 },
  { name: '高山', prefId: 'gifu', center: [36.1422, 137.2517], zoom: 14 },
  { name: '静岡駅周辺', prefId: 'shizuoka', center: [34.9715, 138.3892], zoom: 14 },
  { name: '浜松', prefId: 'shizuoka', center: [34.7036, 137.7317], zoom: 14 },
  { name: '熱海', prefId: 'shizuoka', center: [35.1032, 139.0717], zoom: 14 },
  { name: '栄', prefId: 'aichi', center: [35.1685, 136.9079], zoom: 14 },
  { name: '名古屋駅', prefId: 'aichi', center: [35.1709, 136.8815], zoom: 14 },
  { name: '大須', prefId: 'aichi', center: [35.1594, 136.9029], zoom: 14 },
  { name: '豊橋', prefId: 'aichi', center: [34.7622, 137.3817], zoom: 14 },
  { name: '金山', prefId: 'aichi', center: [35.143, 136.901], zoom: 14 },
  { name: '一宮', prefId: 'aichi', center: [35.304, 136.803], zoom: 13 },
  { name: '岡崎', prefId: 'aichi', center: [34.954, 137.174], zoom: 13 },
  { name: '津', prefId: 'mie', center: [34.7303, 136.5086], zoom: 14 },
  { name: '四日市', prefId: 'mie', center: [34.9622, 136.6217], zoom: 14 },
  { name: '伊勢', prefId: 'mie', center: [34.4856, 136.7017], zoom: 14 },
  { name: '大津', prefId: 'shiga', center: [35.0045, 135.8686], zoom: 14 },
  { name: '彦根', prefId: 'shiga', center: [35.2717, 136.2517], zoom: 14 },
  { name: '草津', prefId: 'shiga', center: [35.0117, 135.9617], zoom: 14 },
  { name: '祇園', prefId: 'kyoto', center: [35.0037, 135.7782], zoom: 14 },
  { name: '京都駅', prefId: 'kyoto', center: [34.9858, 135.7588], zoom: 14 },
  { name: '嵐山', prefId: 'kyoto', center: [35.0156, 135.6715], zoom: 14 },
  { name: '河原町', prefId: 'kyoto', center: [35.0038, 135.7692], zoom: 14 },
  { name: '宇治', prefId: 'kyoto', center: [34.8917, 135.8017], zoom: 14 },
  { name: '伏見', prefId: 'kyoto', center: [34.932, 135.762], zoom: 13 },
  { name: '梅田', prefId: 'osaka', center: [34.7024, 135.4959], zoom: 14 },
  { name: '難波・心斎橋', prefId: 'osaka', center: [34.6687, 135.5013], zoom: 14 },
  { name: '天王寺', prefId: 'osaka', center: [34.6468, 135.5139], zoom: 14 },
  { name: '新世界', prefId: 'osaka', center: [34.6508, 135.5063], zoom: 14 },
  { name: '福島', prefId: 'osaka', center: [34.6963, 135.4851], zoom: 14 },
  { name: '京橋', prefId: 'osaka', center: [34.6971, 135.534], zoom: 14 },
  { name: '北新地', prefId: 'osaka', center: [34.6957, 135.497], zoom: 14 },
  { name: '十三', prefId: 'osaka', center: [34.7218, 135.4823], zoom: 14 },
  { name: '鶴橋', prefId: 'osaka', center: [34.6653, 135.5316], zoom: 14 },
  { name: '江坂', prefId: 'osaka', center: [34.7594, 135.4966], zoom: 14 },
  { name: '千里中央', prefId: 'osaka', center: [34.811, 135.4948], zoom: 13 },
  { name: '堺', prefId: 'osaka', center: [34.5733, 135.483], zoom: 13 },
  { name: '三宮', prefId: 'hyogo', center: [34.6942, 135.1954], zoom: 14 },
  { name: '姫路', prefId: 'hyogo', center: [34.8273, 134.6905], zoom: 14 },
  { name: '元町', prefId: 'hyogo', center: [34.6896, 135.1873], zoom: 14 },
  { name: '尼崎', prefId: 'hyogo', center: [34.7182, 135.4122], zoom: 14 },
  { name: '神戸ハーバーランド', prefId: 'hyogo', center: [34.679, 135.181], zoom: 14 },
  { name: '西宮', prefId: 'hyogo', center: [34.7376, 135.3416], zoom: 13 },
  { name: '明石', prefId: 'hyogo', center: [34.6493, 134.9927], zoom: 13 },
  { name: '奈良駅周辺', prefId: 'nara', center: [34.6812, 135.8276], zoom: 14 },
  { name: '橿原', prefId: 'nara', center: [34.5117, 135.7917], zoom: 14 },
  { name: '和歌山中心部', prefId: 'wakayama', center: [34.2317, 135.1708], zoom: 14 },
  { name: '白浜', prefId: 'wakayama', center: [33.6817, 135.3417], zoom: 14 },
  { name: '鳥取砂丘周辺', prefId: 'tottori', center: [35.5392, 134.2317], zoom: 14 },
  { name: '米子', prefId: 'tottori', center: [35.4317, 133.3317], zoom: 14 },
  { name: '松江', prefId: 'shimane', center: [35.4617, 133.0517], zoom: 14 },
  { name: '出雲', prefId: 'shimane', center: [35.3617, 132.7517], zoom: 14 },
  { name: '岡山駅周辺', prefId: 'okayama', center: [34.6656, 133.9183], zoom: 14 },
  { name: '倉敷', prefId: 'okayama', center: [34.5956, 133.7683], zoom: 14 },
  { name: '広島本通', prefId: 'hiroshima', center: [34.3926, 132.4593], zoom: 14 },
  { name: '八丁堀', prefId: 'hiroshima', center: [34.3944, 132.4633], zoom: 14 },
  { name: '宮島', prefId: 'hiroshima', center: [34.2982, 132.3217], zoom: 13 },
  { name: '福山', prefId: 'hiroshima', center: [34.4856, 133.3617], zoom: 14 },
  { name: '山口駅周辺', prefId: 'yamaguchi', center: [34.1785, 131.4737], zoom: 14 },
  { name: '下関', prefId: 'yamaguchi', center: [33.9575, 130.9317], zoom: 14 },
  { name: '徳島駅周辺', prefId: 'tokushima', center: [34.0756, 134.5516], zoom: 14 },
  { name: '鳴門', prefId: 'tokushima', center: [34.1717, 134.6017], zoom: 14 },
  { name: '高松', prefId: 'kagawa', center: [34.3456, 134.0417], zoom: 14 },
  { name: '丸亀', prefId: 'kagawa', center: [34.2917, 133.7917], zoom: 14 },
  { name: '松山', prefId: 'ehime', center: [33.8417, 132.7661], zoom: 14 },
  { name: '今治', prefId: 'ehime', center: [34.0617, 133.0017], zoom: 14 },
  { name: '高知駅周辺', prefId: 'kochi', center: [33.5656, 133.5417], zoom: 14 },
  { name: '四万十', prefId: 'kochi', center: [32.9917, 132.9317], zoom: 14 },
  { name: '天神', prefId: 'fukuoka', center: [33.5902, 130.3987], zoom: 14 },
  { name: '博多駅', prefId: 'fukuoka', center: [33.5897, 130.4208], zoom: 14 },
  { name: '中洲', prefId: 'fukuoka', center: [33.5925, 130.4079], zoom: 14 },
  { name: '大名', prefId: 'fukuoka', center: [33.5882, 130.3934], zoom: 14 },
  { name: '小倉', prefId: 'fukuoka', center: [33.8817, 130.8817], zoom: 14 },
  { name: '薬院', prefId: 'fukuoka', center: [33.5828, 130.399], zoom: 14 },
  { name: '西新', prefId: 'fukuoka', center: [33.582, 130.358], zoom: 14 },
  { name: '久留米', prefId: 'fukuoka', center: [33.319, 130.508], zoom: 13 },
  { name: '佐賀駅周辺', prefId: 'saga', center: [33.2635, 130.3009], zoom: 14 },
  { name: '唐津', prefId: 'saga', center: [33.4417, 129.9617], zoom: 14 },
  { name: '長崎駅周辺', prefId: 'nagasaki', center: [32.7501, 129.8773], zoom: 14 },
  { name: '佐世保', prefId: 'nagasaki', center: [33.1717, 129.7177], zoom: 14 },
  { name: '熊本城周辺', prefId: 'kumamoto', center: [32.8056, 130.7017], zoom: 14 },
  { name: '阿蘇', prefId: 'kumamoto', center: [32.9317, 131.1171], zoom: 14 },
  { name: '大分駅周辺', prefId: 'oita', center: [33.2382, 131.6126], zoom: 14 },
  { name: '別府', prefId: 'oita', center: [33.2782, 131.5017], zoom: 14 },
  { name: '宮崎駅周辺', prefId: 'miyazaki', center: [31.9156, 131.4317], zoom: 14 },
  { name: '延岡', prefId: 'miyazaki', center: [32.5817, 131.6617], zoom: 14 },
  { name: '天文館', prefId: 'kagoshima', center: [31.5917, 130.5517], zoom: 14 },
  { name: '霧島', prefId: 'kagoshima', center: [31.8317, 130.7617], zoom: 14 },
  { name: '那覇・国際通り', prefId: 'okinawa', center: [26.2163, 127.6881], zoom: 14 },
  { name: '恩納村', prefId: 'okinawa', center: [26.4953, 127.854], zoom: 14 },
  { name: '石垣島', prefId: 'okinawa', center: [24.3414, 124.156], zoom: 13 },
  { name: '宮古島', prefId: 'okinawa', center: [24.7972, 125.2917], zoom: 13 },
  { name: '名護', prefId: 'okinawa', center: [26.5917, 127.9717], zoom: 14 },
] as const

export const PREFECTURE_BY_ID: Record<string, Prefecture> = Object.fromEntries(
  PREFECTURES.map((p) => [p.id, p])
)

export const PREFECTURE_BY_NAME: Record<string, Prefecture> = Object.fromEntries(
  PREFECTURES.map((p) => [p.name, p])
)

export function areasOf(prefId: string): Area[] {
  return AREAS.filter((a) => a.prefId === prefId)
}

/** 2点間の距離（メートル）。ハーバサイン。 */
export function distanceMeters(
  aLat: number, aLng: number, bLat: number, bLng: number
): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** 最も近いエリアを返す。maxMeters より遠ければ null。 */
export function nearestArea(
  lat: number, lng: number, maxMeters = 15000
): { area: Area; meters: number } | null {
  let best: { area: Area; meters: number } | null = null
  for (const a of AREAS) {
    const m = distanceMeters(lat, lng, a.center[0], a.center[1])
    if (!best || m < best.meters) best = { area: a, meters: m }
  }
  return best && best.meters <= maxMeters ? best : null
}

/** 最も近い都道府県の中心を返す（県境付近では外れることがある点に注意）。 */
export function nearestPrefecture(
  lat: number, lng: number
): { prefecture: Prefecture; meters: number } {
  let best: { prefecture: Prefecture; meters: number } | null = null
  for (const p of PREFECTURES) {
    const m = distanceMeters(lat, lng, p.center[0], p.center[1])
    if (!best || m < best.meters) best = { prefecture: p, meters: m }
  }
  return best!
}
