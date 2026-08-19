-- ============================================================
-- MeshiMap 移行 0011
--   「今日どこ行く？」— 条件から店を提案する RPC
--
-- 背景:
--   検索は「名前を知っているものを探す」画面で、行き先が決まっていない人には
--   使えない。posts.situations（デート・女子会・一人ランチ など）は移行0002 で
--   入れて投稿時に入力させているのに、絞り込む手段が無く死んでいた。
--   ここでその軸を主役にする。
--
-- 方針:
--   1. 採点はDBでやる。端末に全件持ってきて並べ替えると、
--      通信量が候補数に比例するうえ、順番の理由を端末ごとに変えられてしまう。
--   2. SECURITY DEFINER にしない（＝ INVOKER）。
--      posts の RLS（can_view_post）がそのまま効くので、
--      非公開アカウント・非公開投稿・ブロック相手が候補に入らない。
--      ここを DEFINER にすると、その3つを自前で書き直すことになり、
--      いつか必ずどれかを書き漏らす。
--   3. 返すのは「投稿」ではなく「店」。同じ店に3人が行っていれば1行にまとめる。
--      提案は店を選ぶ行為なので、同じ店が並ぶと選択肢が減って見える。
--
-- Supabase SQL Editor に貼り付けて実行。冪等。
-- ============================================================

BEGIN;

-- ============================================================
-- 前提の確認
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'situations'
  ) THEN
    RAISE EXCEPTION '移行 0002 が未適用です。先に 0002_areas_and_situations.sql を実行してください。'
      USING HINT = 'supabase/check_state.sql を実行すると、どこまで適用済みかを一覧で確認できます。';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'impressions_count'
  ) THEN
    RAISE EXCEPTION '移行 0008 が未適用です。先に 0008_impressions_featured_monthly.sql を実行してください。'
      USING HINT = 'supabase/check_state.sql を実行すると、どこまで適用済みかを一覧で確認できます。';
  END IF;
END $$;


-- ============================================================
-- 0. 採点の重み
--
--    しきい値や重みを式に直接埋めると、あとから「なぜこの順番なのか」を
--    説明できなくなる。関数にしておけば、画面に出す説明文と
--    実際の計算が同じ数字を指していることを確認できる。
--
--    ★ mobile/src/lib/recommend.ts の SCORE_WEIGHTS と揃えること。
--      端末側は表示のためだけに持っている。順番を決めるのは常にここ。
--
--    各成分は 0〜1 に正規化してから重みを掛ける。
--    正規化しないと、インプレッション（数千のオーダー）だけで
--    順番が決まり、評価や場面が効かなくなる。
-- ============================================================

CREATE OR REPLACE FUNCTION public.recommend_weights()
RETURNS TABLE (
  w_situation DOUBLE PRECISION,  -- 選んだ場面にどれだけ合っているか
  w_rating    DOUBLE PRECISION,  -- 平均評価
  w_reach     DOUBLE PRECISION,  -- 何人に届いた投稿か（インプレッション）
  w_crowd     DOUBLE PRECISION,  -- 何人が実際に行っているか
  w_near      DOUBLE PRECISION,  -- 近さ（現在地を渡したときだけ効く）
  w_fresh     DOUBLE PRECISION,  -- 情報の新しさ
  w_follow    DOUBLE PRECISION,  -- フォローしている人が行っているか
  w_featured  DOUBLE PRECISION,  -- いま注目に入っているか
  w_demo      DOUBLE PRECISION   -- デモアカウントだけの店は下げる（負の重み）
)
LANGUAGE sql IMMUTABLE AS $$
  SELECT 3.0, 1.6, 1.2, 0.8, 1.4, 0.5, 0.7, 0.4, -0.8;
$$;

-- 正規化の基準値。
--   reach: 1000人に届いていれば満点扱い。
--          これ以上は伸びても順番を動かさない（バズだけで埋まるのを防ぐ）。
--   crowd: 8人が行っていれば満点扱い。
--   fresh: 1年経った投稿は新しさの加点がゼロになる。
CREATE OR REPLACE FUNCTION public.recommend_scales()
RETURNS TABLE (
  reach_full  DOUBLE PRECISION,
  crowd_full  DOUBLE PRECISION,
  fresh_days  DOUBLE PRECISION,
  -- 現在地は渡されたが半径が指定されなかったときの、近さの基準（km）
  near_default_km DOUBLE PRECISION
)
LANGUAGE sql IMMUTABLE AS $$
  SELECT 1000.0, 8.0, 365.0, 5.0;
$$;


-- ============================================================
-- 1. 提案本体
--
--    引数はすべて省略可。何も渡さなければ
--    「自分に見えるすべての店を、評価と届いた人数で並べたもの」になる。
--
--    p_scope:
--      'all'       … 自分に見えるすべて（公開アカウント＋フォロー中＋運営）
--      'following' … フォロー中の人が行った店だけ
--    ※ どちらでも RLS より広くはならない。'all' は絞り込みを外すだけ。
--
--    自分の投稿は候補に入れない。自分が行った店を自分に薦めても意味がない。
--    ただし p_exclude_visited の判定には使う。
-- ============================================================

DROP FUNCTION IF EXISTS public.recommend_spots(
  TEXT[], TEXT[], TEXT[], TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT, TEXT, BOOLEAN, INT
);

CREATE OR REPLACE FUNCTION public.recommend_spots(
  p_situations      TEXT[]           DEFAULT '{}',
  p_genres          TEXT[]           DEFAULT '{}',
  p_prices          TEXT[]           DEFAULT '{}',
  p_scope           TEXT             DEFAULT 'all',
  p_lat             DOUBLE PRECISION DEFAULT NULL,
  p_lng             DOUBLE PRECISION DEFAULT NULL,
  p_radius_km       DOUBLE PRECISION DEFAULT NULL,
  p_prefecture      TEXT             DEFAULT NULL,
  p_area            TEXT             DEFAULT NULL,
  p_exclude_visited BOOLEAN          DEFAULT TRUE,
  p_limit           INT              DEFAULT 20
)
RETURNS TABLE (
  -- 代表として見せる投稿。写真とキャプションはこれを使う
  post_id            UUID,
  location_name      TEXT,
  prefecture         TEXT,
  area               TEXT,
  location_lat       DOUBLE PRECISION,
  location_lng       DOUBLE PRECISION,
  genre              TEXT,
  price_range        TEXT,
  image_url          TEXT,
  author_username    TEXT,
  author_name        TEXT,
  -- 順番の理由として画面に出せる材料
  avg_rating         NUMERIC,
  visitors           INT,
  following_visitors INT,
  impressions        INT,
  is_featured        BOOLEAN,
  has_demo           BOOLEAN,
  posts_count        INT,
  last_posted_at     TIMESTAMPTZ,
  distance_km        DOUBLE PRECISION,
  matched_situations TEXT[],
  score              NUMERIC
)
LANGUAGE sql STABLE AS $$
WITH
-- 承認済みのフォロー先。'following' の絞り込みと、加点の判定に使う
followed AS (
  SELECT f.following_id AS uid
  FROM follows f
  WHERE f.follower_id = auth.uid()
    AND f.status = 'accepted'
),

-- 自分が既に投稿した店。「行ったことない店だけ」の除外に使う
visited AS (
  SELECT DISTINCT p.location_name
  FROM posts p
  WHERE p.user_id = auth.uid()
),

-- 条件に合う投稿。ここに出てくる時点で RLS を通っている
candidate AS (
  SELECT
    p.id,
    p.user_id,
    p.location_name,
    -- 同名チェーンを別の街でまとめないための、店名に添える地名
    COALESCE(p.area, p.city, p.prefecture) AS place,
    p.prefecture,
    p.area,
    p.city,
    p.location_lat,
    p.location_lng,
    p.genre,
    p.price_range,
    p.rating,
    p.impressions_count,
    p.featured_at,
    p.created_at,
    p.situations,
    pr.is_demo,
    pr.username     AS author_username,
    pr.display_name AS author_name,
    -- 選んだ場面のうち、この投稿が満たしているもの
    ARRAY(
      SELECT UNNEST(p.situations)
      INTERSECT
      SELECT UNNEST(COALESCE(p_situations, '{}'::TEXT[]))
    ) AS matched,
    -- 現在地からの距離(km)。0007 のバックフィルと同じハーバサイン
    CASE
      WHEN p_lat IS NULL OR p_lng IS NULL THEN NULL
      ELSE 2 * 6371 * asin(sqrt(
        power(sin(radians(p.location_lat - p_lat) / 2), 2) +
        cos(radians(p_lat)) * cos(radians(p.location_lat)) *
        power(sin(radians(p.location_lng - p_lng) / 2), 2)
      ))
    END AS distance_km
  FROM posts p
  JOIN profiles pr ON pr.id = p.user_id
  WHERE p.user_id <> auth.uid()
    AND (p_scope <> 'following' OR p.user_id IN (SELECT uid FROM followed))
    AND (COALESCE(array_length(p_situations, 1), 0) = 0 OR p.situations && p_situations)
    AND (COALESCE(array_length(p_genres, 1), 0)     = 0 OR p.genre       = ANY(p_genres))
    AND (COALESCE(array_length(p_prices, 1), 0)     = 0 OR p.price_range = ANY(p_prices))
    AND (p_prefecture IS NULL OR p.prefecture = p_prefecture)
    AND (p_area       IS NULL OR COALESCE(p.area, p.city) = p_area)
    -- ★ 列は必ず別名で修飾する。RETURNS TABLE の列名（location_name など）は
    --   関数本体でも名前として見えるため、裸で書くとどちらを指すのか読めなくなる。
    AND (NOT p_exclude_visited OR p.location_name NOT IN (SELECT v.location_name FROM visited v))
),

-- 半径の絞り込み。距離は candidate で計算済みなので、ここで一度だけ見る
near AS (
  SELECT * FROM candidate c
  WHERE p_radius_km IS NULL
     OR c.distance_km IS NULL
     OR c.distance_km <= p_radius_km
),

-- 店の代表投稿。写真のある投稿を優先する（無写真が代表だと選べない）
rep AS (
  SELECT DISTINCT ON (n.location_name, n.place)
    n.location_name,
    n.place,
    n.id AS post_id,
    n.prefecture,
    n.area,
    n.city,
    n.location_lat,
    n.location_lng,
    n.genre,
    n.price_range,
    n.author_username,
    n.author_name,
    i.url AS image_url
  FROM near n
  LEFT JOIN LATERAL (
    SELECT pi.url
    FROM post_images pi
    WHERE pi.post_id = n.id
    ORDER BY pi.position
    LIMIT 1
  ) i ON TRUE
  ORDER BY
    n.location_name, n.place,
    (i.url IS NULL),               -- 写真あり優先
    n.rating DESC,
    n.impressions_count DESC,
    n.created_at DESC
),

-- 店で満たされる場面（選んだもののうち）。
-- 投稿ごとに違うので、店の全投稿分をまとめる。
-- p_situations が空なら matched も空配列で、この CTE は0行になる。
sit AS (
  SELECT n.location_name, n.place, array_agg(DISTINCT s) AS matched
  FROM near n, UNNEST(n.matched) AS s
  GROUP BY 1, 2
),

-- 店単位の集計
grouped AS (
  SELECT
    n.location_name,
    n.place,
    AVG(n.rating)                                AS avg_rating,
    COUNT(DISTINCT n.user_id)::INT               AS visitors,
    COUNT(DISTINCT n.user_id)
      FILTER (WHERE n.user_id IN (SELECT uid FROM followed))::INT AS following_visitors,
    -- 同じ人が同じ店の別投稿を見た分は重複するが、店の注目度の目安としては足りる
    COALESCE(SUM(n.impressions_count), 0)::INT   AS impressions,
    bool_or(
      n.featured_at IS NOT NULL
      AND n.featured_at > now() - (public.featured_window_days() || ' days')::INTERVAL
    )                                            AS is_featured,
    bool_and(n.is_demo)                          AS all_demo,
    bool_or(n.is_demo)                           AS has_demo,
    COUNT(*)::INT                                AS posts_count,
    MAX(n.created_at)                            AS last_posted_at,
    MIN(n.distance_km)                           AS distance_km
  FROM near n
  GROUP BY 1, 2
),

-- 成分ごとに 0〜1 へ正規化してから重みを掛ける
scored AS (
  SELECT
    g.*,
    COALESCE(s.matched, '{}'::TEXT[]) AS matched_situations,
      w.w_situation * CASE
        WHEN COALESCE(array_length(p_situations, 1), 0) = 0 THEN 0
        ELSE COALESCE(array_length(s.matched, 1), 0)::DOUBLE PRECISION
             / array_length(p_situations, 1)
      END
    + w.w_rating * GREATEST(0, LEAST(1, (g.avg_rating::DOUBLE PRECISION - 1) / 4))
    + w.w_reach  * LEAST(1, ln(1 + g.impressions::DOUBLE PRECISION) / ln(1 + sc.reach_full))
    + w.w_crowd  * LEAST(1, ln(1 + g.visitors::DOUBLE PRECISION)    / ln(1 + sc.crowd_full))
    + w.w_near   * CASE
        WHEN g.distance_km IS NULL THEN 0
        ELSE GREATEST(0, 1 - g.distance_km
             / GREATEST(COALESCE(p_radius_km, sc.near_default_km), 0.5))
      END
    + w.w_fresh  * GREATEST(0, 1 - EXTRACT(EPOCH FROM now() - g.last_posted_at)::DOUBLE PRECISION
                                   / (sc.fresh_days * 86400))
    + w.w_follow * CASE WHEN g.following_visitors > 0 THEN 1 ELSE 0 END
    + w.w_featured * CASE WHEN g.is_featured THEN 1 ELSE 0 END
    -- 実在の店に架空の人物のレビューが載っているので、本物の投稿がある店を上に出す。
    -- 消さないのは、消すと地図が空になって「何も無いアプリ」に見えるため（移行0010）。
    + w.w_demo   * CASE WHEN g.all_demo THEN 1 ELSE 0 END
    AS score
  FROM grouped g
  LEFT JOIN sit s
    ON s.location_name = g.location_name
   AND s.place IS NOT DISTINCT FROM g.place
  CROSS JOIN public.recommend_weights() w
  CROSS JOIN public.recommend_scales()  sc
)

SELECT
  r.post_id,
  r.location_name,
  r.prefecture,
  COALESCE(r.area, r.city)          AS area,
  r.location_lat,
  r.location_lng,
  r.genre,
  r.price_range,
  r.image_url,
  r.author_username,
  r.author_name,
  round(sd.avg_rating, 2)           AS avg_rating,
  sd.visitors,
  sd.following_visitors,
  sd.impressions,
  COALESCE(sd.is_featured, FALSE)   AS is_featured,
  COALESCE(sd.has_demo, FALSE)      AS has_demo,
  sd.posts_count,
  sd.last_posted_at,
  round(sd.distance_km::NUMERIC, 2)::DOUBLE PRECISION AS distance_km,
  sd.matched_situations,
  round(sd.score::NUMERIC, 3)       AS score
FROM scored sd
JOIN rep r
  ON r.location_name = sd.location_name
 AND r.place IS NOT DISTINCT FROM sd.place
ORDER BY sd.score DESC, sd.avg_rating DESC, sd.last_posted_at DESC
LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100));
$$;

COMMIT;

-- 確認: 何も条件を付けずに上位5件。0行なら、見える公開投稿がまだ無い。
-- SELECT location_name, area, avg_rating, visitors, impressions, score
-- FROM public.recommend_spots() LIMIT 5;

-- 確認: 「デート」で近くを探したとき（東京駅から3km）
-- SELECT location_name, area, matched_situations, distance_km, score
-- FROM public.recommend_spots(
--   p_situations := ARRAY['デート'],
--   p_lat := 35.6812, p_lng := 139.7671, p_radius_km := 3
-- );
