import { Platform } from 'react-native'
import { useResolvedScheme } from './hooks/useThemeSetting'

/**
 * MeshiMap デザインシステム —「白のギャラリー」
 *
 * 狙い:
 *   個人店だけを扱うアプリなので、画面自体が「わかっている人の持ち物」に
 *   見える必要がある。人に見せて恥ずかしくない画面。
 *
 * そのための方針:
 *   - 色でにぎやかにしない。地は骨色、文字は黒に近い墨、差し色は真鍮1色。
 *     食べ物の写真は元々色が強いので、UIが色を持つと途端に安っぽくなる。
 *   - 角丸をほぼ捨てる。角丸は「やさしい・カジュアル」の記号なので、
 *     写真は角丸なし、面は 2px まで。丸めるのは押せるものだけ。
 *   - 影を捨てて罫線で構造を作る。雑誌の紙面の作り方に寄せる。
 *   - 見出しは明朝。iOS には游明朝/ヒラギノ明朝が入っているので、
 *     フォントを同梱せずに使える（起動が遅くならない）。
 *   - 余白を大きく取る。詰めると情報量で勝負しているように見える。
 */

const palette = {
  light: {
    bg: '#FAF9F7',          // 骨色
    surface: '#FFFFFF',
    surfaceAlt: '#F2F0EC',
    border: '#E4E0D9',      // 罫線。これが構造を作る
    borderStrong: '#C9C2B7',

    text: '#14110F',        // 墨
    textMuted: '#6E6862',
    textFaint: '#9C958C',

    accent: '#8C6A3F',      // 真鍮
    accentText: '#FFFFFF',
    accentSoft: '#F0EAE0',

    geo: '#3F5D52',         // 位置・現在地
    geoSoft: '#E7EDE9',

    star: '#8C6A3F',        // 差し色と揃える。星だけ黄色いのは安く見える
    danger: '#9B2C2C',
    dangerSoft: '#F6EAEA',

    scrim: 'rgba(20,17,15,0.42)',
    pinStroke: '#FFFFFF',
  },
  dark: {
    bg: '#131211',
    surface: '#1B1917',
    surfaceAlt: '#252220',
    border: '#332F2B',
    borderStrong: '#4A443E',

    text: '#F2EDE6',
    textMuted: '#A19A91',
    textFaint: '#78716A',

    accent: '#C8A24A',
    accentText: '#1B1408',
    accentSoft: '#2A241A',

    geo: '#7FA894',
    geoSoft: '#1D2723',

    star: '#C8A24A',
    danger: '#E06C6C',
    dangerSoft: '#33201F',

    scrim: 'rgba(0,0,0,0.6)',
    pinStroke: '#FFFFFF',
  },
} as const

export type Colors = (typeof palette)['light']

/**
 * 余白。
 * 以前より一段広く取る。詰まった画面は「情報量で勝負している」印象になり、
 * 個人店を静かに見せたい今回の方向と合わない。
 */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 20,
  xl: 28,
  xxl: 40,
  xxxl: 64,
} as const

/**
 * 角丸。
 * 写真とカードは角丸なし（sq）。丸めるのは「押せるもの」だけに限る。
 * pill はチップやFABなど、丸いこと自体が機能の合図になるものに使う。
 */
export const radius = {
  sq: 0,
  sm: 2,
  md: 2,
  lg: 3,
  xl: 4,
  pill: 999,
} as const

/**
 * 書体。
 * 見出しは明朝。iOS 標準の「ヒラギノ明朝 ProN」を使うので同梱不要。
 * Android には無いので serif にフォールバックする。
 */
export const fonts = {
  serif: Platform.select({ ios: 'Hiragino Mincho ProN', android: 'serif', default: 'serif' }),
} as const

/**
 * タイポグラフィ。
 * 見出しは明朝で大きく、行間を広く。
 * ラベル(label)は字間を開けた小さな大文字風で、雑誌のキャプションの役。
 */
export const type = {
  display: {
    fontFamily: fonts.serif, fontSize: 32, lineHeight: 44,
    fontWeight: '400', letterSpacing: 0.5,
  },
  title: {
    fontFamily: fonts.serif, fontSize: 23, lineHeight: 34,
    fontWeight: '400', letterSpacing: 0.4,
  },
  heading: { fontSize: 16, lineHeight: 24, fontWeight: '600', letterSpacing: 0.2 },
  body:    { fontSize: 15, lineHeight: 25, fontWeight: '400' },
  bodyMed: { fontSize: 15, lineHeight: 25, fontWeight: '600' },
  small:   { fontSize: 13, lineHeight: 20, fontWeight: '400' },
  smallMed:{ fontSize: 13, lineHeight: 20, fontWeight: '600' },
  /** 「BISTRO · 西麻布」のような小見出し。字間を開けて使う */
  caption: { fontSize: 10, lineHeight: 15, fontWeight: '600', letterSpacing: 1.4 },
} as const

/**
 * 影はほぼ使わない。構造は罫線で作る。
 * 地図の上に浮かせる要素だけ、輪郭が消えない程度に薄く落とす。
 */
export const shadow = {
  card: {
    shadowColor: '#14110F',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  float: {
    shadowColor: '#14110F',
    shadowOpacity: 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
} as const

/**
 * 配色と寸法をまとめて返す。
 *
 * ★ 端末の設定を直接見ないこと。
 *   利用者がアプリ側で「ライト固定 / ダーク固定」を選べるので、
 *   その結果は useResolvedScheme が持っている
 *   （hooks/useThemeSetting.tsx）。ここで useColorScheme を
 *   呼び直すと、設定を無視する画面が1つできてしまう。
 */
export function useTheme() {
  const isDark = useResolvedScheme() === 'dark'
  return {
    colors: isDark ? palette.dark : palette.light,
    isDark,
    space,
    radius,
    type,
    shadow,
    fonts,
  }
}

/**
 * ジャンル。
 * 絵文字は地図のピンでだけ使う（小さくても判別できるため）。
 * チップや一覧では文字だけにする。絵文字が並ぶ画面は幼く見える。
 */
export const GENRES = [
  '和食', '洋食', 'イタリアン', 'フレンチ', '中華', '韓国料理',
  'アジア料理', 'カフェ', 'ラーメン', '寿司', '焼肉', 'スイーツ', 'その他',
] as const

export type Genre = (typeof GENRES)[number]

export const GENRE_EMOJI: Record<string, string> = {
  和食: '🍱', 洋食: '🍽️', イタリアン: '🍝', フレンチ: '🥐', 中華: '🥟',
  韓国料理: '🍖', アジア料理: '🍛', カフェ: '☕', ラーメン: '🍜',
  寿司: '🍣', 焼肉: '🥩', スイーツ: '🍰', その他: '🍴',
}

export const PRICE_RANGES = [
  '〜¥1,000', '¥1,001〜¥3,000', '¥3,001〜¥5,000', '¥5,001〜¥10,000', '¥10,001〜',
] as const

export type PriceRange = (typeof PRICE_RANGES)[number]

/**
 * シチュエーション。「何を食べたか」ではなく「どんな場面で使えるか」の軸。
 * ジャンルや価格帯では拾えない探し方（デートで使える店、一人で入れる店）を補う。
 */
export const SITUATIONS = [
  'デート',
  'ランチにおすすめ',
  '一人ランチにおすすめ',
  '女子会',
  '飲み会',
  '家族で',
  '仕事で',
  '記念日',
  '夜景が見える',
  '隠れ家',
] as const

export type Situation = (typeof SITUATIONS)[number]

export const SITUATION_EMOJI: Record<string, string> = {
  デート: '💕',
  ランチにおすすめ: '🍽️',
  一人ランチにおすすめ: '🧍',
  女子会: '🥂',
  飲み会: '🍻',
  家族で: '👨‍👩‍👧',
  仕事で: '💼',
  記念日: '🎉',
  夜景が見える: '🌃',
  隠れ家: '🚪',
}
