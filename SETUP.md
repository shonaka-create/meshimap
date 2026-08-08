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

`0001` は `BEGIN; … COMMIT;` で囲んであるため、**途中で失敗しても何も適用されません**。
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
| Geocoding API | 都道府県・市区町村の判定 | 地図の階層集計が空になる |
| Places API | 最寄り駅の判定 | 駅レベルだけ空になる（他は動く） |

### 2-3. アイコンを配置

`mobile/assets/` に以下が必要です（**無いとビルドが失敗します**）。

- `icon.png` … 1024×1024・**透過なし**
- `splash.png` … 1284×2778 推奨
- `adaptive-icon.png` … Android 用（iOS のみなら不要）

### 2-4. 起動

`react-native-maps` はネイティブモジュールなので **Expo Go では動きません**。

```bash
npx expo prebuild --clean   # ネイティブプロジェクトを生成
npx expo run:ios --device   # 実機で起動（Mac + iPhone）
```

Mac が無い場合は EAS Build を使います → [`docs/IOS_RELEASE.md`](docs/IOS_RELEASE.md)

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
