-- ============================================================
-- MeshiMap 移行 0004
--   1. ランク（投稿数 × 制覇エリア数）
--   2. ランクで解放されるアバター絵柄
--   3. 地図に出す「フォロー中の人のアイコン」用の RPC
--
-- Snapchat の Snap Map を参考にしているが、現在地の共有はしない。
-- 出すのは「その人が最後に投稿したお店の場所」。
-- 常時の位置追跡をしないので、位置情報を保存する必要がない。
--
-- Supabase SQL Editor に貼り付けて実行。冪等。
-- ============================================================

BEGIN;

-- ============================================================
-- 1. 制覇エリア数
--    「何件投稿したか」だけだと同じ店に通うだけで上がってしまうので、
--    「いくつの街で食べたか」を併せて見る。
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS areas_count INT NOT NULL DEFAULT 0;

-- area が NULL の投稿（主要エリア外）は city で数える。
-- post_counts_by_region の集計単位と揃えてある。
CREATE OR REPLACE FUNCTION public.recount_areas(p_user UUID)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE profiles SET areas_count = (
    SELECT COUNT(DISTINCT COALESCE(p.area, p.city))
    FROM posts p
    WHERE p.user_id = p_user
      AND COALESCE(p.area, p.city) IS NOT NULL
  )
  WHERE id = p_user;
$$;

CREATE OR REPLACE FUNCTION public.sync_areas_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recount_areas(OLD.user_id);
  ELSE
    PERFORM public.recount_areas(NEW.user_id);
    -- 投稿の持ち主が変わることは想定していないが、念のため
    IF TG_OP = 'UPDATE' AND OLD.user_id <> NEW.user_id THEN
      PERFORM public.recount_areas(OLD.user_id);
    END IF;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_areas_count ON posts;
CREATE TRIGGER trg_areas_count
  AFTER INSERT OR DELETE OR UPDATE OF area, city, user_id ON posts
  FOR EACH ROW EXECUTE FUNCTION public.sync_areas_count();

-- 既存データの取り込み
UPDATE profiles pr SET areas_count = (
  SELECT COUNT(DISTINCT COALESCE(p.area, p.city))
  FROM posts p
  WHERE p.user_id = pr.id AND COALESCE(p.area, p.city) IS NOT NULL
);


-- ============================================================
-- 2. ランク判定
--
--    1 見習い      はじめたばかり
--    2 常連        投稿10 かつ 3エリア
--    3 食べ歩き人   投稿30 かつ 10エリア
--    4 グルメ長     投稿60 かつ 20エリア
--    5 美食家      投稿100 かつ 30エリア
--
--    しきい値を変えるときは mobile/src/lib/rank.ts も必ず合わせること。
--    表示は端末側、解放判定はここ、と役割を分けている。
-- ============================================================

CREATE OR REPLACE FUNCTION public.rank_of(p_posts INT, p_areas INT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_posts >= 100 AND p_areas >= 30 THEN 5
    WHEN p_posts >=  60 AND p_areas >= 20 THEN 4
    WHEN p_posts >=  30 AND p_areas >= 10 THEN 3
    WHEN p_posts >=  10 AND p_areas >=  3 THEN 2
    ELSE 1
  END;
$$;

CREATE OR REPLACE FUNCTION public.rank_of_user(p_user UUID)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT public.rank_of(pr.posts_count, pr.areas_count) FROM profiles pr WHERE pr.id = p_user),
    1
  );
$$;


-- ============================================================
-- 3. アバターの絵柄
--
--    「どの絵柄がどのランクで解放されるか」はこの表が正。
--    端末側にハードコードすると、しきい値を変えたときにズレる。
-- ============================================================

CREATE TABLE IF NOT EXISTS avatar_emojis (
  emoji     TEXT PRIMARY KEY,
  min_rank  INT  NOT NULL CHECK (min_rank BETWEEN 1 AND 5),
  sort_order INT NOT NULL DEFAULT 0
);

INSERT INTO avatar_emojis (emoji, min_rank, sort_order) VALUES
  ('🍜', 1, 10), ('🍣', 1, 11), ('☕', 1, 12),
  ('🍕', 2, 20), ('🥩', 2, 21), ('🍰', 2, 22),
  ('🍲', 3, 30), ('🍤', 3, 31), ('🍱', 3, 32),
  ('🥂', 4, 40), ('🍷', 4, 41), ('🎂', 4, 42),
  ('👑', 5, 50), ('🏆', 5, 51), ('✨', 5, 52)
ON CONFLICT (emoji) DO UPDATE
  SET min_rank = EXCLUDED.min_rank, sort_order = EXCLUDED.sort_order;

ALTER TABLE avatar_emojis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "avatar_emojis_select" ON avatar_emojis;
CREATE POLICY "avatar_emojis_select" ON avatar_emojis FOR SELECT USING (true);

-- 選んだ絵柄。NULL ならプロフィール写真をそのまま使う。
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_emoji TEXT;

-- ★ 未解放の絵柄を選べないようにする。
--   RLS の WITH CHECK では他テーブルを参照した動的な検査がしづらいので、
--   is_admin と同じくトリガーで矯正する。
--   ランクが下がる（投稿を消す）ことはあるので、そのときは
--   解放範囲外になった絵柄を NULL に戻す。
CREATE OR REPLACE FUNCTION public.enforce_avatar_emoji()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_required INT;
BEGIN
  IF NEW.avatar_emoji IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT min_rank INTO v_required FROM avatar_emojis WHERE emoji = NEW.avatar_emoji;

  -- 表に無い絵柄は認めない（任意の文字列を入れさせない）
  IF v_required IS NULL THEN
    NEW.avatar_emoji := NULL;
    RETURN NEW;
  END IF;

  IF public.rank_of(NEW.posts_count, NEW.areas_count) < v_required THEN
    NEW.avatar_emoji := NULL;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_avatar_emoji ON profiles;
CREATE TRIGGER trg_enforce_avatar_emoji
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_avatar_emoji();


-- ============================================================
-- 4. 地図に出すアイコン
--
--    自分 + フォロー中（承認済み）の人について、
--    「最後に投稿したお店」を1件ずつ返す。
--
--    SECURITY INVOKER なので posts の RLS がそのまま効く。
--    相手が非公開にしている投稿は、そもそもこの集合に入らない。
-- ============================================================

CREATE OR REPLACE FUNCTION public.map_pins()
RETURNS TABLE (
  user_id       UUID,
  username      TEXT,
  display_name  TEXT,
  photo_url     TEXT,
  avatar_emoji  TEXT,
  rank          INT,
  posts_count   INT,
  areas_count   INT,
  location_name TEXT,
  location_lat  DOUBLE PRECISION,
  location_lng  DOUBLE PRECISION,
  posted_at     TIMESTAMPTZ,
  is_me         BOOLEAN
)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT ON (p.user_id)
    p.user_id,
    pr.username,
    pr.display_name,
    pr.photo_url,
    pr.avatar_emoji,
    public.rank_of(pr.posts_count, pr.areas_count) AS rank,
    pr.posts_count,
    pr.areas_count,
    p.location_name,
    p.location_lat,
    p.location_lng,
    p.created_at        AS posted_at,
    (p.user_id = auth.uid()) AS is_me
  FROM posts p
  JOIN profiles pr ON pr.id = p.user_id
  WHERE auth.uid() IS NOT NULL
    AND (
      p.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM follows f
        WHERE f.follower_id = auth.uid()
          AND f.following_id = p.user_id
          AND f.status = 'accepted'
      )
    )
  ORDER BY p.user_id, p.created_at DESC;
$$;

COMMIT;
