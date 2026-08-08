import { useColorScheme } from 'react-native'

/**
 * MeshiMap デザインシステム（0ベース刷新）
 *
 * 方針:
 *  - 旧デザインの「オレンジ→ローズのグラデーション」を全廃。
 *    グラデーションは安く見えやすく、地図の上に置くと情報を潰す。
 *  - 温かみのある紙色の地に、炭色の文字、差し色は「熾火(ember)」1色のみ。
 *    食べ物の写真が主役なので、UIの色数を絞って写真を邪魔しない。
 *  - 地図・位置系のアクセントだけ深い緑を当て、赤系(ember)と役割を分ける。
 *  - ライト/ダーク両対応（iOSの外観設定に追従）。
 */

const palette = {
  light: {
    bg: '#FBF8F4',          // 温かい紙色
    surface: '#FFFFFF',
    surfaceAlt: '#F3EDE5',  // 押下・非活性の面
    border: '#E7DFD4',
    borderStrong: '#D6CABA',

    text: '#1C1917',        // 炭
    textMuted: '#7A716A',
    textFaint: '#A9A099',

    accent: '#D14A26',      // 熾火
    accentText: '#FFFFFF',
    accentSoft: '#FBEBE4',  // 選択中チップの地

    geo: '#2E6B4F',         // 位置・現在地
    geoSoft: '#E4EFE8',

    star: '#D9932B',
    danger: '#B42318',
    dangerSoft: '#FDECEA',

    scrim: 'rgba(28,25,23,0.45)',
    // 地図ピンの縁取り（写真の上でも視認できるよう白固定）
    pinStroke: '#FFFFFF',
  },
  dark: {
    bg: '#141110',
    surface: '#1F1B19',
    surfaceAlt: '#2B2523',
    border: '#3A322D',
    borderStrong: '#4C423B',

    text: '#F6F1EB',
    textMuted: '#A79E97',
    textFaint: '#7C736D',

    accent: '#FF7A55',
    accentText: '#2A1109',
    accentSoft: '#3A1F16',

    geo: '#6FBF95',
    geoSoft: '#1E2E26',

    star: '#E8B45C',
    danger: '#F97066',
    dangerSoft: '#3A1B18',

    scrim: 'rgba(0,0,0,0.6)',
    pinStroke: '#FFFFFF',
  },
} as const

export type Colors = (typeof palette)['light']

/** 4px グリッド */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const

/**
 * タイポグラフィ。
 * 見出しは字間を詰めて締め、本文は行間を広めに取って読みやすくする。
 */
export const type = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: '700', letterSpacing: -0.6 },
  title:   { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.3 },
  heading: { fontSize: 17, lineHeight: 23, fontWeight: '600', letterSpacing: -0.2 },
  body:    { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  bodyMed: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  small:   { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  smallMed:{ fontSize: 13, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 11, lineHeight: 15, fontWeight: '600', letterSpacing: 0.2 },
} as const

/** 影は控えめに。iOSは shadow、Androidは elevation。 */
export const shadow = {
  card: {
    shadowColor: '#1C1917',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  float: {
    shadowColor: '#1C1917',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
} as const

export function useTheme() {
  const scheme = useColorScheme()
  const isDark = scheme === 'dark'
  return {
    colors: isDark ? palette.dark : palette.light,
    isDark,
    space,
    radius,
    type,
    shadow,
  }
}

/**
 * ジャンル定義。絵文字は残すが、旧デザインの
 * 「ジャンルごとにバラバラの縁色」はやめて彩度を揃えた。
 * 地図上でピンが虹色になるのを防ぐため。
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
