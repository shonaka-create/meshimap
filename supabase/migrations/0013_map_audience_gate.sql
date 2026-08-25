-- ============================================================
-- MeshiMap 移行 0013
--   課金の線を「フォローできる人数」から「地図に出せる人数」へ移す
--
-- 背景:
--   0005 では、フォローそのものを無料2人までで止めていた。
--   これだと「人と繋がる」ことに値段が付く。
--   知り合いを追加しようとした時点で壁に当たるので、
--   まだ何も見ていない人に買うかどうかを聞くことになる。
--
--   ここでは、フォローは何人でもできるようにして、
--   壁を「その人の地図を出す」ところに移す。
--     ・運営アカウント … 常に地図に出る（掲載枠。人数に数えない）
--     ・自分           … 常に地図に出る
--     ・フォロー中の人 … 無料は2人まで地図に出せる
--   3人目を地図に出そうとしたところで、初めてプランの案内が出る。
--   買う理由が「もう2人ぶん見えている地図を、もっと増やす」になる。
--
-- ★ 端末側のチェックだけにしないこと。
--   どこに出すかを決めているのは map_pins() であり、
--   on_map の書き換えは set_map_visible() 経由でしか通らない
--   （follows には follower 向けの UPDATE ポリシーが無い）。
--   API を直接叩いても、無料のまま3人目が地図に出ることはない。
--
-- ★ mobile/src/lib/limits.ts の FREE_MAP_LIMIT と対。
--   人数を変えるときは両方直すこと。
--
-- Supabase SQL Editor に貼り付けて実行。冪等。
-- ============================================================

BEGIN;

-- ============================================================
-- 前提の確認
--
-- 移行は番号順に依存している。途中を飛ばすと
-- 「function public.has_premium() does not exist」のような
-- 素の PostgreSQL のエラーになり、どれを流し直せばよいか分からない。
-- どこまで適用済みかの一覧は supabase/check_state.sql で出せる。
-- ============================================================

DO $$
BEGIN
  IF to_regprocedure('public.is_admin_user(uuid)') IS NULL THEN
    RAISE EXCEPTION
      '移行 0005 が未適用です。先に 0005_admin_pin_and_follow_limit.sql を実行してください。'
      USING HINT = 'supabase/check_state.sql を実行すると、どこまで適用済みかを一覧で確認できます。';
  END IF;

  IF to_regprocedure('public.has_premium()') IS NULL THEN
    RAISE EXCEPTION
      '移行 0009 が未適用です。先に 0009_premium_gates.sql を実行してください。'
      USING HINT = 'supabase/check_state.sql を実行すると、どこまで適用済みかを一覧で確認できます。';
  END IF;
END $$;


-- ============================================================
-- 1. 無料で地図に出せる人数
--    ★ mobile/src/lib/limits.ts の FREE_MAP_LIMIT と揃えること。
--      表示は端末、線引きはここ、と役割を分けている。
-- ============================================================

CREATE OR REPLACE FUNCTION public.free_map_users()
RETURNS INT LANGUAGE sql IMMUTABLE AS $$ SELECT 2 $$;


-- ============================================================
-- 2. follows.on_map
--
--    「この人を地図に出しているか」。
--    フォロー（関係）と、地図に出す（表示）を分けるための列。
--
--    既存の行は true で入れる。0005 の上限のもとでは
--    誰も3人以上フォローできていないので、全部そのまま出せる。
-- ============================================================

ALTER TABLE follows ADD COLUMN IF NOT EXISTS on_map BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS follows_on_map_idx
  ON follows (follower_id, on_map)
  WHERE on_map;


-- ============================================================
-- 3. フォローの上限を外す
--
--    0005 のトリガーを落とす。これ以降、フォローは何人でもできる。
--    止める場所は「地図に出す」側（map_pins / set_map_visible）へ移った。
-- ============================================================

DROP TRIGGER  IF EXISTS trg_enforce_follow_limit ON follows;
DROP FUNCTION IF EXISTS public.enforce_follow_limit();


-- ============================================================
-- 4. 新しいフォローを地図に出すかどうかの既定値
--
--    ★ クライアントが送ってきた on_map は信用しない。
--      follows_insert ポリシーは列の中身までは見ないので、
--      ここで必ず決め直す（0001 の force_follow_status と同じ考え方）。
--
--    ・運営      … 常に true（掲載枠。人数に数えない）
--    ・契約者    … 常に true
--    ・それ以外  … 空きがあれば true、無ければ false
--                  （フォロー自体は成立する。地図に出ないだけ）
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_follow_on_map_default()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_used INT;
BEGIN
  IF public.is_admin_user(NEW.following_id)
     OR public.is_subscribed(NEW.follower_id)
     OR public.is_admin_user(NEW.follower_id)
  THEN
    NEW.on_map := true;
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_used
  FROM follows f
  JOIN profiles p ON p.id = f.following_id
  WHERE f.follower_id = NEW.follower_id
    AND f.on_map
    AND NOT p.is_admin;

  NEW.on_map := (v_used < public.free_map_users());
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_set_follow_on_map ON follows;
CREATE TRIGGER trg_set_follow_on_map
  BEFORE INSERT ON follows
  FOR EACH ROW EXECUTE FUNCTION public.set_follow_on_map_default();


-- ============================================================
-- 5. 地図に出す / 出さないの切り替え
--
--    follows の UPDATE ポリシー（0001）は「フォローされる側が
--    申請を承認する」ためのものなので、フォローした側は
--    自分の行を書き換えられない。ここを通すためだけに
--    UPDATE ポリシーを足すと、status まで書き換えられてしまい、
--    非公開アカウントの承認を自分で通せるようになる。
--    そこで定義者権限の関数を1つだけ開ける。
--
--    エラーの文字列は端末側で日本語に変換するので、
--    識別しやすい固定文字列にしてある（limits.ts と対）。
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_map_visible(p_target UUID, p_on BOOLEAN)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_used INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM follows f
    WHERE f.follower_id = auth.uid()
      AND f.following_id = p_target
      AND f.status = 'accepted'
  ) THEN
    RAISE EXCEPTION 'not_following'
      USING HINT = 'フォローが承認されている相手だけ地図に出せます';
  END IF;

  -- 出す方向のときだけ数える。外すのはいつでも通す。
  IF p_on AND NOT public.is_admin_user(p_target) AND NOT public.has_premium() THEN
    SELECT COUNT(*) INTO v_used
    FROM follows f
    JOIN profiles p ON p.id = f.following_id
    WHERE f.follower_id = auth.uid()
      AND f.on_map
      AND NOT p.is_admin
      AND f.following_id <> p_target;

    IF v_used >= public.free_map_users() THEN
      RAISE EXCEPTION 'map_limit_reached'
        USING HINT = '無料で地図に出せるのは2人までです';
    END IF;
  END IF;

  UPDATE follows
     SET on_map = p_on
   WHERE follower_id = auth.uid()
     AND following_id = p_target;

  RETURN p_on;
END $$;


-- ============================================================
-- 6. いま何人ぶん出しているか
--
--    used        … 地図に出している人数（運営は除く）
--    limit_count … 無料の上限
--    subscribed  … 契約中か（運営も真になる）
--    follows_cnt … フォローしている人数（運営は除く）
--
--    follows_cnt を返すのは、「フォローは8人、地図に出せるのは2人」と
--    いう状態をそのまま画面に出せるようにするため。
--    上限だけ見せても、あと何人ぶん眠っているのかが分からない。
-- ============================================================

DROP FUNCTION IF EXISTS public.my_map_quota();

CREATE OR REPLACE FUNCTION public.my_map_quota()
RETURNS TABLE (used INT, limit_count INT, subscribed BOOLEAN, follows_cnt INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    (SELECT COUNT(*)::INT
       FROM follows f JOIN profiles p ON p.id = f.following_id
      WHERE f.follower_id = auth.uid()
        AND f.status = 'accepted'
        AND f.on_map
        AND NOT p.is_admin),
    public.free_map_users(),
    public.has_premium(),
    (SELECT COUNT(*)::INT
       FROM follows f JOIN profiles p ON p.id = f.following_id
      WHERE f.follower_id = auth.uid()
        AND f.status = 'accepted'
        AND NOT p.is_admin);
$$;

-- 旧アプリ（App Store に出ているビルド）は my_follow_quota() を呼ぶ。
-- 落とすと、そちらのプラン画面が読み込みのまま止まる。
-- 中身は地図の枠に読み替えて返す（used は地図に出している人数）。
CREATE OR REPLACE FUNCTION public.my_follow_quota()
RETURNS TABLE (used INT, limit_count INT, subscribed BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT q.used, q.limit_count, q.subscribed FROM public.my_map_quota() q;
$$;


-- ============================================================
-- 7. 地図に出すアイコン
--
--    ★ ここが本当の線引き。
--      on_map を立てるところ（set_map_visible）でも人数は見ているが、
--      契約が切れた後も on_map が true のまま残る（解約は
--      Webhook で subscriptions が変わるだけで、follows は触らない）。
--      そのため、返す段でも必ず無料の人数まで絞る。
--      絞る順はフォローした順（created_at）で固定する。
--      日によって出る人が変わると、地図が信用できなくなる。
-- ============================================================

DROP FUNCTION IF EXISTS public.map_pins();

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
  is_me         BOOLEAN,
  is_admin      BOOLEAN
)
LANGUAGE sql STABLE AS $$
  WITH shown AS (
    SELECT f.following_id
    FROM follows f
    JOIN profiles p ON p.id = f.following_id
    WHERE f.follower_id = auth.uid()
      AND f.status = 'accepted'
      AND f.on_map
      AND NOT p.is_admin
    ORDER BY f.created_at
    LIMIT CASE WHEN public.has_premium() THEN 1000 ELSE public.free_map_users() END
  )
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
    p.created_at             AS posted_at,
    (p.user_id = auth.uid()) AS is_me,
    pr.is_admin
  FROM posts p
  JOIN profiles pr ON pr.id = p.user_id
  WHERE auth.uid() IS NOT NULL
    AND (
      pr.is_admin                  -- 運営は常に表示（掲載枠）
      OR p.user_id = auth.uid()
      OR p.user_id IN (SELECT following_id FROM shown)
    )
  ORDER BY p.user_id, p.created_at DESC;
$$;

COMMIT;
