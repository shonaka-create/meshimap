# meshimap バグ監査レポート

## 監査時点

- 監査開始時 HEAD: `0ef2a3a`
- 監査開始時 `git status --short`:

```text
 M components/auth/LoginForm.tsx
 M lib/supabase.ts
 M mobile/app/(auth)/sign-up.tsx
 M mobile/app/(tabs)/index.tsx
 M mobile/app/post/new.tsx
 M mobile/src/components/PostPreviewSheet.tsx
 M mobile/src/components/ProfileView.tsx
 M mobile/src/components/ui.tsx
 M mobile/src/theme.ts
?? mobile/app/post/done.tsx
?? mobile/src/components/CloudTransition.tsx
?? mobile/src/lib/maps.ts
```

- 監査中に外部で上記変更がコミットされ、レポート作成直前は HEAD `0b37994`、`git status --short` は空（clean）になった。`0ef2a3a..0b37994` の差分が開始時の12ファイルと一致することを確認済み。監査者はアプリコードを変更していない。

## 静的チェック

- Web `npm run typecheck`: 成功（0エラー、0警告）
- Web `npm run lint`: 成功（0エラー、29警告）
  - `react-hooks/exhaustive-deps`: 7件
  - `@next/next/no-img-element`: 13件
  - `@typescript-eslint/no-unused-vars`: 9件
- Mobile `npm run typecheck`: 成功（0エラー、0警告）
- Web lint の初回並行実行は120秒でタイムアウトしたため、単独で再実行して上記結果を確定した。

## 検出したバグ

### High Web の新規登録で入力した表示名が保存されない
- 該当: `hooks/useAuth.ts:98`, `hooks/useAuth.ts:101`, `hooks/useAuth.ts:105`, `supabase/migrations/0005_admin_pin_and_follow_limit.sql:164`, `supabase/migrations/0005_admin_pin_and_follow_limit.sql:172`
- 症状: Web からメール登録すると、入力した表示名ではなく `user...` 形式の自動生成ユーザーIDがプロフィール表示名になる。最新の DB トリガー適用環境で再現する。
- 原因: Web は Auth metadata に `full_name` を送る一方、0005 で置き換えられた `handle_new_user()` は `display_name` と `username` しか読まない。トリガーが先にプロフィールを作るため、その後の `upsert(..., ignoreDuplicates: true)` も既存行を更新しない。
- 修正方針: Web も `username` / `display_name` を送る契約に統一し、登録後の upsert に依存しない。Web UI に username 入力を追加するか、Web 用の明示的な生成仕様を定める。
- 確度: 確実

### High Web 投稿で `posts_count` が1件につき2増える
- 該当: `components/post/CreatePostModal.tsx:102`, `components/post/CreatePostModal.tsx:104`, `components/post/CreatePostModal.tsx:105`, `supabase/migrations/0001_accounts_privacy_regions.sql:301`, `supabase/migrations/0001_accounts_privacy_regions.sql:313`
- 症状: Web から1件投稿するとプロフィールの投稿数が2増え、ランク条件や表示件数が実データより先行する。
- 原因: DB の `trg_post_counts` が INSERT 後に自動加算するのに、Web が最新値を取得してさらに1加算している。
- 修正方針: Web 側のプロフィール手動更新を削除し、DB トリガーを唯一の更新元にする。既存データは実投稿数から再集計する。
- 確度: 確実

### High Web の「いいね」が毎回2件分増減する
- 該当: `components/post/PostCard.tsx:72`, `components/post/PostCard.tsx:78`, `components/post/PostCard.tsx:81`, `components/post/PostCard.tsx:84`, `components/post/PostCard.tsx:85`, `supabase/migrations/0001_accounts_privacy_regions.sql:317`, `supabase/migrations/0001_accounts_privacy_regions.sql:329`
- 症状: Web で未いいねの投稿にいいねすると DB の `likes_count` が2増え、解除すると2減る。0付近では表示と実際の likes 行数が食い違う。
- 原因: likes 行の INSERT/DELETE 時点で DB トリガーが既に±1した後、Web がその最新値に同じ `delta` を再度加えて posts を更新する。
- 修正方針: `posts.likes_count` の手動更新を廃止し、likes 行の操作後に必要ならカウンタを再取得するだけにする。既存カウンタも likes の実数で再集計する。
- 確度: 確実

### High Web 投稿が Mobile の地域階層とエリア実績に現れない
- 該当: `components/post/CreatePostModal.tsx:69`, `components/post/CreatePostModal.tsx:75`, `components/post/CreatePostModal.tsx:78`, `supabase/migrations/0001_accounts_privacy_regions.sql:65`, `supabase/migrations/0002_areas_and_situations.sql:34`, `supabase/migrations/0004_ranks_and_map_pins.sql:29`
- 症状: Web で作成した投稿は座標と店名だけ保存され、Mobile の都道府県→エリア集計に載らない。また `areas_count` にも加算されず、同じアカウントでも Web 投稿ではエリア条件のランクが進まない。
- 原因: Web の INSERT は `prefecture` / `city` / `area` を一切設定しない。地域集計と `recount_areas()` は `COALESCE(area, city)` を集計キーにしている。
- 修正方針: 座標確定時または信頼できるサーバー処理で Mobile と同じ地域解決を行い、3列を保存する。既存 Web 投稿も座標からバックフィルする。
- 確度: 確実

### High `supabase/schema.sql` 単独適用では現行アプリの DB にならず、公開範囲も破れる
- 該当: `supabase/schema.sql:3`, `supabase/schema.sql:7`, `supabase/schema.sql:19`, `supabase/schema.sql:117`, `supabase/schema.sql:122`, `supabase/migrations/0001_accounts_privacy_regions.sql:22`, `supabase/migrations/0005_admin_pin_and_follow_limit.sql:51`
- 症状: `schema.sql` 冒頭の指示どおりファイル単独を SQL Editor に貼ると、`username`、公開設定、地域列、ランク列、ブロック/通報、subscriptions、各 RPC が存在しないため Mobile の登録・地図・フォロー上限等が失敗する。さらに profiles/posts が `USING (true)` となり、現行の非公開・ブロック前提を満たさない。
- 原因: `schema.sql` が migrations 0001〜0005 の変更を取り込んでおらず、旧初期スキーマのまま「そのまま貼り付けて実行」と案内している。
- 修正方針: 現行 migrations 適用後の完全なスキーマへ同期するか、bootstrap は migrations のみに一本化して `schema.sql` の単独適用指示を削除する。CI で新規 DB への全適用を検証する。
- 確度: 確実

### High 投稿作成と画像保存が非原子的で、失敗時に不完全投稿と再試行重複が残る
- 該当: `mobile/app/post/new.tsx:129`, `mobile/app/post/new.tsx:153`, `mobile/app/post/new.tsx:168`, `components/post/CreatePostModal.tsx:68`, `components/post/CreatePostModal.tsx:86`
- 症状: posts INSERT 後に画像加工、通信、Storage upload、post_images INSERT のどこかが失敗すると、「投稿に失敗」と表示される一方で posts 行と途中までの画像は残る。ユーザーが再試行すると別の投稿が作られ、空画像投稿・重複投稿・孤立 Storage object が発生する。
- 原因: 複数段の処理にロールバックまたは再開用 ID がなく、catch でも作成済みデータを補償削除しない。
- 修正方針: draft/uploading 状態を導入して全画像完了後に publish するサーバー処理へ寄せるか、失敗時の補償削除と同一 post ID での再開を実装する。
- 確度: 確実

### Medium Web は `post_images` INSERT エラーを無視して投稿成功扱いにする
- 該当: `components/post/CreatePostModal.tsx:96`, `components/post/CreatePostModal.tsx:97`, `components/post/CreatePostModal.tsx:99`, `components/post/CreatePostModal.tsx:107`
- 症状: Storage upload は成功したが post_images の RLS・DB・通信エラーが返った場合、画像関連行が作られていないのに処理が続き「投稿しました！」になる。Storage には参照されない object が残る。
- 原因: Supabase query は DB エラーを throw せず `{ error }` で返すが、`withTimeout()` の戻り値を分解・検査していない。
- 修正方針: 戻り値の `error` を毎回検査して throw し、上記の補償処理または publish 手順につなげる。
- 確度: 確実

### Medium 投稿完了画面はプロフィール再取得失敗時にも古い数字を成功結果として表示する
- 該当: `mobile/app/post/done.tsx:45`, `mobile/app/post/done.tsx:47`, `mobile/app/post/done.tsx:73`, `mobile/src/hooks/useAuth.tsx:54`, `mobile/src/hooks/useAuth.tsx:56`
- 症状: 投稿自体は成功した後、プロフィール再取得だけが通信エラーになると、完了画面は読み込みを終えて投稿前の `profile` を表示する。今回の増分が0、ランクアップなしとなり、画面の目的である成果表示が誤る。
- 原因: `loadProfile()` は取得エラーをログだけで握りつぶして resolve し、`PostDone` は `.finally()` で成功・失敗を区別せず `ready=true` にする。
- 修正方針: refresh の失敗を呼び出し元へ返し、再試行 UI を出す。少なくとも取得成功を確認するまで成果値を確定表示しない。
- 確度: 確実

### Medium 雲遷移の非同期処理に reject・アンマウント時の復旧がない
- 該当: `mobile/src/components/CloudTransition.tsx:56`, `mobile/src/components/CloudTransition.tsx:63`, `mobile/src/components/CloudTransition.tsx:71`, `mobile/src/components/CloudTransition.tsx:89`
- 症状: `AccessibilityInfo.isReduceMotionEnabled()` が reject すると `busy.current` が true のままになり、その画面では以後すべての地域タップが無視される。また遷移途中に画面を離れると animation callback がアンマウント後に `setActive(false)` を呼び得る。
- 原因: Promise に catch/finally がなく、Animated sequence を cleanup で停止していない。busy の解除も正常終了経路にしかない。
- 修正方針: reduce-motion 取得失敗時は通常演出または即時 `onCovered` へフォールバックし、必ず busy を解除する。animation ref と mounted flag を持ち、cleanup で stop する。
- 確度: 確実

### Low Web の画像プレビュー URL を解放しておらず、選び直すたびメモリが残る
- 該当: `components/post/CreatePostModal.tsx:43`, `components/post/CreatePostModal.tsx:46`, `components/post/CreatePostModal.tsx:167`
- 症状: 投稿モーダル内で大きな画像を何度も選択・削除すると、タブを閉じるまで Blob URL と元画像メモリが保持され、低メモリ端末で動作が重くなる。
- 原因: `URL.createObjectURL()` に対応する `URL.revokeObjectURL()` が削除時・再選択時・アンマウント時のいずれにもない。
- 修正方針: preview の差し替え・削除時に revoke し、useEffect cleanup でも残存 URL を全解放する。
- 確度: 確実

## 対応状況（2026-08-09）

High 6件と、同じ原因から派生する Medium/Low を修正した。未コミット。

| # | 内容 | 状態 | 主な変更 |
|---|---|---|---|
| High 1 | Web登録の表示名が保存されない | 修正 | `hooks/useAuth.ts` `components/auth/AuthProvider.tsx` `components/auth/LoginForm.tsx` |
| High 2 | `posts_count` が2増える | 修正 | `components/post/CreatePostModal.tsx` |
| High 3 | いいねが2件分増減 | 修正 | `components/post/PostCard.tsx` |
| High 4 | Web投稿が地域階層とエリア実績に出ない | 修正 | `lib/regions.ts` `lib/geocode.ts` `app/api/geocode/route.ts` `components/post/CreatePostModal.tsx` |
| High 5 | `schema.sql` 単独適用で壊れる | 修正 | `supabase/schema.sql` `SETUP.md` |
| High 6 | 投稿と画像保存が非原子的 | 修正 | `components/post/CreatePostModal.tsx` `mobile/app/post/new.tsx` |
| Medium | `post_images` の INSERT エラーを無視 | 修正 | `components/post/CreatePostModal.tsx` |
| Low | 画像プレビューの Blob URL を解放しない | 修正 | `components/post/CreatePostModal.tsx` |
| Medium | 投稿完了画面が再取得失敗時に古い数字を出す | 未対応 | `mobile/app/post/done.tsx` |
| Medium | 雲遷移に reject・アンマウント復旧がない | 未対応 | `mobile/src/components/CloudTransition.tsx` |

### 監査に載っていなかったが、同じ原因で見つかったもの

- **コメント数も2増えていた。** `PostCard.submitComment` が `comments_count` を手動加算する一方、
  `trg_comment_counts`（0001）が既に加算している。いいねと同一の欠陥。修正済み。
- **プロフィール取得の失敗がカウンタを0に潰す。** `UserProfileView` が
  `upsert({..., followers_count: 0, following_count: 0, posts_count: 0}, { onConflict: 'id' })`
  を実行していた。`if (!resolvedProfile)` で守られているが、RLS や通信で取得に失敗しただけでも
  この分岐に入り、**既存プロフィールの3カウンタが0で上書きされ、表示名がメールアドレスの
  先頭に書き換わる**。`username` を送っていないので 0001 適用後は upsert 自体通らないが、
  経路として危険なため削除した。プロフィール行の作成は `handle_new_user()` に一本化。
- **SETUP.md の適用手順に `0005` が載っていなかった。** 手順どおりに新規DBを作ると
  運営アカウントの常時表示とフォロー上限が入らない。追記した。

### 既存データの手当て

1. `supabase/migrations/0006_repair_counters.sql` … 二重加算されたカウンタを実データから数え直す。
   既存の `supabase/sync-counts.sql` は `follows.status`（0001 で追加）を見ないので、
   こちらを使うこと。
2. 地域列が空の既存投稿を座標から埋める。`areas_count` は `trg_areas_count` が自動で数え直す。
   2通りあるが、**SQL の方を推奨**（service_role キーを手元に出さずに済む）。
   - `supabase/migrations/0007_backfill_post_regions.sql` … SQL Editor に貼るだけ。
     `lib/regions.ts` から自動生成（`node scripts/gen-region-backfill-sql.mjs` で再生成）。
   - `node scripts/backfill-regions.mjs --dry-run` … 同じ判定を node で行う。
     他人の投稿も更新するため `SUPABASE_SERVICE_ROLE_KEY` が要る。

### 検証

- Web `npm run typecheck` 成功 / `npm run lint` 0エラー・29警告（監査時と同数）
- Web `npm run build` 成功（`/api/geocode` を含む11ルート）
- Mobile `npm run typecheck` 成功
- `npm run check:regions` 成功（CI に追加済み）

## 修正対象サマリ

1. Web 登録 metadata を最新 DB トリガー契約へ統一する。
2. Web の posts/likes カウンタ手動更新を削除し、DB トリガーへ一本化する。
3. Web 投稿にも prefecture/city/area を保存する。
4. `supabase/schema.sql` を現行 migrations と同期し、新規 DB 構築経路を一本化する。
5. Web/Mobile の投稿・画像保存に publish 手順、再開、補償削除を導入する。
6. Web の post_images エラーを検査する。
7. Mobile 投稿完了画面のプロフィール再取得失敗を表示・再試行可能にする。
8. CloudTransition の reject・アンマウント cleanup を実装する。
9. Web 画像プレビューの Blob URL を解放する。

---

# 第2回 バグ監査（2026-08-29）

## 監査の進め方

Claude がコードを読んで候補を挙げ、再現テスト（`npm run test:review` /
`scripts/test-review-cases.mjs`）を書き、Codex に1件ずつ裏取りさせた。
Codex は候補15件のうち **CONFIRMED 13 / REFUTED 1 / UNCERTAIN 1** と判定し、
さらに候補に無かった重大バグ2件（P・Q）を見つけた。
そのあと修正パッチ自体も Codex に2回レビューさせ、指摘を反映してある。

- 監査開始時 HEAD: `ab9bc86` / `git status --short` は空（clean）
- 静的チェックは監査時点で全て成功していた。今回の問題は構文ではなく、
  **権限・状態遷移・エラー処理**に寄っている。

## 直したもの（致命的と判断した8件）

| # | 内容 | 深刻度 | 主な変更 |
|---|---|---|---|
| Q | Storage のアップロードが自分のフォルダに限られていない | **重大（セキュリティ）** | `0014` `schema.sql` |
| P | 月間ランキングがブロックを迂回して相手を見せる | **重大（1.2）** | `0014` |
| G | 退会しても写真の実体が公開バケットに残る | **重大（5.1.1(v)）** | `storageCleanup.ts` `useAuth.tsx` `settings/index.tsx` |
| E | 承認待ちのフォローが「地図に出せる人数」の枠を食う | **重大（主要機能）** | `0014` |
| A/O | PostgREST の `.or()` を素の文字列連結で組んでいる | 高 | `filters.ts` `search.tsx` `(tabs)/index.tsx` |
| G2 | 投稿完了画面が、取得に失敗しても古い数字を成果として出す | 高 | `useAuth.tsx` `post/done.tsx` |
| F | 通報の送信が失敗しても画面に何も出ない | 中（1.2） | `ReportDialog.tsx` |
| B | 「レイプ」が禁止語に入っていない（例外語だけがあった） | 中（1.2） | `moderation.ts` `0012` |

### Q. Storage のアップロードが自分のフォルダに限られていない

- 該当: `supabase/schema.sql:173`（旧）, `mobile/app/post/new.tsx:198`, `mobile/app/settings/edit-profile.tsx:112`
- 症状: ログインさえしていれば、誰でも `post-images` / `avatars` の**任意のパス**に
  任意のファイルを置ける。両バケットは public なので、投稿にも通報にも
  モデレーションにも乗らない公開ファイル置き場として使える。
  DELETE ポリシーだけは先頭フォルダを見ているため、他人のUIDの下に置いたものは
  置いた本人にも消せない。
- 原因: アプリ側は「先頭フォルダ = 自分のUID を要求する」前提でパスを組み、
  コメントにもそう書いてあったが、INSERT ポリシーは
  「ログイン済み かつ 対象バケット」しか見ていなかった。
  移行 0001〜0013 のどこでも貼り直していない。
- 対応: `0014` で INSERT を `auth.uid()::text = (storage.foldername(name))[1]` に限定。
  upsert のために UPDATE ポリシーも同じ条件で新設（従来 UPDATE は1本も無かった）。

### P. 月間ランキングがブロックを迂回する

- 該当: `supabase/migrations/0009_premium_gates.sql:83`, `mobile/app/ranking.tsx:43`
- 症状: ブロックした相手が上位3人か自分の行に該当すると、
  アカウント名・ユーザーID・アイコンがランキングに出る。
  ブロックの説明文「お互いの投稿とプロフィールが見えなくなります」と食い違う。
- 原因: `monthly_ranking()` は順位を出すために `SECURITY DEFINER` で
  profiles を直接 JOIN する。そのため profiles の RLS（ブロック相手を隠す）を通らない。
- 対応: `0014` で、定義者権限の中に `NOT has_block_with(b.user_id)` を自分で書いた。
  順位と `total_entrants` は絞る前の値のままにしてある
  （見る人によって順位が変わると、同じ月の同じ人の順位が信用できなくなる）。

### G. 退会しても写真が残る

- 該当: `supabase/migrations/0001_accounts_privacy_regions.sql:472`, `mobile/app/settings/index.tsx:56`
- 症状: `delete_my_account()` は `auth.users` を消すだけ。DBの行は連鎖して消えるが、
  Storage のオブジェクトは残る。バケットは public なので、URL を控えていれば
  退会後もその写真が開ける。画面の「写真を含むすべてのデータが削除されます」が嘘になる。
- 対応: SQL からは実体を消せないので、**退会の直前に端末から消す**
  （`mobile/src/lib/storageCleanup.ts`）。
  順番が命で、先にアカウントを消すとトークンが無効になり二度と消せない。
  消せなかったときは `PHOTO_CLEANUP_FAILED` で一度止め、
  本人に伝えたうえで「やめる / 写真を残して削除」を選ばせる
  （消せないから退会できない、では 5.1.1(v) を満たさないため）。

### E. 承認待ちのフォローが地図の枠を食う

- 該当: `supabase/migrations/0013_map_audience_gate.sql:122,174`（旧）
- 症状: 非公開アカウントにフォロー申請を2件出すと、承認されていないのに
  地図の枠が埋まる。その後に公開アカウントをフォローしても地図に出ず、
  引き出しは「0人 / 2人」と出しているのに、出そうとすると
  「地図に出せるのは2人までです」で弾かれる。
- 原因: 枠を数えている4か所のうち `my_map_quota()` と `map_pins()` は
  `status = 'accepted'` で絞るが、`set_follow_on_map_default()` と
  `set_map_visible()` は絞っていなかった。
  非公開宛のフォローは `force_follow_status()` で pending になるが、
  同じ BEFORE INSERT のトリガーは名前順に走るため
  （`trg_force_follow_status` → `trg_set_follow_on_map`）、
  pending 化したあとに `on_map = true` が付いていた。
- 対応: `0014` で数える側を `accepted` に揃え、pending は `on_map = false` で入れる。
  承認された瞬間に数え直す BEFORE UPDATE トリガー
  `trg_set_follow_on_map_accept` を足した。既存の pending 行も落とす。
- 残っている制約: 複数端末から同時に承認すると、BEFORE トリガーが
  コマンド開始時のスナップショットを見るため、一時的に枠を超えうる。
  ただし `map_pins()` の最終 `LIMIT free_map_users()` が最後に絞るので、
  地図の見え方は崩れない（`my_map_quota()` の数字だけが一時的にずれる）。

## 直したもの（致命的ではないが、依頼を受けて対応した9件）

| # | 内容 | 深刻度 | 主な変更 |
|---|---|---|---|
| H | `ProfileView` が通信エラーでも「このアカウントは表示できません」を出す／`notFound` が戻らない | 中 | `ProfileView.tsx` |
| J | `isUsernameAvailable` がエラー時に false を返し「既に使われています」と誤表示する | 中 | `useAuth.tsx` `sign-up.tsx` `edit-profile.tsx` |
| D | 投稿画像の縮小が「長辺1600px」になっていない（縦長は2133pxのまま） | 低 | `post/new.tsx` |
| C | `openDirections` が値の空な `&destination_place_id=` を付ける | 低 | `maps.ts` |
| K | 投稿詳細が、他画面から戻るたびに全画面ローディングになる | 低 | `post/[id].tsx` |
| M | アイコンを変えるたび、古い画像が Storage に残る | 低 | `edit-profile.tsx` |
| L | 非公開→公開のときの pending 一括承認のエラーを握りつぶす | 低 | `settings/index.tsx` |
| — | `check:moderation` / `test:moderation` / `test:review` が CI に入っていない | 低 | `.github/workflows/ci.yml`（build ジョブを Node 24 へ） |
| — | `schema.sql` のヘッダが「適用手順の 1/6」「0001〜0005」のまま古い | 低 | `schema.sql` |

補足:

- **J** は `'free' | 'taken' | 'unknown'` の3値にした。`unknown`（確かめられなかった）
  では登録も保存も止めない。空いていなければ `handle_new_user()`（0005）の
  INSERT が `profiles_username_key` で落ち、サインアップごと失敗する
  （＝勝手に別のIDが割り当てられることはない。0001 版にあった衝突時の
  採番し直しループは、0005 で置き換えたときに外れている）。
  ただし Supabase はトリガーの失敗を
  `Database error saving new user` の一文にまとめて返し、制約名までは降りてこない。
  `toJapaneseAuthError` にこの一文の対応を足した。
- **K** は真偽値ではなく「いま出している投稿ID」で持つ。真偽値だと、別の投稿へ
  移ったときに前の店の写真と本文が出たままになる。あわせて取得に世代の見張り
  （`seq`）を入れ、遅れて返った前の取得が新しい投稿を上書きしないようにした。
- **D** は縮める必要が無ければ `resize` を渡さない。決め打ちで `width: 1600` を
  渡すと、小さい写真やサイズが読めない写真を引き伸ばしてしまう。
- **H** は「中身を出している最中の更新失敗」ではエラー画面に切り替えない。
  引っ張って更新しただけで前の内容が消えるほうが困るため。
  中身が無いまま失敗したときだけ、再読み込みできる画面を出す。
- **M** は「保存が通ってから前のアイコンを消す」順にしてある。先に消すと、
  保存に失敗したときにアイコンだけ消える。
- **CI** は build ジョブだけ Node 24 に上げた。テストが `.ts` を
  そのまま import している（写しではなく本物の実装を呼ぶため）。
  mobile ジョブは Expo の都合があるので 22 のまま触っていない。

## 未対応

無し。`npm run test:review` は 37 passed / 0 failed / 0 open。

## 検証

- `npm run test:review` … 37 passed / 0 failed / 0 open
- Web `npx tsc --noEmit` 成功 / Mobile `npx tsc --noEmit` 成功
- `npm run check:sql` 成功（0014 を含む）
- `npm run check:moderation` 成功 / `npm run test:moderation` 64件成功
- `npm run check:regions` 成功 / `npm run check:seed` 成功
- Web `npm run lint` 0エラー・29警告（監査時と同数）

## 適用手順

**`0014` を公開前に必ず流すこと。** これを流すまで Storage は開いたまま。
**`0012` は流し直すこと。** 禁止語を足したため（冪等）。

---

## 追加（2026-08-30）: 地図を開いたときに現在地へ寄らないことがある

配信後に報告を受けて調べた。原因は独立した2つ。

### 1. 地図が組み上がる前にカメラを動かしていた

- 該当: `mobile/app/(tabs)/index.tsx`（`flyTo` / 起動時の `useEffect`）
- 症状: アプリを開いても日本全体が映ったまま。もう一度開くと直ることもある。
- 原因: iOS の `animateToRegion` は、地図がまだ組み上がっていないうちに
  呼んでも**何も起きずに黙って捨てられる**（エラーも出ない）。
  起動直後の寄せは端末が覚えている位置（`lastKnown`）を使うのでほぼ即座に返り、
  地図が組み上がるより先に呼んでいた。その1回が丸ごと消えていた。
  そのあとの実測（`locate`）が返れば結果的に寄るので、
  「寄るときと寄らないときがある」という出方になる。
- 修正: `onMapReady` を足し、準備できるまでは行き先を持っておいて
  できた瞬間に動かす。`onMapReady` の中で即座に動かすと iOS では
  取りこぼすことがあるので、1フレーム待ってから動かす。

### 2. 実測に時間制限が無かった

- 該当: `mobile/src/hooks/useLocation.ts`
- 症状: 地下や屋内で「現在地に戻る」を押すと、くるくるが回りっぱなしになる。
  起動時の寄せも来ない。
- 原因: `getCurrentPositionAsync` には時間制限が無い。要求した精度
  （`Accuracy.High`）に届かないまま、いつまでも返ってこないことがある。
- 修正: 10秒で打ち切り、端末が覚えている位置（30分以内のもの）に落とす。
  それも無ければ、`recenter` が「現在地を取れませんでした」と伝える。
  以前は権限を断られたときしか何も言わず、押しても無反応に見えていた。

検証: Mobile `npx tsc --noEmit` 成功 / `npm run test:review` 37 passed。
