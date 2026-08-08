# MeshiMap — iOS アプリ（Expo / React Native）

App Store 提出用のネイティブアプリです。バックエンドはリポジトリ直下の Web 版と
同じ Supabase プロジェクトを共有しています。

```
mobile/
├─ app/                       Expo Router（ファイル名 = 画面のパス）
│  ├─ _layout.tsx             認証ゲート + 全体のナビゲーション
│  ├─ (auth)/                 ログイン / 新規登録
│  ├─ (tabs)/                 ホーム(地図) / Fav / ＋投稿 / 検索 / プロフィール
│  ├─ post/new.tsx            投稿作成（写真5枚・動画不可）
│  ├─ user/[username].tsx     他人のプロフィール
│  ├─ settings/               設定・プロフィール編集・リクエスト・ブロック一覧
│  └─ legal/                  利用規約 / プライバシーポリシー
└─ src/
   ├─ theme.ts                デザイントークン（色・余白・字送り）
   ├─ components/             UIキット・地図の投稿プレビュー・通報ダイアログ
   ├─ hooks/                  useAuth / useLocation
   └─ lib/                    supabase / geocode / types / posts
```

## はじめかた

```bash
npm install
cp .env.example .env     # 値を埋める（README下部の表を参照）
npx expo prebuild --clean
npx expo run:ios --device
```

> **Expo Go では動きません。** `react-native-maps` がネイティブモジュールのため、
> `prebuild` して自前のビルドを作る必要があります。

## 環境変数

| 変数 | 用途 | 取得先 |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase 接続先 | Dashboard > Settings > API |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase 公開キー | 同上（`anon public`） |
| `GOOGLE_MAPS_IOS_KEY` | 地図表示（Maps SDK for iOS） | Google Cloud Console |
| `EXPO_PUBLIC_GOOGLE_GEOCODING_KEY` | 県/市区町村/駅の判定 | 同上（Geocoding + Places） |

`.env` は Git 対象外です。**鍵をコミットしないでください。**

## 設計上のポイント

### 認証：アカウント名とユーザーIDを分離した

| | アカウント名 `display_name` | ユーザーID `username` |
|---|---|---|
| 例 | しょうたろう | `meshitaro` |
| 重複 | **OK** | **不可（一意）** |
| 使える文字 | 自由（日本語可） | 小文字のアルファベットのみ・3〜20文字 |
| 用途 | 画面に出る名前 | @メンション・プロフィールURL |

以前は DB のトリガーが `split_part(email, '@', 1)` で**メールアドレスから表示名を作って
いた**ため、メールアドレスが他人に見えていました。移行 `0001` でこれを廃止し、
サインアップ時に入力された値だけを使うようにしています。

ログイン認証自体は従来どおり **メールアドレス + パスワード** です
（アカウント名は重複可能なのでログインIDには使えません）。

### 公開範囲は2段構え

| | 既定 | 効果 |
|---|---|---|
| `profiles.is_public` | 非公開 | 公開にすると、公開した投稿が検索・地図に出る |
| `posts.is_public` | **非公開** | 投稿ごとに個別に切り替える |

投稿が第三者に見えるのは **両方が公開** のときだけです。非公開アカウントの場合、
公開した投稿も**承認済みのフォロワー**にしか見えません。
この判定はアプリ側ではなく **Postgres の RLS** で行っているため、
クライアントを改造されても漏れません。

### 地図の階層

`県 → 市区町村` の順に下ります。各階層のバブルには**その範囲の投稿数**が出ます。
バブルをタップすると1階層下り、**上の階層のバブルは消えます**（画面には常に1階層だけ）。
市区町村をタップすると、個々の投稿ピンに切り替わります。

集計は RPC `post_counts_by_region` が担当します。この関数は `SECURITY INVOKER` なので
posts の RLS がそのまま効き、**自分に見える投稿だけ**が数えられます。

県・市区町村は投稿時に Google Geocoding で解決して `posts` に保存します
（表示のたびにジオコーディングすると費用も遅延も嵩むため）。
解決に失敗しても投稿自体は成立します（その投稿が階層集計に出ないだけ）。

**最寄り駅の階層は意図的に入れていません。** 駅の判定には Places Nearby Search が
必要ですが、Geocoding の6倍以上の単価（約 $32/1,000）で無料枠も半分しかないためです。
`posts.station` 列と RPC の `'station'` レベルは残してあるので、
将来入れる場合は駅座標のオープンデータを DB に取り込んで SQL で最近傍を求めるのが
費用ゼロで済みます。

### App Store 対応

UGC アプリの審査要件（Guideline 1.2 / 5.1.1(v)）を満たすため、以下を実装済みです。

- 通報（プロフィール画面 → 通報）
- ブロック（相互に不可視化。RLS レベルで遮断）
- 利用規約への同意（新規登録時のチェックボックス）
- アカウントの完全削除（設定 → アカウントを削除）

**運用側の宿題**: 通報は24時間以内に対応する必要があります。
`reports` テーブルを毎日確認してください。

## コマンド

```bash
npm run typecheck   # tsc --noEmit
npm run lint
npm start           # 開発サーバ
npm run ios         # 実機/シミュレータで起動
npm run prebuild    # ネイティブプロジェクトを作り直す
```

## 提出手順

→ [`../docs/IOS_RELEASE.md`](../docs/IOS_RELEASE.md)
