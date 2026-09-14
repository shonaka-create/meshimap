-- ============================================================
-- MeshiMap 移行 0020
--   地域バブルの代表写真・人ごとの地図・マイページのヘッダー写真
--
-- ここでやること:
--   1. profiles.header_url … ヘッダー写真の URL を持つ
--   2. post_counts_by_region() … 代表写真を返し、人でも絞れるようにする
--   3. posts_in_area() … 同じ人の条件で投稿を返す
--
-- ★ 人を指定しても map_visible_users() の条件を外さないこと。
--   外すと、地図に出していない人の UUID を渡すだけで投稿を覗ける。
--
-- ★ SECURITY DEFINER にしないこと。
--   SECURITY INVOKER のまま RLS を効かせ、非公開の投稿を守る。
--
-- Supabase SQL Editor に貼り付けて実行。冪等。
-- ============================================================

BEGIN;

-- 前提の確認。番号を飛ばすと素の PostgreSQL のエラーになり、
-- どれを流し直せばよいか分からなくなる。
DO $$
BEGIN
  IF to_regprocedure('public.map_visible_users()') IS NULL THEN
    RAISE EXCEPTION '移行 0019 が未適用です。先に 0019_map_shows_only_your_people.sql を実行してください。'
      USING HINT = 'supabase/check_state.sql で適用状況を一覧できます。';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'posts'
       AND column_name = 'impressions_count'
  ) THEN
    RAISE EXCEPTION '移行 0008 が未適用です。先に 0008_impressions_featured_monthly.sql を実行してください。'
      USING HINT = 'supabase/check_state.sql で適用状況を一覧できます。';
  END IF;
END $$;


-- ============================================================
-- 1. マイページのヘッダー写真
--
--    画像は avatars バケットの `${uid}/header_*.jpg` に置く。
--    0014 のポリシーは先頭フォルダ = 自分のUID なので、そのまま通る。
--    退会時も UID のフォルダごと消すため、ヘッダー写真は残らない。
--
--    ★ UID のフォルダの外に置かないこと。
--      Storage のポリシーで弾かれ、退会時の後片付けの対象からも外れる。
-- ============================================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS header_url TEXT;


-- ============================================================
-- 2. 地域ごとの投稿数と代表写真（バブル）
--
--    ★ 旧シグネチャを残さないこと。
--      戻り値の列は CREATE OR REPLACE では増やせない。
--      引数違いを残すと、PostgREST が呼び出す関数を決められなくなる。
--      新シグネチャは CREATE OR REPLACE にして、再実行にも対応する。
--
--    ★ 写真がない投稿を集計から落とさないこと。
--      投稿数と中心座標は全件で求め、代表写真だけを別に選ぶ。
-- ============================================================
DROP FUNCTION IF EXISTS public.post_counts_by_region(TEXT, TEXT, TEXT);

-- ★ 0002 の2引数版 (p_level, p_prefecture) もここで消すこと。
--   0017 以降は3引数版を足しただけで、2引数版は残り続けていた。
--   中にフォローの絞り込み（0019）が入っていないので、
--   PostgREST を直接叩けば「地図に出していない人の投稿数」を数えられる抜け道になる。
--   アプリは常に p_genre まで渡しているので、2引数版は呼ばれていない。
--   また残っていると post_counts_by_region('prefecture') のような呼び出しが
--   新しい版と区別できず「function is not unique」で落ちる。
DROP FUNCTION IF EXISTS public.post_counts_by_region(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.post_counts_by_region(
  p_level      TEXT,                 -- 'prefecture' | 'area'
  p_prefecture TEXT DEFAULT NULL,
  p_genre      TEXT DEFAULT NULL,
  p_user       UUID DEFAULT NULL     -- NULL なら人では絞らない
)
RETURNS TABLE (
  name          TEXT,
  post_count    BIGINT,
  center_lat    DOUBLE PRECISION,
  center_lng    DOUBLE PRECISION,
  cover_url     TEXT,
  cover_post_id UUID
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH visible_posts AS (
    SELECT p.id, p.impressions_count, p.created_at,
           p.location_lat, p.location_lng,
           CASE p_level
             WHEN 'prefecture' THEN p.prefecture
             ELSE COALESCE(p.area, p.city)
           END AS name
      FROM posts p
     WHERE p.user_id IN (SELECT mv.user_id FROM public.map_visible_users() mv)
       AND (p_prefecture IS NULL OR p.prefecture = p_prefecture)
       AND (p_genre IS NULL OR p.genre = p_genre)
       AND (p_user IS NULL OR p.user_id = p_user)
       AND CASE p_level
             WHEN 'prefecture' THEN p.prefecture
             ELSE COALESCE(p.area, p.city)
           END IS NOT NULL
  ), region_counts AS (
    SELECT p.name,
           COUNT(*)            AS post_count,
           AVG(p.location_lat) AS center_lat,
           AVG(p.location_lng) AS center_lng
      FROM visible_posts p
     GROUP BY p.name
  ), region_covers AS (
    -- 空でない URL のうち position が先頭の写真を、投稿ごとに1枚だけ取る。
    -- 写真がない投稿はここだけから外れる。件数の集計には影響しない。
    SELECT DISTINCT ON (p.name)
           p.name, photo.url AS cover_url, p.id AS cover_post_id
      FROM visible_posts p
      JOIN LATERAL (
        SELECT pi.url
          FROM post_images pi
         WHERE pi.post_id = p.id
           AND NULLIF(BTRIM(pi.url), '') IS NOT NULL
         ORDER BY pi.position, pi.id
         LIMIT 1
      ) photo ON true
     ORDER BY p.name, COALESCE(p.impressions_count, 0) DESC,
              p.created_at DESC, p.id
  )
  SELECT r.name, r.post_count, r.center_lat, r.center_lng,
         c.cover_url, c.cover_post_id
    FROM region_counts r
    LEFT JOIN region_covers c ON c.name = r.name
   ORDER BY r.post_count DESC;
$$;


-- ============================================================
-- 3. エリアの中の投稿（投稿ピン）
--
--    0019 の内容に、人での絞り込みだけを足したもの。
--
--    ★ 返す JSON の形を変えないこと。
--      author と post_images を含む形を端末の toPost が使っている。
--
--    ★ エリアの判定を変えないこと。
--      バブル側と同じ COALESCE(area, city) でないと件数が食い違う。
-- ============================================================
DROP FUNCTION IF EXISTS public.posts_in_area(TEXT, TEXT, INT);

CREATE OR REPLACE FUNCTION public.posts_in_area(
  p_prefecture TEXT,
  p_area       TEXT,
  p_limit      INT DEFAULT 200,
  p_user       UUID DEFAULT NULL     -- NULL なら人では絞らない
)
RETURNS SETOF JSONB
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT to_jsonb(p)
         || jsonb_build_object(
              'author', to_jsonb(pr),
              'post_images', COALESCE(
                (SELECT jsonb_agg(
                          jsonb_build_object('url', pi.url, 'position', pi.position)
                          ORDER BY pi.position)
                   FROM post_images pi
                  WHERE pi.post_id = p.id),
                '[]'::jsonb)
            )
    FROM posts p
    JOIN profiles pr ON pr.id = p.user_id
   WHERE p.user_id IN (SELECT mv.user_id FROM public.map_visible_users() mv)
     AND p.prefecture = p_prefecture
     AND COALESCE(p.area, p.city) = p_area
     AND (p_user IS NULL OR p.user_id = p_user)
   ORDER BY p.created_at DESC
   LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.post_counts_by_region(TEXT, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.posts_in_area(TEXT, TEXT, INT, UUID) TO authenticated;

-- 引数と戻り値が変わったので、PostgREST にスキーマを読み直させる。
NOTIFY pgrst, 'reload schema';

COMMIT;


-- ── 確認 ──────────────────────────────────────────
-- SQL Editor では auth.uid() が NULL なので、ここでの結果は 0 行になる。
-- それが正しい（未ログインには何も出さない）。
-- 実際の代表写真と人での絞り込みはアプリから確認すること。

SELECT '地域の代表写真（SQL Editor では auth.uid() が NULL なので 0 行が正常）' AS "確認";
-- 引数は4つとも明示する。型を書かないと、古い版が残っていたときに曖昧で落ちる。
SELECT * FROM public.post_counts_by_region('prefecture'::TEXT, NULL::TEXT, NULL::TEXT, NULL::UUID) LIMIT 5;
