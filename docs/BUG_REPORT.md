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
