-- ============================================================
-- MeshiMap 移行 0019
--   地図に出す投稿を「自分と、地図に出している人」だけに絞る
--
-- 背景:
--   アイコン（人のピン）は map_pins() が正しく絞っていた。
--   自分・運営・follows.on_map の人だけで、無料は2人まで（移行0013）。
--
--   ところが地域バブル（post_counts_by_region）と、エリアを開いた
--   ときの投稿一覧には、フォローの条件が一行も入っていなかった。
--   公開されている投稿は、誰のものでも数えられ、ピンとして出ていた。
--
--   実際、フォローしていない利用者の投稿が地図に出ていることを
--   確認した（@ebichan は @admin しかフォローしていないのに、
--   @kkobe の投稿が荻窪に出ていた）。
--
--   これは2つの意味で辻褄が合っていない:
--     ・App Review へ出した説明が
--       「自分か、フォローしている人が実際に行った店だけを出す」
--       になっている
--     ・課金の線が「地図に出せる人数」なのに、
--       投稿が誰の分でも出るなら、増やす理由が無い
--
-- ここでやること:
--   1. map_visible_users() … 地図に出してよい人の集合を1箇所で決める
--   2. post_counts_by_region() … その集合で絞る（バブル）
--   3. posts_in_area() … その集合で絞って投稿を返す（新設）
--
-- ★ 端末側で絞らないこと。
--   このアプリの決め事どおり、最後に止めるのは DB でやる
--   （禁止語・写真の枚数・Storage の置き場所と同じ考え方）。
--   端末側で filter すると、アプリを改造されるか
--   anon キーで PostgREST を直接叩かれた時点で素通りする。
--
-- ★ RLS はそのまま効いている（SECURITY INVOKER）。
--   非公開の投稿はこの関数を通しても見えない。二重の守りになる。
--
-- Supabase SQL Editor に貼り付けて実行。冪等。
-- ============================================================

BEGIN;

-- 前提の確認。番号を飛ばすと素の PostgreSQL のエラーになり、
-- どれを流し直せばよいか分からなくなる。
DO $$
BEGIN
  IF to_regprocedure('public.has_premium()') IS NULL THEN
    RAISE EXCEPTION '移行 0009 が未適用です。先に 0009_premium_gates.sql を実行してください。'
      USING HINT = 'supabase/check_state.sql で適用状況を一覧できます。';
  END IF;
  IF to_regprocedure('public.free_map_users()') IS NULL THEN
    RAISE EXCEPTION '移行 0013 が未適用です。先に 0013_map_audience_gate.sql を実行してください。'
      USING HINT = 'supabase/check_state.sql で適用状況を一覧できます。';
  END IF;
END $$;


-- ============================================================
-- 1. 地図に出してよい人
--
--    map_pins() が持っていた条件を、そのまま関数に切り出す。
--    バブル・投稿・アイコンの3箇所が同じ集合を見るようにして、
--    「アイコンは出ていないのに投稿だけ出ている」を無くす。
--
--    ★ 並び順と上限は map_pins() と揃えること。
--      古いフォローから順に、無料は free_map_users() 人まで。
--      ここがずれると、アイコンの出る人と投稿の出る人が食い違う。
-- ============================================================
CREATE OR REPLACE FUNCTION public.map_visible_users()
RETURNS TABLE (user_id UUID)
LANGUAGE sql STABLE AS $$
  -- 自分。常に出る
  SELECT auth.uid() WHERE auth.uid() IS NOT NULL

  UNION

  -- 運営。掲載枠なので常に出る。人数には数えない
  SELECT pr.id FROM profiles pr
   WHERE auth.uid() IS NOT NULL AND pr.is_admin

  UNION

  -- 地図に出しているフォロー先。無料は2人まで
  SELECT s.following_id FROM (
    SELECT f.following_id
      FROM follows f
      JOIN profiles pr ON pr.id = f.following_id
     WHERE f.follower_id = auth.uid()
       AND f.status = 'accepted'
       AND f.on_map
       AND NOT pr.is_admin
     ORDER BY f.created_at
     LIMIT CASE WHEN public.has_premium() THEN 1000 ELSE public.free_map_users() END
  ) s
$$;


-- ============================================================
-- 2. 地域ごとの投稿数（バブル）
--
--    0017 の内容に、上の集合での絞り込みだけを足したもの。
--    引数と戻り値は変えていないので、端末側の呼び出しはそのまま。
-- ============================================================
CREATE OR REPLACE FUNCTION public.post_counts_by_region(
  p_level      TEXT,                 -- 'prefecture' | 'area'
  p_prefecture TEXT DEFAULT NULL,
  p_genre      TEXT DEFAULT NULL     -- NULL なら絞らない
)
RETURNS TABLE (
  name       TEXT,
  post_count BIGINT,
  center_lat DOUBLE PRECISION,
  center_lng DOUBLE PRECISION
)
LANGUAGE sql STABLE AS $$
  SELECT
    CASE p_level
      WHEN 'prefecture' THEN p.prefecture
      ELSE COALESCE(p.area, p.city)
    END                    AS name,
    COUNT(*)               AS post_count,
    AVG(p.location_lat)    AS center_lat,
    AVG(p.location_lng)    AS center_lng
  FROM posts p
  WHERE p.user_id IN (SELECT mv.user_id FROM public.map_visible_users() mv)
    AND (p_prefecture IS NULL OR p.prefecture = p_prefecture)
    AND (p_genre IS NULL OR p.genre = p_genre)
    AND CASE p_level
          WHEN 'prefecture' THEN p.prefecture
          ELSE COALESCE(p.area, p.city)
        END IS NOT NULL
  GROUP BY 1
  ORDER BY 2 DESC;
$$;


-- ============================================================
-- 3. エリアの中の投稿（投稿ピン）
--
--    これまで端末が posts を直接引いていたところ。
--    絞り込みを端末に持たせないよう、関数にする。
--
--    ★ 端末が組み立てていた形（author と post_images を含む）を
--      そのまま返すこと。返す形を変えると lib/posts.ts の toPost が
--      使えなくなり、画面側に分岐が増える。
--
--    ★ エリアの判定は COALESCE(area, city)。
--      バブル側の GROUP BY と同じ式にすること。違う式にすると
--      「バブルには3件と出ているのに、開くと2件しかない」になる。
-- ============================================================
CREATE OR REPLACE FUNCTION public.posts_in_area(
  p_prefecture TEXT,
  p_area       TEXT,
  p_limit      INT DEFAULT 200
)
RETURNS SETOF JSONB
LANGUAGE sql STABLE AS $$
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
   ORDER BY p.created_at DESC
   LIMIT p_limit;
$$;

COMMIT;


-- ── 確認 ──────────────────────────────────────────
-- ログインした状態の SQL Editor では auth.uid() が NULL なので、
-- ここでの結果は 0 行になる。それが正しい（未ログインには何も出さない）。
-- 実際の絞り込みはアプリから確認すること。

SELECT '地図に出してよい人（SQL Editor では auth.uid() が NULL なので 0 行が正常）' AS "確認";
SELECT * FROM public.map_visible_users();
