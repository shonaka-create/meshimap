# MeshiMap セットアップガイド

> このリポジトリには2つのアプリが入っています。
> - **リポジトリ直下** … Next.js の Web 版（既存）
> - **`mobile/`** … React Native / Expo の iOS 版（App Store 提出用）
>
> バックエンドは **Supabase** を共有しています。
> （※以前このファイルには Firebase の手順が書かれていましたが、実装は Supabase です）

---

## 1. Supabase プロジェクト

使用中のプロジェクト: `ceohkxunpotitdbyyxyl`
→ https://supabase.com/dashboard/project/ceohkxunpotitdbyyxyl

### 1-1. SQL の適用

**SQL Editor** で以下を順番に貼り付けて実行します。

| 順 | ファイル | 内容 |
|---|---|---|
| 1 | `supabase/schema.sql` | テーブル・Storage・基本RLS（**初回のみ**） |
| 2 | `supabase/migrations/0001_accounts_privacy_regions.sql` | ユーザーID/公開設定/地域集計/通報・ブロック |
| 3 | `supabase/migrations/0002_areas_and_situations.sql` | エリア階層（station→area）とシチュエーション |
| 4 | `supabase/migrations/0003_admin.sql` | 運営（管理者）アカウントと通報の審査 |

いずれも `BEGIN; … COMMIT;` で囲んであるため、**途中で失敗しても何も適用されません**。
また冪等なので、何度実行しても壊れません。

`0001` が行うこと:

- `profiles.username`（ユーザーID / 小文字英字のみ / **一意**）を追加
- `profiles.display_name`（アカウント名 / **重複OK**）から**メールアドレス由来の値を排除**
- `profiles.is_public` / `posts.is_public` を追加（どちらも既定は**非公開**）
- `posts.prefecture` / `city` / `station` を追加（地図の階層集計用）
- `follows.status` を追加（非公開アカウントへのフォローは承認制）
- `blocks` / `reports` テーブルを追加（App Store 審査の必須要件）
- 投稿・フォロー・いいね・コメントのカウンタを**トリガー化**
  （従来はクライアント側の手動 UPDATE で、同時操作時にズレるバグがあった）
- RLS を貼り直し、**非公開投稿が第三者に見えないよう**修正

`0003` が行うこと:

- `profiles.is_admin` を追加し、**運営だけが通報を閲覧・対応できる**ようにする
  （0001 の時点では通報者本人しか読めず、**誰も審査できない**状態だった）
- 管理者が読めるのは「通報が付いた投稿」だけ。全ての非公開投稿は読めない
- アプリ側から自分を管理者に昇格できないよう、`is_admin` の変更を
  トリガーで差し戻す（SQL Editor からの操作だけ通す）

### 1-2. Authentication

- **Providers** → 「Email」を有効化
- 確認メールを使う場合は **URL Configuration → Redirect URLs** に `meshimap://` を追加

### 1-3. Storage

`schema.sql` が `post-images` と `avatars` バケットを作ります。
Dashboard の **Storage** で両方が `public` になっているか確認してください。

### 1-4. キーの取得

**Project Settings → API** の `anon public` を控えます（後述の `.env` に設定）。

---

## 2. iOS アプリ（`mobile/`）

```bash
cd mobile
npm install
```

### 2-1. `mobile/.env` を作成

```env
EXPO_PUBLIC_SUPABASE_URL=https://ceohkxunpotitdbyyxyl.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=＜anon public キー＞

# iOS の Maps SDK 用（バンドルID com.shonaka.meshimap で制限をかける）
GOOGLE_MAPS_IOS_KEY=＜iOS用の鍵＞

# 逆ジオコーディング（Geocoding API + Places API）用
EXPO_PUBLIC_GOOGLE_GEOCODING_KEY=＜Geocoding用の鍵＞
```

> `.env` はリポジトリ直下の `.gitignore` の `.env*` によって Git 対象外です。
> **絶対にコミットしないでください。**
> 鍵を `.gitignore` 自体に書くと、`.gitignore` はコミットされるファイルなので
> 逆に公開されてしまいます。

### 2-2. Google Maps Platform で有効化する API

| API | 用途 | 無いとどうなるか |
|---|---|---|
| Maps SDK for iOS | 地図表示 | 地図が真っ白になる |
| Geocoding API | 主要エリア外の地点の判定 | その地点だけ最寄りの県で埋められる |

> **Places API は有効化しません。** 都道府県・エリアの判定は
> `mobile/src/lib/regions.ts` の内蔵データ（47県 + 主要144エリア）で行います。
> 主要都市の投稿はこれだけで解決するため、Geocoding API もほとんど呼ばれません。

### 2-3. アイコンを配置

`mobile/assets/` に以下が必要です（**無いとビルドが失敗します**）。

- `icon.png` … 1024×1024・**透過なし**
- `splash.png` … 1284×2778 推奨
- `adaptive-icon.png` … Android 用（iOS のみなら不要）

### 2-4. 起動

**A. Expo Go（Mac不要・無料・すぐ試せる）**

```bash
npx expo start
```

iPhone に App Store から **Expo Go** を入れ、表示された QR を
カメラで読み込みます（PC と iPhone を同じ Wi-Fi に繋いでおくこと）。

> **地図だけ Apple 地図になります。** iOS の Google Maps は
> Google Maps SDK をアプリに組み込む必要があり、Expo Go には入っていません。
> `src/lib/mapProvider.ts` が Expo Go を検出して自動で切り替えます。
> ログイン・投稿・検索・プロフィール・通報などの動作確認はこれで足ります。

**B. 開発ビルド（Google Maps 込みで確認する）**

Mac があるなら:

```bash
npx expo prebuild --clean
npx expo run:ios --device
```

Mac が無いなら EAS Build（クラウド）を使います。
Apple Developer Program の登録が必要です
→ [`docs/IOS_RELEASE.md`](docs/IOS_RELEASE.md)

---

## 3. Web 版（リポジトリ直下 / Next.js）

```bash
npm install
npm run dev   # http://localhost:3000
```

`.env.local` に以下を設定します。

```env
NEXT_PUBLIC_SUPABASE_URL=https://ceohkxunpotitdbyyxyl.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=＜anon public キー＞
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=＜Web用の鍵（HTTPリファラ制限）＞
```

> Web 版は `0001` 移行の適用後、`username` / `is_public` を扱わないため
> 表示や公開範囲が iOS 版と食い違います。iOS を主軸にするなら、
> Web 版は管理用途に絞るか、同様の対応を入れてください。

---

## 4. デモデータと運営アカウント

新しい Supabase プロジェクトは空なので、動作確認用のデータを入れます。

**先に** Authentication → **Sign In / Providers → Confirm email を OFF** にしてください。
確認メールが必要な状態だと、スクリプトがサインインできません。

**PowerShell（Windows）**

```powershell
$env:SEED_PASSWORD='デモ用の適当なパスワード'
$env:SEED_ADMIN_PASSWORD='運営用の別のパスワード'
npm run seed
```

**bash / zsh（macOS・Linux）**

```bash
SEED_PASSWORD='デモ用の適当なパスワード' \
SEED_ADMIN_PASSWORD='運営用の別のパスワード' \
npm run seed
```

投入されるもの:

| | 内容 |
|---|---|
| 運営 | `@admin`（投稿なし） |
| デモ | `@taro` `@hanako` `@kenji` `@yuki` `@yamada` `@ebisu` |
| 投稿 | 各5件・計30件（すべて公開・`prefecture` と `area` 入り） |
| 関係 | デモ6人の相互フォロー、いいね、コメント |

> **パスワードはスクリプトに書かれていません。** 環境変数で渡します。
> 以前のシードスクリプトには実在のメールアドレスとパスワードが
> 直接書かれており、公開リポジトリに載っていました。

### 4-1. 管理者権限の付与

`is_admin` はアプリ側からは立てられません（移行0003 のトリガーが差し戻します）。
SQL Editor で `supabase/scripts/grant-admin.sql` を実行してください。

```sql
UPDATE profiles SET is_admin = true WHERE username = 'admin';
```

これで運営アカウントから通報一覧を読めるようになります。

```sql
SELECT * FROM admin_open_reports();
```

---

## 4. App Store への提出

→ [`docs/IOS_RELEASE.md`](docs/IOS_RELEASE.md) に全手順（Apple Developer 登録から
審査チェックリストまで）をまとめています。

---

## 5. 運用で必ずやること

| 項目 | 頻度 | 内容 |
|---|---|---|
| 通報の確認 | **毎日** | `select * from reports where status = 'open'`（審査要件で24時間以内の対応が必要） |
| Google Maps の請求 | 月初 | Cloud Console → お支払い。予算アラートも設定しておく |
| API キーの棚卸し | 随時 | 制限（バンドルID / API種別 / 日次上限）が外れていないか |
