-- ============================================================
-- カウンター同期 SQL
-- シードデータ投入後に Supabase SQL Editor で実行してください
-- ============================================================

-- posts.likes_count を likes テーブルから再集計
UPDATE posts p
SET likes_count = (
  SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id
);

-- posts.comments_count を comments テーブルから再集計
UPDATE posts p
SET comments_count = (
  SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id
);

-- profiles.posts_count を posts テーブルから再集計
UPDATE profiles pr
SET posts_count = (
  SELECT COUNT(*) FROM posts p WHERE p.user_id = pr.id
);

-- profiles.followers_count を follows テーブルから再集計
UPDATE profiles pr
SET followers_count = (
  SELECT COUNT(*) FROM follows f WHERE f.following_id = pr.id
);

-- profiles.following_count を follows テーブルから再集計
UPDATE profiles pr
SET following_count = (
  SELECT COUNT(*) FROM follows f WHERE f.follower_id = pr.id
);

-- 確認クエリ
SELECT id, display_name, posts_count, followers_count, following_count
FROM profiles
ORDER BY posts_count DESC;
