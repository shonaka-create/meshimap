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
| 5 | `supabase/migrations/0004_ranks_and_map_pins.sql` | ランク・アバター絵柄・地図のアイコン |
| 6 | `supabase/migrations/0005_admin_pin_and_follow_limit.sql` | 運営アカウントの常時表示とフォロー上限（無料2人） |
| 7 | `supabase/migrations/0006_repair_counters.sql` | 手動更新時代にズレたカウンタの数え直し |
| 8 | `supabase/migrations/0007_backfill_post_regions.sql` | 既存投稿への都道府県・エリアの後埋め |
| 9 | `supabase/migrations/0008_impressions_featured_monthly.sql` | 表示回数・注目フラグ・月間ランク |
| 10 | `supabase/migrations/0009_premium_gates.sql` | プレミアムの線引き（ランキング全順位・注目一覧） |
| 11 | `supabase/migrations/0010_demo_accounts.sql` | デモアカウントの印（画面に「デモです」と出す） |

> **`0010` はアプリを更新する前に流してください。**
> `profiles.is_demo` を読むようになるので、列が無いDBに新しいアプリを繋ぐと
> デモ表示が出ないだけで済みますが、印が付いていないデモデータが
> そのまま本物のレビューとして見えます。
>
> ⚠ **11 まで必ず実行してください。**
> `schema.sql` は開発初期のテーブル定義で、そこで止めると `username`・公開設定・
> 地域列・ランク列・ブロック/通報・各 RPC が存在せず、登録も地図も動きません。
> さらに `schema.sql` の RLS は `USING (true)`（全員が読める）のままなので、
> 途中で止めると**非公開のはずの投稿が第三者に見えます**。

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

`0005` が行うこと:

- 運営（`is_admin`）アカウントを、フォローの有無に関わらず地図に必ず表示する
- 新規登録時に運営を自動フォローする（`handle_new_user()` を置き換え）
- 無料プランのフォロー上限を 2 人にする（運営は上限に数えない）

`0004` が行うこと（Snap Map 風のアイコンとランク）:

- `profiles.areas_count`（制覇エリア数）をトリガーで維持する
- ランクは **投稿数 × 制覇エリア数**。同じ店に通うだけでは上がらない
  （しきい値は `mobile/src/lib/rank.ts` と対で管理。表示は端末、判定はDB）
- `avatar_emojis` 表と `profiles.avatar_emoji`。
  未解放の絵柄を選んでもトリガーが `NULL` に戻すので、
  端末側の値を書き換えても解放できない
- `map_pins()` … 自分とフォロー中の人の**最後に投稿したお店**を返す。
  **現在地は保存も共有もしない。** 位置情報を持たないので、
  「位置情報を常時取得するアプリ」としての審査対象にならない

`0006` / `0007` が行うこと:

- `0006` … カウンタを手動 UPDATE していた頃にズレた
  `posts_count` / `likes_count` / `comments_count` / フォロー数を数え直す
- `0007` … `prefecture` が空のまま入っている既存投稿に、
  座標から最寄り（8km以内）のエリアを後埋めする。
  `mobile/src/lib/regions.ts` から
  `node scripts/gen-region-backfill-sql.mjs` で生成しているので、
  **エリアを増やしたら生成し直して流す**（すでに埋まっている投稿は対象外）

`0008` が行うこと（表示回数・注目・月間ランク）:

- `posts.impressions_count` … **公開投稿を、投稿者以外が開いた数**。
  同じ人・同じ投稿は**1日1回**しか数えない。
  リロードで伸ばせる数字は指標ではなく操作対象になってしまうため、
  「何回開かれたか」ではなく「何人に届いたか」を数えている
- `post_impressions` … 誰が見たかの記録。
  **RLS を有効にしてポリシーを1つも作らない**ので誰も直接読めない。
  書き込みも `record_impression()` を通したときだけ通る
  （閲覧履歴は、見せて得られるものより失うものが大きい）
- `posts.featured_at` … 直近7日の閲覧が20人以上の間だけ更新され続ける。
  閲覧が止まれば更新も止まり、期間が過ぎると自然に「注目」から外れる
  （期限切れを掃除する仕組みが要らない）
- `profile_monthly_impressions` + `monthly_tier()` … 月ごとに入れ替わるランク。
  通算で決めると先に始めた人が居座り続けて後発が追いつけないので、
  **毎月ゼロから**数え直す。しきい値は `mobile/src/lib/impressions.ts` と対で管理

`0009` が行うこと（プレミアムの線引き）:

- 月間ランキングは、無料だと**上位3人＋自分の行**しか返らない。
  自分の順位まで有料にすると、何を買うのか分からないまま
  課金を迫ることになるので、そこは無料のままにしてある
- 注目の投稿一覧は、無料だと**2件**まで。ただし全体の件数は返す
  （あと何件あるか分からないと、買うかどうかの判断ができない）
- **端末側で隠すのではなく、そもそも返さない。**
  隠すだけだと API を直接叩けば全部読めてしまう
- `featured_post_ids()` は**あえて SECURITY DEFINER にしていない**。
  投稿を返す経路なので `posts` の RLS をそのまま効かせる必要がある
  （定義者権限で読むと、非公開投稿やブロック相手の投稿まで出る）

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

# 地図表示（Leaflet/OpenStreetMap を使っているため、現時点では未使用）
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=＜Web用の鍵（HTTPリファラ制限）＞

# 任意。投稿地点の市区町村を Google Geocoding で補うときだけ設定する。
# ブラウザには出さない（NEXT_PUBLIC_ を付けない）こと。
# Geocoding はリファラ制限が効かないため、公開鍵を使うと請求を肩代わりさせられる。
# 未設定でも内蔵の225エリアで判定は動く（市区町村名が入らないだけ）。
GOOGLE_GEOCODING_KEY=＜サーバー専用の鍵（IP制限）＞
```

> Web 版は登録時に `username` / `display_name` を iOS 版と同じ契約で送るようになりました。
> ただし投稿ごとの公開/非公開の切り替え UI はまだ iOS 版にしかありません。
> `posts.is_public` の既定は `false`（非公開）なので、Web からの投稿は
> 非公開で作成され、公開したい場合は iOS 版から切り替えてください。

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
| 投稿 | 計40件（`@taro` のみ15件・他は各5件。すべて公開・`prefecture` と `area` 入り） |
| 関係 | デモ6人の相互フォロー、いいね、コメント |

> **もう一度流しても増えません。** 店名が既に入っている投稿は飛ばすので、
> 投稿を足したあとに流し直すと、足したぶんだけが入ります。
> プロフィール（bio・公開設定）は毎回上書きされます。
>
> 1アカウントだけ増やしたいときは `SEED_USERS` で絞れます。
>
> ```powershell
> $env:SEED_USERS='taro'
> $env:SEED_EMAIL_TEMPLATE='あなたのアドレス+{u}@gmail.com'
> $env:SEED_PASSWORD='…'; $env:SEED_ADMIN_PASSWORD='…'
> npm run seed
> ```
>
> ⚠ **店名は実在の店です。評価は一律★5で入ります。**
>
> つまり、実在の店に対する星5レビューが、架空の人物
> （`@taro` 田中太郎など）の名義で載ります。
>
> **移行 `0010` を流すと、これらのアカウントに「デモ」の印が付き、
> プロフィール・投稿詳細・地図のプレビューに
> 「実際の訪問に基づくレビューではありません」と表示されます。**
> 印はアプリからは外せません（SQL Editor からのみ操作可）。
>
> 印を付けずに公開すると、実在の店についての
> 「行ってもいない人のレビュー」を掲載していることになります。
>
> 座標は街区の目安で、建物単位の精度はありません。
> エリア判定（最寄り8km）には十分ですが、地図上で番地まで
> 合わせたい場合は個別に直してください。

### 4-0. デモデータを直したとき

`npm run check:seed` を通してください。
投稿の `prefecture` / `area` は手書きですが、本来は座標から
`regions.ts` が判定するものです。エリアデータを増やすと判定が変わり、
既存のデモが静かに壊れます（225→307件に増やしたときに実際に起きました）。

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
