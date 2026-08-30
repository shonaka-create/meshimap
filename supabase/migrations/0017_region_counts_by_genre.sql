-- ============================================================
-- MeshiMap 移行 0017
--   地域ごとの件数を、ジャンルで絞れるようにする
--
-- 背景:
--   ジャンルの絞り込みは、いちばん下の階層（投稿ピンが出ている状態）
--   でしか出していなかった。「この県のラーメンはどこに多いのか」を
--   見るには、いったんどこかのエリアまで降りるしかない。
--   絞り込みを上の階層でも使えるようにするには、
--   バブルの数字もジャンルで数え直す必要がある。
--
-- ★ 引数を足すだけで、既存の呼び出しは何も変えなくてよい。
--   p_genre は DEFAULT NULL で、渡さなければ今までどおり全件を数える。
--   古いアプリ（App Store に出ているビルド）は2引数で呼ぶので、
--   そちらも動き続ける。
--
-- ★ 地図の読み込み回数とは無関係。
--   これはDBの集計であって、Google Maps を叩くものではない。
--   絞り込みを変えてもバブルの数字が変わるだけで、
--   地図そのものは読み込み直さない（＝課金は発生しない）。
--
-- Supabase SQL Editor に貼り付けて実行。冪等。
-- ============================================================

BEGIN;

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
  WHERE (p_prefecture IS NULL OR p.prefecture = p_prefecture)
    AND (p_genre IS NULL OR p.genre = p_genre)
    AND CASE p_level
          WHEN 'prefecture' THEN p.prefecture
          ELSE COALESCE(p.area, p.city)
        END IS NOT NULL
  GROUP BY 1
  ORDER BY 2 DESC;
$$;

COMMIT;
