-- ============================================================
-- MeshiMap 移行 0009
--   プレミアムで解放するものを、DB側で線引きする
--
--   1. 月間ランキング … 無料は上位3人まで。自分の順位は無料でも見える
--   2. 注目の投稿一覧 … 無料は2件まで
--
-- なぜDBでやるか:
--   端末側で「契約していなければ隠す」だけにすると、
--   API を直接叩けば全部読めてしまう。売り物が素通しになる。
--   隠すのではなく、そもそも返さない。
--
-- 自分の順位（monthly_standing）は無料のままにする。
-- 自分の成績まで有料にすると、何を買うのか分からないまま
-- 課金を迫ることになる。まず自分の位置が見えて、
-- 「他の人はどうなのか」で初めて買う理由が生まれる。
--
-- Supabase SQL Editor に貼り付けて実行。冪等。
-- ============================================================

BEGIN;

-- ============================================================
-- 前提の確認
--
-- 移行は番号順に依存している。途中を飛ばすと、
-- 「function public.is_subscribed(uuid) does not exist」のような
-- 素の PostgreSQL のエラーになり、どれを流し直せばよいか分からない。
-- ここで先に見て、番号で答える。
--
-- どこまで適用済みかの一覧は supabase/check_state.sql で出せる。
-- ============================================================

DO $$
BEGIN
  IF to_regprocedure('public.is_subscribed(uuid)') IS NULL THEN
    RAISE EXCEPTION
      '移行 0005 が未適用です。先に 0005_admin_pin_and_follow_limit.sql を実行してください。'
      USING HINT = 'supabase/check_state.sql を実行すると、どこまで適用済みかを一覧で確認できます。';
  END IF;

  IF to_regprocedure('public.featured_window_days()') IS NULL THEN
    RAISE EXCEPTION
      '移行 0008 が未適用です。先に 0008_impressions_featured_monthly.sql を実行してください。'
      USING HINT = 'supabase/check_state.sql を実行すると、どこまで適用済みかを一覧で確認できます。';
  END IF;
END $$;


-- ============================================================
-- 0. 無料で見せる量
--    ★ mobile/src/lib/billing.ts の FREE_RANKING_ROWS /
--      FREE_FEATURED_ROWS と揃えること。
--      表示は端末、線引きはここ、と役割を分けている。
-- ============================================================

CREATE OR REPLACE FUNCTION public.free_ranking_rows()
RETURNS INT LANGUAGE sql IMMUTABLE AS $$ SELECT 3 $$;

CREATE OR REPLACE FUNCTION public.free_featured_rows()
RETURNS INT LANGUAGE sql IMMUTABLE AS $$ SELECT 2 $$;

-- 契約者あつかいするか。運営は自分の掲載を確認できる必要があるので含める。
CREATE OR REPLACE FUNCTION public.has_premium()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL
     AND (public.is_subscribed(auth.uid()) OR public.is_admin_user(auth.uid()));
$$;


-- ============================================================
-- 1. 月間ランキング
--
--    無料でも上位は見えるようにする。中が空だと
--    「何が見られるようになるのか」が伝わらず、買う理由が立たない。
--
--    total_entrants は絞ったあとも全体の人数を返す。
--    「3人中3位」ではなく「128人中3位」でないと意味が変わってしまう。
-- ============================================================

DROP FUNCTION IF EXISTS public.monthly_ranking(INT);

CREATE OR REPLACE FUNCTION public.monthly_ranking(p_limit INT DEFAULT 50)
RETURNS TABLE (
  user_id        UUID,
  username       TEXT,
  display_name   TEXT,
  photo_url      TEXT,
  avatar_emoji   TEXT,
  impressions    INT,
  tier           INT,
  rank_position  INT,
  total_entrants INT,
  is_me          BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH board AS (
    SELECT
      m.user_id,
      m.impressions,
      (RANK()  OVER (ORDER BY m.impressions DESC))::INT AS rank_position,
      (COUNT(*) OVER ())::INT                           AS total_entrants
    FROM profile_monthly_impressions m
    WHERE m.period = public.jst_month()
      AND m.impressions > 0
  )
  SELECT
    b.user_id,
    pr.username,
    pr.display_name,
    pr.photo_url,
    pr.avatar_emoji,
    b.impressions,
    public.monthly_tier(b.impressions),
    b.rank_position,
    b.total_entrants,
    (b.user_id = auth.uid()) AS is_me
  FROM board b
  JOIN profiles pr ON pr.id = b.user_id
  WHERE auth.uid() IS NOT NULL
    -- 契約していなければ上位だけ。ただし自分の行は常に返す。
    AND (
      public.has_premium()
      OR b.rank_position <= public.free_ranking_rows()
      OR b.user_id = auth.uid()
    )
  ORDER BY b.rank_position
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
$$;


-- ============================================================
-- 2. 注目の投稿
--
--    ★ SECURITY DEFINER にしない。
--      投稿そのものを返す経路なので、posts の RLS を
--      そのまま効かせる必要がある。定義者権限で読むと、
--      非公開投稿や、ブロックした相手の投稿まで出てしまう。
--
--    返すのは id だけ。写真や投稿者は端末側が
--    通常の select（＝RLSつき）で取り直す。
--    RPC の戻り値に投稿の中身を詰めると、
--    RLS を二重に確認しなければならなくなって間違いやすい。
-- ============================================================

CREATE OR REPLACE FUNCTION public.featured_post_ids(p_limit INT DEFAULT 50)
RETURNS TABLE (
  post_id           UUID,
  impressions_count INT,
  featured_at       TIMESTAMPTZ
)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p.id, p.impressions_count, p.featured_at
  FROM posts p
  WHERE p.is_public
    AND p.featured_at IS NOT NULL
    AND p.featured_at > NOW() - (public.featured_window_days() || ' days')::interval
  ORDER BY p.impressions_count DESC, p.featured_at DESC
  LIMIT CASE
          WHEN public.has_premium()
            THEN GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
          ELSE public.free_featured_rows()
        END;
$$;

-- 無料の人に「あと何件あるのか」を見せるための件数。
-- 数が分からないまま鍵をかけると、買う判断ができない。
CREATE OR REPLACE FUNCTION public.featured_post_total()
RETURNS INT LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COUNT(*)::INT
  FROM posts p
  WHERE p.is_public
    AND p.featured_at IS NOT NULL
    AND p.featured_at > NOW() - (public.featured_window_days() || ' days')::interval;
$$;

COMMIT;
