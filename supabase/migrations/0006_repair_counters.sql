-- ============================================================
-- 0006: カウンタの再集計
--
-- Web 版は 0001 でカウンタがトリガー化されたあとも、クライアント側で
-- 手動 UPDATE を続けていた。そのため Web から操作するたびに
--   ・1投稿で profiles.posts_count が 2 増える
--   ・1いいねで posts.likes_count が 2 増える（解除で 2 減る）
--   ・1コメントで posts.comments_count が 2 増える
-- という二重加算が起きていた。アプリ側の手動 UPDATE は削除済みなので、
-- ここで実データから数え直して辻褄を合わせる。
--
-- 実データ（likes / comments / posts / follows 行）は壊れていないため、
-- 数え直しだけで正しい値に戻る。何度実行しても同じ結果になる。
--
-- 既存の supabase/sync-counts.sql との違い:
--   follows.status（0001 で追加、承認制フォロー）を考慮する。
--   sync-counts.sql は status を見ないので、承認待ちのフォローまで
--   数えてしまう。こちらを使うこと。
-- ============================================================

BEGIN;

-- 投稿のいいね数
UPDATE posts p
SET likes_count = c.n
FROM (SELECT post_id, COUNT(*) AS n FROM likes GROUP BY post_id) c
WHERE c.post_id = p.id AND p.likes_count IS DISTINCT FROM c.n;

-- いいねが1件も無い投稿は上の UPDATE に現れないので、別途 0 に戻す
UPDATE posts p
SET likes_count = 0
WHERE p.likes_count <> 0
  AND NOT EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id);

-- 投稿のコメント数
UPDATE posts p
SET comments_count = c.n
FROM (SELECT post_id, COUNT(*) AS n FROM comments GROUP BY post_id) c
WHERE c.post_id = p.id AND p.comments_count IS DISTINCT FROM c.n;

UPDATE posts p
SET comments_count = 0
WHERE p.comments_count <> 0
  AND NOT EXISTS (SELECT 1 FROM comments cm WHERE cm.post_id = p.id);

-- プロフィールの投稿数
UPDATE profiles pr
SET posts_count = (SELECT COUNT(*) FROM posts p WHERE p.user_id = pr.id)
WHERE pr.posts_count IS DISTINCT FROM (SELECT COUNT(*) FROM posts p WHERE p.user_id = pr.id);

-- フォロー数。トリガー sync_follow_counts と同じく accepted だけを数える。
UPDATE profiles pr
SET followers_count = (
      SELECT COUNT(*) FROM follows f
      WHERE f.following_id = pr.id AND f.status = 'accepted'
    ),
    following_count = (
      SELECT COUNT(*) FROM follows f
      WHERE f.follower_id = pr.id AND f.status = 'accepted'
    );

-- 制覇エリア数。0004 の recount_areas と同じ定義で数え直す。
-- （地域列のバックフィル後にもう一度実行すると、その分が反映される）
UPDATE profiles pr
SET areas_count = (
  SELECT COUNT(DISTINCT COALESCE(p.area, p.city))
  FROM posts p
  WHERE p.user_id = pr.id AND COALESCE(p.area, p.city) IS NOT NULL
);

COMMIT;

-- 確認用。ズレが残っていないことを見る（0行なら OK）。
-- SELECT p.id, p.likes_count, (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS actual
-- FROM posts p
-- WHERE p.likes_count <> (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id);
