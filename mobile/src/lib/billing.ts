import { Platform } from 'react-native'

/**
 * 課金。
 *
 * ★ ここはまだ決済に繋がっていない。
 *   画面と解放条件を先に固め、決済処理だけ後から差し替える。
 *
 * 差し替えの前提:
 *   iOS でアプリの機能を解放する課金は Apple の App内課金が必須
 *   （App Store Review Guideline 3.1.1）。Expo Go では動かないので、
 *   開発ビルドが要る＝ Apple Developer Program の登録が先に要る。
 *
 *   実装は RevenueCat（react-native-purchases）を想定している。
 *   レシート検証と契約状態の管理を任せられ、Webhook から
 *   subscriptions テーブル（移行0005）を更新できる。
 *   同テーブルは provider = 'stripe' | 'apple' の二本立てなので、
 *   後から Web の Stripe を足しても判定関数 is_subscribed は変えずに済む。
 *
 * ★ 契約中かどうかを、この端末側の状態で判断してはいけない。
 *   解放の可否は必ず DB の is_subscribed() を通す。
 *   端末側の値は書き換えられるし、機内モードでも通ってしまう。
 *   ここが持つのは「買う導線」だけ。
 */

/** 決済が繋がっているか。false の間は購入ボタンを押しても買えない。 */
export const BILLING_READY = false

export interface Plan {
  id: 'monthly' | 'yearly'
  /** App Store Connect / Google Play に登録する商品ID */
  productId: string
  name: string
  /** 表示用の価格。実際の価格はストアから取得したものを優先する */
  priceLabel: string
  period: string
  /** 1か月あたりに直した額。年額の得を示すのに使う */
  perMonthLabel: string
  /** 月額と比べて何%安いか。null なら表示しない */
  savingPercent: number | null
  note: string
}

/**
 * 商品。
 *
 * ★ productId は App Store Connect に登録するものと同じにすること。
 *   ここを後から変えると、既に買った人の契約が別商品として扱われる。
 *
 * 価格は「ストアから取得した表示価格」で上書きするのが正しい。
 * 国や為替でストア側の実売価格は変わるし、Apple は
 * 実際に請求される額を出すことを求めている。
 * ここの値は決済を繋ぐまでの仮表示。
 */
export const PLANS: readonly Plan[] = [
  {
    id: 'monthly',
    productId: 'meshimap.premium.monthly',
    name: '月額プラン',
    priceLabel: '¥500',
    period: '毎月',
    perMonthLabel: '¥500 / 月',
    savingPercent: null,
    note: 'いつでも解約できます',
  },
  {
    id: 'yearly',
    productId: 'meshimap.premium.yearly',
    name: '年額プラン',
    priceLabel: '¥4,800',
    period: '毎年',
    perMonthLabel: '¥400 / 月',
    savingPercent: 20,
    note: '2か月ぶん無料と同じ',
  },
] as const

export const DEFAULT_PLAN_ID: Plan['id'] = 'yearly'

export function planOf(id: Plan['id']): Plan {
  return PLANS.find((p) => p.id === id) ?? PLANS[0]
}

/** プレミアムで解放されるもの。プラン画面と、各所の案内で共有する。 */
export interface Benefit {
  /** Ionicons の名前 */
  icon: string
  title: string
  body: string
}

export const BENEFITS: readonly Benefit[] = [
  {
    icon: 'infinite-outline',
    title: '地図に出せる人数が無制限',
    body: 'フォローは無料でも何人でもできます。'
      + 'そのうち同時に地図へ出せるのが、無料では運営を除いて2人まで。'
      + 'プレミアムなら全員ぶんの地図をそのまま重ねられます。',
  },
  {
    icon: 'trophy-outline',
    title: '月間ランキングを全部見る',
    body: '無料で見えるのは上位だけ。全順位と、過去の月の結果まで追えます。',
  },
  {
    icon: 'flame-outline',
    title: '注目のお店をまとめて見る',
    body: 'いま人が集まっている店を、地図を歩き回らずに一覧で。',
  },
  {
    icon: 'ban-outline',
    title: '広告なし',
    body: '一覧にも地図にも広告が入りません。',
  },
] as const

/**
 * 無料で見せる量。
 * ★ supabase/migrations/0009_premium_gates.sql の
 *   free_ranking_rows() / free_featured_rows() と対。
 *   実際に絞っているのはDB側で、ここは案内文のための値。
 */
export const FREE_RANKING_ROWS = 3
export const FREE_FEATURED_ROWS = 2

export class BillingNotReadyError extends Error {
  constructor() {
    super('billing_not_ready')
    this.name = 'BillingNotReadyError'
  }
}

/**
 * 購入する。
 *
 * 決済を繋ぐときは、ここの中身だけを
 * Purchases.purchasePackage(...) に差し替える。
 * 呼び出し側（プラン画面）は変えなくてよいようにしてある。
 *
 * 購入が通っても、この関数は契約状態を返さない。
 * 解放は Webhook が subscriptions を更新し、
 * DB の is_subscribed() が真になって初めて成立する。
 * 「買えた」と「解放された」を分けておかないと、
 * 決済が通ったのに反映されない場合に嘘の画面を出してしまう。
 */
export async function purchase(_planId: Plan['id']): Promise<void> {
  if (!BILLING_READY) throw new BillingNotReadyError()
  throw new BillingNotReadyError()
}

/**
 * 購入の復元。
 *
 * ★ Apple の審査で必須（Guideline 3.1.1）。
 *   機種変更や再インストールで買い直しを強いる作りは通らない。
 */
export async function restore(): Promise<void> {
  if (!BILLING_READY) throw new BillingNotReadyError()
  throw new BillingNotReadyError()
}

/**
 * 解約の導線。
 *
 * ★ 自動更新の解約は、こちらのアプリでは行えない。
 *   Apple の仕様で、ユーザーが OS の設定から操作する。
 *   その場所を案内するのがアプリ側の役目。
 */
export const MANAGE_SUBSCRIPTION_URL =
  Platform.OS === 'ios'
    ? 'https://apps.apple.com/account/subscriptions'
    : 'https://play.google.com/store/account/subscriptions'
