# 開発ルール（共同開発ガイド）

MeshiMap の共同開発フローをまとめたドキュメントです。
**参加したらまずこのファイルを読んでください。**

---

## 1. ブランチ構成

```
main        ← 本番（Vercel Production / 実ユーザーが見る環境）
  ↑ PR（リリース時のみ）
develop     ← テスト（Vercel Preview / 動作確認用の統合環境）
  ↑ PR（日常の開発はすべてここへ）
feature/*   ← 各人の作業ブランチ（ローカル）
```

| ブランチ | 役割 | 直接 push | デプロイ先 |
|---|---|---|---|
| `main` | 本番。常にリリース可能な状態を保つ | 禁止（PR のみ） | 新 Vercel プロジェクトの Production |
| `develop` | テスト。次リリース候補の統合先 | 禁止（PR のみ） | 同 Preview |
| `feature/*` `fix/*` `chore/*` | 個人の作業用。使い捨て | 自由 | Preview（PR 作成時） |
| `hotfix/*` | 本番の緊急修正。`main` から切る | 自由 | Preview |

> **デプロイ先について（重要）**
> 旧 Vercel プロジェクト `shonaka-creates-projects/meshimap` へは**デプロイしません**。
> 別プロジェクトを新規作成してそちらに紐付けます。
> 旧プロジェクトが自動デプロイしないよう、Vercel ダッシュボードで
> **Settings → Git → Disconnect**（または Ignored Build Step に `exit 0`）を設定してください。

> **現在の運用フェーズ（2026-08 時点）**
> 立ち上げ期のため、オーナー（@shonaka-create）は当面 `main` へ直接 push します。
> 他のメンバーが参加した時点で、下記「9. 共同開発を開始するときの設定」を実行し、
> `main` / `develop` を保護して PR 必須運用へ切り替えます。

---

## 2. ブランチ命名規則

```
feature/<内容>     新機能        例: feature/post-comment
fix/<内容>         バグ修正      例: fix/like-count-mismatch
hotfix/<内容>      本番緊急修正  例: hotfix/login-500
chore/<内容>       雑務・設定    例: chore/update-deps
docs/<内容>        ドキュメント  例: docs/setup-guide
```

- 日本語は使わない（英小文字 + ハイフン）
- 複数人が同じ領域を触るときは `feature/<名前>-<内容>`（例: `feature/tanaka-map-filter`）にすると衝突が分かりやすい

---

## 3. 日常の開発フロー

```bash
# 1) 最新の develop を取得
git checkout develop
git pull origin develop

# 2) 作業ブランチを切る（必ず develop から）
git checkout -b feature/post-comment

# 3) 開発 → コミット（こまめに）
npm run dev
git add .
git commit -m "feat: 投稿へのコメント機能を追加"

# 4) push
git push -u origin feature/post-comment

# 5) GitHub で develop 宛の PR を作成
gh pr create --base develop --fill
```

PR がマージされたら作業ブランチは削除します（GitHub の「Delete branch」ボタン）。

```bash
# ローカルの後片付け
git checkout develop
git pull origin develop
git branch -d feature/post-comment
```

### コンフリクトを避けるコツ

- 作業ブランチは**長生きさせない**（目安 2〜3 日、遅くとも 1 週間以内に PR）
- 作業が長引くときは、こまめに develop を取り込む
  ```bash
  git checkout feature/xxx
  git fetch origin
  git merge origin/develop   # または git rebase origin/develop
  ```
- 着手前に「今どこを触るか」を共有する（同じファイルの同時編集を避ける）

---

## 4. コミットメッセージ規約

[Conventional Commits](https://www.conventionalcommits.org/ja/v1.0.0/) 形式。本文は日本語で OK。

```
<type>: <変更内容>

feat:     新機能
fix:      バグ修正
refactor: 挙動を変えないコード改善
style:    見た目・CSS のみ
perf:     パフォーマンス改善
chore:    ビルド・設定・依存関係
docs:     ドキュメント
security: セキュリティ対応
```

例:
```
feat: 地図に営業時間フィルタを追加
fix: いいね数が反映されない問題を修正
```

---

## 5. プルリクエスト（PR）のルール

- **base ブランチを必ず確認**（日常は `develop`、リリース時のみ `main`）
- タイトルはコミットメッセージ規約に合わせる
- テンプレート（`.github/pull_request_template.md`）の項目を埋める
- **UI 変更はスクリーンショットを必ず添付**（Before / After）
- CI（lint + 型チェック）が green であること
- レビュー 1 名以上の approve でマージ
- 1 PR はできるだけ小さく（レビューしやすさ最優先。目安 400 行以内）

### マージ方法

| PR | マージ方法 | 理由 |
|---|---|---|
| `feature/*` → `develop` | **Squash and merge** | develop の履歴を 1 機能 1 コミットに保つ |
| `develop` → `main` | **Create a merge commit** | リリース単位の履歴を残す |
| `hotfix/*` → `main` | Squash and merge | 緊急修正を 1 コミットで |

---

## 6. リリース手順（develop → main）

```bash
# 1) develop が最新でテスト済みであることを確認
git checkout develop && git pull origin develop

# 2) main 宛の PR を作成（リリース PR）
gh pr create --base main --head develop --title "release: YYYY-MM-DD" --body "今回の変更点..."

# 3) レビュー・Preview 環境で最終確認 → マージ
#    → Vercel Production へ自動デプロイ

# 4) タグを打つ（任意だが推奨）
git checkout main && git pull origin main
git tag -a v0.2.0 -m "リリース内容"
git push origin v0.2.0
```

---

## 7. 緊急修正（hotfix）

本番だけ壊れていて develop の内容をまだ出したくない場合:

```bash
git checkout main && git pull origin main
git checkout -b hotfix/login-500
# 修正 → commit → push
gh pr create --base main --fill
```

**マージ後は必ず develop にも取り込む**（取り込み忘れると次のリリースで修正が消えます）:

```bash
git checkout develop && git pull origin develop
git merge origin/main
git push origin develop
```

---

## 8. 環境変数・秘密情報

- **`.env.local` / `mobile/.env` は絶対にコミットしない**（`.gitignore` 済み）
- **このリポジトリは Public です。** API キー・トークン・個人情報を含むコードやコメントを書かないこと
- 変数を増やしたら `.env.example` にキー名だけ追記して PR に含める
- 実際の値は Slack / 1Password など Git 外で共有する
- Vercel 側の環境変数は Production / Preview / Development で個別に設定する
  （新プロジェクト作成時に設定し直すこと。旧プロジェクトの値は流用されない）

### セットアップ

```bash
cp .env.example .env.local   # 値はオーナーから受け取って記入
npm install
npm run dev
```

モバイル（Expo）は `mobile/` 配下に独立した npm プロジェクトがあります。

```bash
cd mobile
npm install
npx expo start
```

### まだ決まっていないこと（共同開発開始前に決める）

- [ ] Supabase を本番用 / 検証用でプロジェクト分割するか（現状は 1 プロジェクト共有）
  - 分割しない場合、`develop` からのテストが本番データを壊すリスクがあるため注意
- [ ] `supabase/migrations/` の適用ルール（誰がいつ本番に流すか）
  - 暫定ルール: マイグレーションを含む PR は必ずレビュー必須、本番反映はオーナーが手動実行

---

## 9. 共同開発を開始するときの設定

メンバーが増えたタイミングでオーナーが以下を実行します（実行するまでは `main` へ直 push 可能）。

```bash
# main を保護（PR 必須・レビュー 1 名・CI 必須・直 push 禁止）
gh api -X PUT repos/shonaka-create/meshimap/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -F "required_status_checks[strict]=true" \
  -f "required_status_checks[contexts][]=build" \
  -F "enforce_admins=true" \
  -F "required_pull_request_reviews[required_approving_review_count]=1" \
  -F "restrictions=null" \
  -F "allow_force_pushes=false" \
  -F "allow_deletions=false"

# develop を保護（PR 必須・CI 必須。レビューは任意）
gh api -X PUT repos/shonaka-create/meshimap/branches/develop/protection \
  -H "Accept: application/vnd.github+json" \
  -F "required_status_checks[strict]=true" \
  -f "required_status_checks[contexts][]=build" \
  -F "enforce_admins=false" \
  -F "required_pull_request_reviews[required_approving_review_count]=0" \
  -F "restrictions=null" \
  -F "allow_force_pushes=false" \
  -F "allow_deletions=false"

# PR のデフォルト向き先を develop にする（誤って main 宛の PR を作る事故を防ぐ）
gh repo edit shonaka-create/meshimap --default-branch develop

# マージ済みブランチを自動削除
gh repo edit shonaka-create/meshimap --delete-branch-on-merge

# メンバーを招待
gh api -X PUT repos/shonaka-create/meshimap/collaborators/<GitHubユーザー名> -f permission=push
```

保護を一時的に外したい場合:
```bash
gh api -X DELETE repos/shonaka-create/meshimap/branches/main/protection
```

---

## 10. やってはいけないこと

- `main` / `develop` への `git push --force`
- `.env*` のコミット
- 他人の作業ブランチへの force push
- レビューなしでの `main` マージ（保護有効化後）
- `node_modules` や `.next` のコミット
