# 有料課金を動かすまでにやること

MeshiMap の課金は **画面と解放条件だけが先に出来ている**状態です。
決済そのものは繋がっていません（`mobile/src/lib/billing.ts` の `BILLING_READY = false`）。

このファイルは「どこまで出来ていて、あと何が要るか」の一覧です。
順番に依存があるので、**A の 1 番から着手**してください。

---

## いまの状態

| | 状態 |
|---|---|
| 解放の線引き（DB） | ✅ 済み（移行 `0009` / `0013`） |
| プラン画面・購入導線・復元ボタン・規約リンク | ✅ 済み（`app/settings/subscription.tsx`） |
| 上限に当たったときの案内 | ✅ 済み（`BILLING_READY` が false の間はプランに触れない文言に切り替わる） |
| **決済 SDK** | ❌ 未着手（アプリに入っていない） |
| **App Store Connect の商品** | ❌ 未登録 |
| **有料App契約（銀行・税務）** | ❌ 未締結 |
| **契約状態を書き込む Webhook** | ❌ 未着手 |

無料で使える範囲（DBが持っている値。端末側の定数と対）:

| 何 | 無料の上限 | DB側 | 端末側 |
|---|---|---|---|
| 地図に同時に出せる人数（運営・自分を除く） | 2人 | `free_map_users()`（0013） | `FREE_MAP_LIMIT` |
| 月間ランキングの表示 | 上位3人＋自分 | `free_ranking_rows()`（0009） | `FREE_RANKING_ROWS` |
| 注目の投稿一覧 | 2件 | `free_featured_rows()`（0009） | `FREE_FEATURED_ROWS` |

---

## A. Apple 側（**本人の手作業のみ**。API でも代行できない）

### A-1. 有料App契約 + 銀行口座 + 税務情報 ← ここが最初

App Store Connect > ビジネス（契約・税金・口座情報）で
**「有料App」契約**に同意し、銀行口座と税務フォームを登録します。

> ⚠ **これが終わるまで、商品を登録しても購入可能になりません。**
> アプリからも商品が取得できず、プラン画面は空のままになります。
> 個人（Individual）でも法人でも必要です。審査・承認に**数日かかることがある**ので、
> 実装より先に始めてください。

### A-2. サブスクリプション商品の登録

App Store Connect > App > 収益化 > サブスクリプション。

まずサブスクリプショングループを1つ作り（例: `MeshiMap Premium`）、
その中に以下の2つを作ります。**商品IDは `mobile/src/lib/billing.ts` の
`productId` と1文字も違えてはいけません**（後から変えると、既に買った人の
契約が別商品として扱われます）。

| 商品ID | 期間 | 価格 |
|---|---|---|
| `meshimap.premium.monthly` | 1か月 | ¥500 |
| `meshimap.premium.yearly` | 1年 | ¥4,800 |

各商品に要るもの:

- 表示名・説明（日本語）
- 価格（国ごとの価格はAppleの表から選ぶ）
- **審査用スクリーンショット**（プラン画面を撮ったもの。無いと審査に出せない）

> ASC API キー（issuer ID / key ID / `.p8`）を `mobile/` 配下に置けば、
> グループ・商品・価格・ローカライズの登録はスクリプトで流せます。
> ただし A-1 は API では出来ません。

### A-3. 商品はバイナリと一緒に審査に出る

サブスクは**アプリの審査と同時に**審査されます。
つまり課金を入れる＝もう1回、別の審査サイクルになります。
いまのビルド（プラン画面が「準備中」表示）はそのままで審査を通せます。

---

## B. アプリ側（実装。コードはこちらで書けます）

### B-1. SDK を入れる → **ネイティブの作り直しが要る**

推奨は **RevenueCat**（`react-native-purchases`）です。
レシート検証・契約状態の管理・Webhook を任せられ、
`subscriptions` 表（移行0005）が `provider = 'stripe' | 'apple'` の
二本立てになっているので、後から Web の Stripe を足しても
解放の判定（`is_subscribed()`）を変えずに済みます。

```bash
cd mobile
npx expo install react-native-purchases
# app.config.ts の plugins に追加 → 新しいネイティブビルドが必要
eas build --platform ios --profile production
```

> **Expo Go では動きません。** 確認には開発ビルドが要ります。

### B-2. `billing.ts` を差し替える

呼び出し側（プラン画面）は変えなくてよい形にしてあります。中身だけ:

- `purchase()` → `Purchases.purchasePackage(...)`
- `restore()` → `Purchases.restorePurchases()`（**Appleの必須要件**）
- `BILLING_READY = true` に変える
  → これだけで、各所の案内文が「入れ替えてください」から
    「プランを見る」導線に自動で切り替わります

### B-3. 価格はストアから取得した値で上書きする

`PLANS` の `priceLabel` は仮の表示です。
国や為替でストア側の実売価格は変わり、Appleは
**実際に請求される額を出すこと**を求めています。
`Purchases.getOfferings()` が返す表示価格を優先してください。

### B-4. 既に入っていて、消してはいけないもの

Appleの審査で必須。後から足そうとすると、だいたい落ちてから気づきます。

- 購入の復元ボタン
- 価格・期間・**自動更新の条件**を購入前に明示
- 利用規約・プライバシーポリシーへの導線
- 解約はOSの設定から行うという案内（`MANAGE_SUBSCRIPTION_URL`）

---

## C. サーバー側（契約状態の受け取り）

**端末側の状態で解放を判断してはいけません。** 書き換えられますし、
機内モードでも通ってしまいます。解放の可否は必ず DB の `is_subscribed()` を通します。

1. RevenueCat の Webhook 送信先を作る（Web側 = Next.js / Vercel に `/api/revenuecat-webhook`）
2. `Authorization` ヘッダで署名を検証する（RevenueCat の Webhook 設定で任意の値を入れられる）
3. `subscriptions` を service_role で upsert する

| 列 | 入れる値 |
|---|---|
| `user_id` | RevenueCat の app_user_id（= Supabase の auth uid にしておくこと） |
| `provider` | `'apple'` |
| `external_customer_id` / `external_subscription_id` | RevenueCat / Apple の originalTransactionId |
| `status` | `active` / `trialing` / `past_due` / `canceled` |
| `current_period_end` | 期限。`is_subscribed()` が過ぎた契約を落とすのに使う |

> `subscriptions` に **UPDATE ポリシーはありません**（RLSは既定で拒否）。
> 書けるのは service_role だけ、という状態を保ってください。
> カード番号などの決済情報は**ここにも他のどこにも保存しません**。

4. ログイン時に `Purchases.logIn(supabaseUserId)` を呼び、
   RevenueCat の利用者IDと Supabase のIDを一致させる
   （ここがズレると、買った人と解放される人が別人になります）

---

## D. 確認（Sandbox）

App Store Connect > ユーザーとアクセス > Sandbox でテスト用Apple IDを作り、
実機の「設定 > Developer > Sandbox Apple Account」に入れて試します。

1. 3人目を地図に出そうとする → プラン画面 → 購入
2. `subscriptions.status` が `active` になる
3. 3人目が地図に出る／ランキングが全順位見える／注目が全件出る
4. アプリを消して入れ直す → **購入を復元**で戻る
5. 解約 → 期限後に `is_subscribed()` が偽 → 地図が2人に戻る
   （**どの2人が残るかはフォローした順**。移行0013で固定してあります）

---

## E. 順番のまとめ

```
A-1 有料App契約（数日かかる。いちばん先に始める）
  ├─ 並行して B-1〜B-3（実装）と C（Webhook）を進められる
  ↓
A-2 商品登録（A-1 が終わっていないと購入可能にならない）
  ↓
D  Sandbox で通す
  ↓
A-3 商品 + 新しいバイナリを一緒に審査へ
```
