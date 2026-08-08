-- ============================================================
-- デモ用: 既存のアカウントと投稿を「公開」に切り替える
--
-- 【なぜ必要か】
-- 移行 0001 で is_public の既定値を「非公開」にしたため、
-- それ以前に作られたアカウント・投稿はすべて非公開になった。
-- RLS としては設計どおりだが、デプロイ中の Web 版には
-- 公開設定のUIが無いため、デモサイトが空に見えてしまう。
--
-- 【重要】
--   * これは一度きりの手作業用スクリプト。migrations/ には置かない。
--   * 実在ユーザーの非公開投稿まで公開してしまうため、
--     シード/デモデータしか入っていない段階でのみ実行すること。
--   * 実行後に作られる投稿は、引き続き既定で非公開のまま
--     （アプリ側で明示的に公開に切り替える設計）。
--
-- Supabase Dashboard > SQL Editor に貼り付けて実行。
-- ============================================================

BEGIN;

-- 実行前の状態を確認
SELECT 'before' AS phase,
       (SELECT COUNT(*) FROM profiles)                       AS profiles_total,
       (SELECT COUNT(*) FROM profiles WHERE is_public)       AS profiles_public,
       (SELECT COUNT(*) FROM posts)                          AS posts_total,
       (SELECT COUNT(*) FROM posts WHERE is_public)          AS posts_public;

UPDATE profiles SET is_public = true WHERE is_public = false;
UPDATE posts    SET is_public = true WHERE is_public = false;

-- 非公開アカウントに溜まっていた承認待ちのフォロー申請を、
-- 公開アカウントになった以上そのままにしておく意味がないので承認する。
UPDATE follows SET status = 'accepted' WHERE status = 'pending';

-- 実行後の状態を確認
SELECT 'after' AS phase,
       (SELECT COUNT(*) FROM profiles)                       AS profiles_total,
       (SELECT COUNT(*) FROM profiles WHERE is_public)       AS profiles_public,
       (SELECT COUNT(*) FROM posts)                          AS posts_total,
       (SELECT COUNT(*) FROM posts WHERE is_public)          AS posts_public;

COMMIT;
