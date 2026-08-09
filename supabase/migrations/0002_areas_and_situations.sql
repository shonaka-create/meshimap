-- ============================================================
-- MeshiMap 移行 0002
--   1. 地図の第2階層を「エリア」に統一（市区町村＋主要駅）
--   2. シチュエーション（デート・女子会 など）を追加
--
-- 背景:
--   都道府県と主要エリア(144件)の座標をアプリに内蔵したため、
--   緯度経度からのエリア判定に Google Geocoding API を使わなくて済む。
--   station 列は「駅だけ」を想定した名前だったが、実際には
--   「すすきの」「河原町」のような繁華街も入るので area に改名する。
--
-- Supabase SQL Editor に貼り付けて実行。冪等。
-- ============================================================

BEGIN;

-- ============================================================
-- 1. posts.station → posts.area
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'station'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'area'
  ) THEN
    ALTER TABLE posts RENAME COLUMN station TO area;
  END IF;
END $$;

ALTER TABLE posts ADD COLUMN IF NOT EXISTS area TEXT;

DROP INDEX IF EXISTS posts_station_idx;
CREATE INDEX IF NOT EXISTS posts_area_idx ON posts (prefecture, area);


-- ============================================================
-- 2. シチュエーション
--    gourmet-atlas にあって未実装だった軸。
--    「デート」「女子会」など複数選択なので配列で持つ。
-- ============================================================

ALTER TABLE posts ADD COLUMN IF NOT EXISTS situations TEXT[] NOT NULL DEFAULT '{}';

-- 「デートで使える店」のような絞り込みを効かせる
CREATE INDEX IF NOT EXISTS posts_situations_idx ON posts USING gin (situations);


-- ============================================================
-- 3. 地域集計RPCを 県 → エリア の2段に作り直す
--
--    第2階層は area を使うが、エリア外（山間部など）の投稿は
--    area が NULL になるため city で補う。
--    SECURITY INVOKER なので posts の RLS がそのまま効き、
--    「自分が見られる投稿」だけが集計される。
-- ============================================================

DROP FUNCTION IF EXISTS public.post_counts_by_region(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.post_counts_by_region(
  p_level      TEXT,                 -- 'prefecture' | 'area'
  p_prefecture TEXT DEFAULT NULL
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
  WHERE (p_prefecture IS NULL OR p.prefecture = p_prefecture)
    AND CASE p_level
          WHEN 'prefecture' THEN p.prefecture
          ELSE COALESCE(p.area, p.city)
        END IS NOT NULL
  GROUP BY 1
  ORDER BY 2 DESC;
$$;

COMMIT;
