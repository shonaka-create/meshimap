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

| 鍵の名前 | 制限 | `.env` の変数 |
|---|---|---|
| `meshimap-ios` | アプリ制限: **iOS バンドルID `com.shonaka.meshimap`**<br>API制限: `maps-ios-backend` のみ | `GOOGLE_MAPS_IOS_KEY` |
| `meshimap-geocoding` | アプリ制限: 不可（端末から直接叩くため）<br>API制限: **`geocoding-backend` のみ** | `EXPO_PUBLIC_GOOGLE_GEOCODING_KEY` |

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
```

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
   - **バンドルID**: `com.shonaka.meshimap`
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
eas secret:create --name EXPO_PUBLIC_GOOGLE_GEOCODING_KEY --value "＜Geocoding用の鍵＞"
eas secret:create --name EXPO_PUBLIC_SUPABASE_URL --value "https://ceohkxunpotitdbyyxyl.supabase.co"
eas secret:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "＜anonキー＞"
```

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

## 8. 審査提出前のチェックリスト（ここが最重要）

ユーザー投稿型（UGC）アプリは**審査で落ちやすい**です。以下は
App Store Review Guidelines で明確に要求されている項目です。

### Guideline 1.2 — UGC アプリの必須要件（実装済み）

- [x] **不適切コンテンツの通報機能** → プロフィールの「通報」ボタン
- [x] **ユーザーのブロック機能** → プロフィールの「ブロック」ボタン
- [x] **規約（EULA）への同意** → 新規登録画面のチェックボックス
- [ ] **24時間以内に通報へ対応する体制** → `reports` テーブルを毎日確認する運用を決める
      （Supabase Dashboard でよいが、担当と頻度を決めておくこと。
       審査で「どう対応するのか」を審査ノートに書くと通りやすい）

### Guideline 5.1.1(v) — アカウント削除（実装済み）

- [x] アプリ内から**アカウントを完全削除**できる → 設定 > アカウントを削除

### その他

- [ ] **プライバシーポリシーURL** を App Store Connect に登録（Webにも公開が必要）
      → `mobile/app/legal/privacy.tsx` と同じ内容を Web に置く
- [ ] **App Privacy（プライバシー情報）** の申告
      - 収集する項目: メールアドレス / ユーザーID / 写真 / 位置情報 / ユーザーコンテンツ
      - 「トラッキングに使用」は **いいえ**
- [ ] **年齢制限**: UGC があるため **12+ 以上**を選択
      （「不適切なコンテンツをユーザーが投稿できる」に該当）
- [ ] **審査用テストアカウント** を用意して審査ノートに記載
      （投稿が既に数件入っている状態にしておくと、地図が空でないので評価されやすい）
- [ ] **位置情報の用途説明** が日本語で表示されるか実機で確認
      （`app.config.ts` の `NSLocationWhenInUseUsageDescription`）
- [ ] スクリーンショット: **6.7インチ と 6.5インチ** 必須（各3〜10枚）

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
