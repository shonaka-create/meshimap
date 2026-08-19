# iOS アプリとして公開する手順

MeshiMap を App Store に出すまでの全工程。**上から順に実行**してください。
現在のコードは `mobile/`（Expo / React Native）です。Web版（リポジトリ直下の Next.js）は
App Store には出せないため、iOS 版はこの `mobile/` を使います。

---

## 0. 事前に必要なもの

| 必要なもの | 内容 | 費用 |
|---|---|---|
| **Apple Developer Program** | App Store 配信に必須の年間契約 | **年 US$99** |
| **Mac** | 実機ビルド・アーカイブ・提出に必要 | — |
| **Xcode** | Mac App Store から無料 | 無料 |
| **iPhone 実機** | 審査前の動作確認用（シミュレータでは位置情報・カメラの確認が不十分） | — |
| **Google Maps Platform の課金設定** | Maps SDK for iOS / Geocoding / Places の有効化 | 従量課金（無料枠あり） |

> **Mac を持っていない場合**: EAS Build（Expo のクラウドビルド）を使えば Mac なしで
> iOS のビルドと提出まで可能です。手順は「付録A」を参照。無料枠あり、混雑時は
> 待ち時間が長いため有料プラン（月$19〜）を検討。

---

## 1. Apple Developer Program に登録

1. https://developer.apple.com/programs/ → 「Enroll」
2. Apple ID でログイン（**2ファクタ認証が必須**）
3. 個人（Individual）か組織（Organization）を選択
   - **個人**: App Store の販売者名が本名になる
   - **組織**: 法人名で出せるが **D-U-N-S番号** が必要（取得に数週間かかることがある）
   - → 屋号で出したいなら早めに D-U-N-S を申請する
4. 支払い（年 $99）を完了。承認まで **24〜48時間**（組織はもっとかかる）

---

## 2. Google Maps Platform の設定 — ✅ 設定済み

**プロジェクト: `freelancercopilot`（番号 155892868010）**

### 2-1. API の有効化 — ✅ 完了

`Maps SDK for iOS` と `Geocoding API` を使用します。動作確認済みです。

> **Places API は使いません。** 最寄り駅の判定にのみ必要でしたが、
> 単価が Geocoding の6倍以上（約 $32/1,000）で無料枠も半分しかないため、
> アプリ内蔵の主要エリアデータ（144件・うち25件が駅名）で代替しました。
> 地図の階層は **県 → エリア** の2段です。

### 2-2. 鍵 — ✅ MeshiMap 専用に2本作成済み

| 鍵の名前 | 置き場所 | 制限 | 変数 |
|---|---|---|---|
| `meshimap-ios` | **アプリの中**（これは正しい） | アプリ制限: **iOS バンドルID `jp.yournist.meshimap`**<br>API制限: `maps-ios-backend` のみ | `mobile/.env` の `GOOGLE_MAPS_IOS_KEY` |
| `meshimap-geocoding` | **サーバーだけ**（アプリに入れない） | アプリ制限: **かけられない**<br>API制限: `geocoding-backend` のみ | Vercel の `GOOGLE_GEOCODING_KEY` |

**Geocoding の鍵をアプリに入れてはいけません。** 2本の扱いが違うのはこのためです。

Maps SDK の鍵はバンドルIDで縛れるので、配布物から抜かれても他所では使えません。
一方 Geocoding は「ウェブサービス API」で、**HTTP リファラ制限もバンドルID制限も効きません。**
抜かれたあとに請求を止める手段が無いということです。

当初は `EXPO_PUBLIC_GOOGLE_GEOCODING_KEY` としてアプリに入れていました。
書き出したバンドル（`entry-*.hbc`）に鍵がそのまま埋まっていることを確認しています。
いまは Web の `/api/geocode` 経由に変え、アプリはログイン済みトークンを添えて
問い合わせるだけにしてあります。`npm run check:ios` が、
`extra` に `AIza` で始まる鍵が戻っていないかを毎回見ます。

制限が実際に効いていることを検証済みです。

- Geocoding 鍵で Static Maps を叩く → **403 で拒否**
- Geocoding 鍵で Places を叩く → **REQUEST_DENIED**
- iOS 鍵を HTTP から叩く → **REQUEST_DENIED**

> 以前このプロジェクトにあった共用キー `newmapkey` は、
> **アプリケーション制限が無く** 22種類の Maps API を叩ける状態だったため、
> 上記2本に置き換えたうえで**削除済み**です（失効を確認済み）。
>
> 鍵は必ず「用途ごとに1本・最小の権限」で作ってください。
> 1本を使い回すと、どこか一箇所の漏洩で全機能が悪用されます。

### 2-3. 課金の上限

**予算アラート — ✅ 設定済み**
`MeshiMap Maps 費用アラート` / 月 3,000円 / 50%・90%・100% で通知。

> ⚠️ **予算アラートは通知するだけで、課金は止まりません。**
> 実際に止めるには下の「日次上限」が必要です。

**日次上限 — ⬜ 未設定（Console からの手動設定が必要）**

Maps 系の割り当ては API 経由で変更できない仕様のため、ブラウザから設定します。

1. https://console.cloud.google.com/google/maps-apis/quotas?project=freelancercopilot
2. 上部の「API」で対象を選択 → 「割り当て」タブ
3. **「Requests per day」** の鉛筆アイコン → 下表の値を入力して保存

| API | 推奨 日次上限 | 月換算 | 根拠 |
|---|---|---|---|
| Geocoding API | **300** | 9,000 | 無料枠 10,000/月 に収まる。実際の消費はこれよりずっと少ない |
| Maps SDK for iOS | **設定しない** | — | 上限に達すると地図が出なくなり、通常利用者の体験を壊すため |

Maps SDK は鍵にバンドルID制限がかかっているため、
漏洩しても他所から使われることはありません。予算アラートでの監視で足ります。

> Geocoding の日次上限は、鍵をサーバーに移したいまも**必要です。**
> `/api/geocode` はログイン済みの利用者にしか答えませんが、
> 利用者が増えれば呼ばれる回数も増えます。上限は「悪用を止める柵」ではなく
> 「請求が青天井にならない柵」として要ります。

---

### 料金の全体像（2025年の改定後）

以前の「月 $200 クレジット」は廃止され、**API種別ごとの無料コール数**に変わりました。
無料枠はプールされず、APIごとに独立して計算されます。

| API | 区分 | 無料枠/月 | 超過後の単価 | 消費するタイミング |
|---|---|---|---|---|
| Maps SDK for iOS (Dynamic Maps) | Essentials | 10,000 | 約 $7 / 1,000 | **地図を読み込むたび**（パン・ズームは無料） |
| Geocoding | Essentials | 10,000 | 約 $5 / 1,000 | 内蔵データで判定できなかった投稿のみ |

---

### 消費を抑えるために実装していること

**1. 地域判定はアプリ内蔵データで行う（Geocoding をほぼ使わない）**

`mobile/src/lib/regions.ts` に47都道府県と主要144エリアの座標を持たせ、
投稿地点から最寄りエリアを端末上で計算しています。
主要都市18地点での実測で **15/18 (83%) が API 呼び出しゼロ**で解決しました。

**2. ジオコーディング結果を端末にキャッシュする**

座標を約110m単位に丸めてキーにし、`AsyncStorage` に保存します。
同じ店に何度投稿しても API は一度しか消費しません。

**3. 地図の読み込み回数を減らす**

Dynamic Maps は**地図を初期化した回数**で課金されます（操作は無料）。そのため:

- 投稿画面では地図を最初から出さず、**「地図で調整」を押したときだけ**描画する
  （現在地のままでよい人の分の読み込みが丸ごと不要になる）
- ホームの地図はタブを切り替えても破棄せず、**再マウントによる再課金を避ける**

**4. Places API を使わない**

最寄り駅の判定に Places Nearby Search（Pro / 無料枠5,000 / 約$32per1,000）が
必要でしたが、内蔵データの主要エリア（うち25件が駅名）で代替しました。
この API は鍵の権限からも外してあります。

---

## 3. Supabase 側の準備

```bash
# 1. 移行SQLを適用する
#   Supabase Dashboard > SQL Editor で以下のファイルの中身を貼り付けて実行
#   supabase/schema.sql                                （初回のみ）
#   supabase/migrations/0001_accounts_privacy_regions.sql
#   … 以降 0002 〜 0012 を番号順に。飛ばすと後の移行が落ちる
```

> **提出前に 0010 と 0012 が本番へ流れていることを必ず確認すること。**
> 0010 が無いとデモの印が付かず、実在の店に付いた架空のレビューが
> 本物として表示される。0012 が無いと不適切な表現のフィルタが
> 端末側だけになり、API を直接叩けば素通りする（Guideline 1.2）。
>
> `supabase/check_state.sql` を SQL Editor に貼れば、
> どこまで適用済みかと、デモの印が実際に付いているかを一度に確認できる。

- **Authentication > Providers**: 「Email」を有効化
- **Authentication > Email**: 「Confirm email」を有効にする場合、確認メールのリダイレクト先に
  `meshimap://` を追加（Redirect URLs）
- **Storage**: `post-images` と `avatars` バケットが `public` で存在することを確認
- **Project Settings > API**: `anon public` キーを `mobile/.env` の
  `EXPO_PUBLIC_SUPABASE_ANON_KEY` に設定

---

## 4. アプリのアイコンとスプラッシュ

`mobile/assets/` に以下を配置します（**未配置だとビルドが失敗します**）。

| ファイル | サイズ | 要件 |
|---|---|---|
| `icon.png` | **1024×1024** | 角丸なし・**透過なし**（透過があると審査で弾かれる） |
| `splash.png` | 1284×2778 推奨 | 起動画面 |
| `adaptive-icon.png` | 1024×1024 | Android 用（iOSのみなら不要） |

---

## 5. ローカルで動作確認

```bash
cd mobile
npm install

# ネイティブプロジェクトを生成（react-native-maps などが入るため Expo Go では動きません）
npx expo prebuild --clean

# 実機で確認（Mac + 接続した iPhone）
npx expo run:ios --device
```

**必ず実機で確認する項目**（シミュレータでは不十分）:
- [ ] 位置情報の許可ダイアログが出て、日本語の説明文が表示される
- [ ] 現在地の青い点が地図に出る
- [ ] 右下の「現在地に戻る」ボタンで現在地へ移動する
- [ ] 県 → エリア とタップで下れて、下ると上の階層のバブルが消える
- [ ] 投稿で写真が5枚まで選べ、**動画が選択肢に出ない**
- [ ] 投稿後、都道府県・エリアが自動で入っている（Supabase の posts を確認）
- [ ] 投稿が初期状態で非公開になっている
- [ ] 通報・ブロック・アカウント削除が動く
- [ ] 運営アカウントで通報一覧が読める（`admin_open_reports` / 移行0003）

---

## 6. App Store Connect にアプリを登録

1. https://appstoreconnect.apple.com → 「マイApp」→ 「+」→ 「新規App」
2. 入力項目
   - **プラットフォーム**: iOS
   - **名前**: MeshiMap（App Store 上で一意。取られていたら変更が必要）
   - **プライマリ言語**: 日本語
   - **バンドルID**: `jp.yournist.meshimap`
     （事前に Certificates, Identifiers & Profiles → Identifiers で登録しておく）
   - **SKU**: 任意の管理用文字列（例 `meshimap-001`）

---

## 7. ビルドして提出

### EAS Build を使う場合（推奨・Mac不要）

`mobile/eas.json` は用意済みなので `eas build:configure` は不要です。

```bash
npm install -g eas-cli
eas login
cd mobile
eas init            # プロジェクトを Expo アカウントに紐づける（初回のみ）

# 鍵は EAS のシークレットに登録する（リポジトリに置かない）
eas secret:create --name GOOGLE_MAPS_IOS_KEY --value "＜iOS用の鍵＞"
eas secret:create --name EXPO_PUBLIC_SUPABASE_URL --value "https://ceohkxunpotitdbyyxyl.supabase.co"
eas secret:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "＜anonキー＞"
eas secret:create --name EXPO_PUBLIC_WEB_URL --value "https://meshimap.vercel.app"
```

> Geocoding の鍵は **EAS に登録しません。** アプリに入る値は取り出せるためです。
> 鍵は Vercel 側の `GOOGLE_GEOCODING_KEY` にだけ置きます。

**まず実機で確認する（開発ビルド）**

```bash
eas device:create   # iPhone を登録。表示されたQRをiPhoneで読み、構成プロファイルを入れる
eas build --platform ios --profile development
```

ビルドが終わると QR が出ます。iPhone で読み込むとアプリが入ります。
あとは PC 側で `npx expo start --dev-client` を動かせば、
コードを直すたびに iPhone 側へ反映されます。
**Google Maps が使われるのはここからです**（Expo Go では Apple 地図）。

**提出する（本番ビルド）**

```bash
eas build --platform ios --profile production
eas submit --platform ios
```

証明書・プロビジョニングプロファイルは EAS が自動で作るので、
Mac も Xcode も要りません。

### Xcode を使う場合

```bash
cd mobile
npx expo prebuild --clean --platform ios
open ios/MeshiMap.xcworkspace
```

Xcode で: Signing & Capabilities → Team を選択 → Product > Archive →
Distribute App → App Store Connect → Upload

---

## 8-0. コード側の監査結果

提出前にコードを一通り見た結果です。**直したもの**と、
**運用で決めないといけないもの**を分けてあります。

### 直したもの

**使っていない権限が4つ入っていた。**
`app.config.ts` で指定を省いていたため、プラグインの既定値として
英語の文言つきで以下が `Info.plist` に入っていました。

| キー | 実際の使用 |
|---|---|
| `NSMicrophoneUsageDescription` | 使っていない（動画を撮らない） |
| `NSLocationAlwaysUsageDescription` | 使っていない |
| `NSLocationAlwaysAndWhenInUseUsageDescription` | 使っていない |
| `NSFaceIDUsageDescription` | 使っていない（生体認証なし） |

常時位置情報は審査でとくに厳しく見られ、App Store の
プライバシー表示とも食い違います。各プラグインに `false` を渡して消しました。

プラグインを更新すると同じことが起きるので、**`npm run check:ios`** で
毎回検査します（CI にも入れてあります）。使っていない権限が復活したとき、
必要な権限が消えたとき、文言が英語の既定値に戻ったときに落ちます。

**買えないプランを表に出していた。**
決済がまだ繋がっていないのに、プラン画面が金額と
「月額プランではじめる」ボタンを出していました。買えない購読の価格を
並べた画面は **Guideline 2.1（未完成の機能）** で弾かれます。
`src/lib/billing.ts` の `BILLING_READY` が `false` の間は、
金額・購入ボタン・解約条件を出さないようにしました。
決済を繋いだら `true` にするだけで元に戻ります。

### 確認して問題が無かったもの

| 項目 | 実装 |
|---|---|
| アカウント削除 | `delete_my_account()` が `auth.users` ごと削除。他のテーブルは連鎖削除 |
| 通報 | **投稿詳細**（ヘッダーの旗アイコン / 本文末の「この投稿を通報する」）と**プロフィール**の2箇所。`reports` テーブル |
| ブロック | プロフィール画面から。`blocks` テーブル |
| 規約への同意 | 新規登録画面で個別のチェックとして取得 |
| 権限の説明文 | 位置・写真の2つが日本語で用途を明記（カメラは使っていないので宣言しない） |
| 輸出コンプライアンス | `ITSAppUsesNonExemptEncryption: false` |
| 位置情報の保存 | していない。押したときに1回取るだけで、サーバーに送っていない |
| アイコン・スプラッシュ | `mobile/assets/` に3点とも存在 |

### 運用で決めること

**フォロー上限2人のまま出す。** 決済が繋がっていないので、
3人目をフォローしようとしたユーザーは**上限を外す手段がありません**。
上限に当たったときのダイアログからは「プランを見る」を外してあります
（行き先が「準備中」では、外す方法があるように見せてしまうため）。
リジェクト理由になる可能性は低いものの、
**レビューで低評価が付きやすい箇所**です。決済を繋ぐか上限を緩めるかで解消します。

**デモデータの扱い（対応済み）。** `scripts/seed.mjs` の `@taro` には、
実在の店に対する★5レビューが**架空の人物名義**で入っています。
移行 `0010` で `profiles.is_demo` の印を付け、プロフィール・投稿詳細・
地図のプレビューに「実際の訪問に基づくレビューではありません」と
出るようにしました。印はアプリからは外せません（SQL Editor からのみ）。
**提出前に 0010 を本番へ流すこと。** 流し忘れると印が付かず、
デモが本物のレビューとして見えます。

---

## 8. 審査提出前のチェックリスト（ここが最重要）

ユーザー投稿型（UGC）アプリは**審査で落ちやすい**です。以下は
App Store Review Guidelines で明確に要求されている項目です。

### Guideline 1.2 — UGC アプリの必須要件（実装済み）

- [x] **不適切コンテンツのフィルタリング** → 保存する前にテキストを検査する。
      対象は **店舗名・本文（ひとこと）・アカウント名・自己紹介** の4項目。
      ユーザーID は小文字英字3〜20文字の既存制約で別に守られているため見ない。

      | どこ | 何のため | ファイル |
      |---|---|---|
      | 端末側 | 押す前に教える。写真を上げる前に止める | `mobile/src/lib/moderation.ts` |
      | DB側 | 最後に止める。改造しても外せない | `supabase/migrations/0012_content_moderation.sql` |

      端末側だけだと、アプリを改造されるか anon キーで PostgREST を
      直接叩かれれば素通りする。DB側だけだと、送信するまで駄目だと分からない。
      **両方に同じ語の一覧を持っている**ので、`npm run check:moderation` が
      毎回一致を検査する（食い違うと素通しの穴になるため）。

      過検知のほうが害が大きい点に注意すること。飲食レビューは
      「バカうまい」「死ぬほど美味い」「デブ活」のように褒め言葉が汚く、
      「シャブシャブ」「支那そば」「麻薬卵」「グレープフルーツ」には
      禁止語が部分文字列として入る。**これらを弾かないことを
      `npm run test:moderation` が毎回確認する。語を足したら必ず走らせること。**

      画像の判定はしていない（外部の判定APIを入れていない）。
      写真は通報とブロックで拾う。
- [x] **不適切コンテンツの通報機能** → **投稿単位**（投稿詳細のヘッダー旗アイコン、
      および本文末の「この投稿を通報する」）と**アカウント単位**（プロフィールの
      「通報」ボタン）の両方。投稿への通報は `target_post_id` だけを入れる。
      `admin_open_reports` が投稿から作者を引くため、両方入れると
      アカウントへの通報と見分けが付かなくなる
- [x] **ユーザーのブロック機能** → プロフィールの「ブロック」ボタン
- [x] **規約（EULA）への同意** → 新規登録画面のチェックボックス
- [ ] **24時間以内に通報へ対応する体制** → `reports` テーブルを毎日確認する運用を決める
      （Supabase Dashboard でよいが、担当と頻度を決めておくこと。
       審査で「どう対応するのか」を審査ノートに書くと通りやすい）

### Guideline 5.1.1(v) — アカウント削除（実装済み）

- [x] アプリ内から**アカウントを完全削除**できる → 設定 > アカウントを削除

### その他

- [x] **プライバシーポリシーURL / 利用規約 / サポート** のページを作成済み
      | 用途 | パス | ファイル |
      |---|---|---|
      | プライバシーポリシーURL（必須） | `/legal/privacy` | `app/legal/privacy/page.tsx` |
      | 利用規約（審査ノートに書く） | `/legal/terms` | `app/legal/terms/page.tsx` |
      | サポートURL（必須） | `/support` | `app/support/page.tsx` |

      本文の原本は **`mobile/src/legal/content.ts` の1箇所だけ**で、
      アプリと Web が同じものを読んでいる。二重管理していないので、
      直せば両方に反映される。**片方だけ直すことはできない。**
- [x] **Web を公開して URL を確定させた** — ✅ 本番稼働中

      | App Store Connect の欄 | 入れる URL |
      |---|---|
      | プライバシーポリシーURL | `https://meshimap.vercel.app/legal/privacy` |
      | サポートURL | `https://meshimap.vercel.app/support` |

      **公開しているのはこの3ページだけです。** 環境変数 `PUBLIC_SITE_ONLY=1`
      を本番にだけ設定し、`proxy.ts` がそれ以外を 404 にしています。
      Web版アプリ（地図・検索・プロフィール・DM）は審査に要らないので出していません。
      `/api/geocode` だけは開けてあります（アプリが使うため。未認証は 401）。

      独自ドメインを当てるなら**提出前に**行うこと。審査中に URL が変わると
      差し戻されます。
- [ ] **App Privacy（プライバシー情報）** の申告
      - 収集する項目: メールアドレス / ユーザーID / 写真 / 位置情報 / ユーザーコンテンツ
      - 「トラッキングに使用」は **いいえ**
- [ ] **年齢制限**: UGC があるため **12+ 以上**を選択
      （「不適切なコンテンツをユーザーが投稿できる」に該当）
- [ ] **審査用テストアカウント** を用意して審査ノートに記載
      （投稿が既に数件入っている状態にしておくと、地図が空でないので評価されやすい）
- [x] **位置情報の用途説明** が日本語で入っている
      （`npm run check:ios` で毎回検査。実機での見え方だけ最後に確認）
- [x] **使っていない権限を宣言していない**（マイク・常時位置情報・Face ID を削除済み）
- [ ] スクリーンショット: **6.7インチ と 6.5インチ** 必須（各3〜10枚）
- [ ] **App内課金は「なし」で申告する**。`BILLING_READY` が `false` の間は
      アプリ内に購入導線が無いので、課金ありで申告すると
      「該当機能が見つからない」と言われて逆に止まる
- [x] **サポートURL** を用意（`/support`。連絡先は `teardoro@gmail.com`）
      アプリを入れていない人・消してしまった人からも通報と削除依頼を
      受けられるようにしてある。アプリ内にしか窓口が無いと、
      その二者が行き止まりになり、Guideline 1.2 の体制として弱い。

### 審査ノートに書くと通りやすい文面（例）

```
テストアカウント: reviewer@example.com / ＜パスワード＞

・本アプリは飲食店の記録を地図で共有するアプリです。
・投稿は作成時点で必ず非公開です。ユーザーが明示的に公開に切り替えた場合のみ
  他のユーザーに表示されます。
・不適切な投稿・アカウントは各プロフィール画面の「通報」から報告でき、
  運営が24時間以内に確認し、削除または利用停止を行います。
・「ブロック」により相互に投稿とプロフィールが非表示になります。
・アカウントは「設定 > アカウントを削除」から完全に削除できます。
・位置情報は地図の現在地表示にのみ使用し、サーバーに保存していません。
・利用規約: https://meshimap.vercel.app/legal/terms
・プライバシーポリシー: https://meshimap.vercel.app/legal/privacy
・サポート・通報の受付: https://meshimap.vercel.app/support
```

---

## 9. リリース後の運用

- **通報の確認**: Supabase で `select * from reports where status = 'open'` を毎日確認
- **バージョン更新**: `app.config.ts` の `version`（表示用）と `ios.buildNumber`
  （提出ごとに必ず +1）を上げてから再ビルド
- **Google Maps の請求額**: 月初に Cloud Console で確認

---

## 付録A: Mac を持っていない場合

EAS Build（第7章の EAS 手順）を使えば、ビルド・署名・提出はすべてクラウド上で完結し
Mac は不要です。ただし以下は Mac 以外でも必要になります。

- **実機確認**: `eas build --profile preview` で作った内部配布ビルドを
  TestFlight 経由で自分の iPhone に入れて確認する
- **Apple Developer Program の登録**: ブラウザから可能

---

## よくある落とし穴

| 症状 | 原因と対処 |
|---|---|
| 地図が真っ白 | Maps SDK for iOS が有効化されていない / iOS 用鍵のバンドルID制限が違う |
| 都道府県が入らない | 主要エリアから離れた地点で Geocoding API が未有効。`resolveRegion` は失敗しても最寄り県で埋めるので気づきにくい |
| エリアが空 | 主要144エリアから15km以上離れている。この場合 `area` は null のままで、地図では `city` に集約される |
| Expo Go で地図が出ない | `react-native-maps` はネイティブモジュール。`expo prebuild` + `run:ios` が必要 |
| ログインが毎回切れる | `mobile/.env` の anon キー未設定、または Keychain 保存の失敗 |
| アイコンで審査リジェクト | `icon.png` に**透過**が含まれている |
| ビルド番号の重複エラー | `ios.buildNumber` を上げ忘れている |
