-- ============================================================
-- MeshiMap 移行 0015
--   フォロー/フォロワーの一覧を安全に出せるようにする
--
-- 背景:
--   プロフィールの「フォロワー」「フォロー中」の数字を押すと
--   一覧が開くようにした。そこで follows を読むことになるが、
--   0001 の follows_select は `USING (true)` で、
--   **誰でもフォロー関係を全部読める**状態だった。
--
--   端末側で「非公開アカウントの一覧は開かせない」判定を書いても、
--   anon キーで PostgREST を直接叩けば素通りする。
--   このアプリの決め事どおり、止めるのは DB 側でやる。
--
-- やること:
--   1. follows_select を「自分が関わる行だけ」に絞る
--   2. 一覧は SECURITY DEFINER の関数を1本ずつ開けて出す
--      （見てよい相手かどうかを、関数の中で判定する）
--
-- ★ 1 で既存の画面が壊れないことを確認済み。
--   アプリが follows を読むのは4か所あるが、どれも
--   follower_id か following_id が自分の行しか見ていない:
--     ProfileView（自分→相手のフォロー状態）
--     MapAudienceDrawer（自分がフォローしている人）
--     settings/index（自分宛の承認待ちの件数）
--     settings/requests（自分宛の承認待ち）
--   SQL 側で follows を読む関数も同じで、
--   map_pins / my_map_quota / set_map_visible / recommend_spots は
--   いずれも follower_id = auth.uid() で引いている。
--
-- Supabase SQL Editor に貼り付けて実行。冪等。
-- ============================================================

BEGIN;

-- ============================================================
-- 前提の確認
-- ============================================================

DO $$
BEGIN
  IF to_regprocedure('public.is_profile_public(uuid)') IS NULL
     OR to_regprocedure('public.has_block_with(uuid)') IS NULL THEN
    RAISE EXCEPTION
      '移行 0001 が未適用です。先に 0001_accounts_privacy_regions.sql を実行してください。'
      USING HINT = 'supabase/check_state.sql を実行すると、どこまで適用済みかを一覧で確認できます。';
  END IF;
END $$;


-- ============================================================
-- 1. follows の閲覧を「自分が関わる行」に絞る
--
--    これまでは USING (true)。フォロー関係は、誰が誰と繋がって
--    いるかという交友関係そのものなので、全部見せる理由が無い。
--
--    一覧を出すのは下の関数に任せる。関数は定義者権限で読むので、
--    このポリシーに縛られない。
-- ============================================================

DROP POLICY IF EXISTS "follows_select" ON follows;
CREATE POLICY "follows_select" ON follows FOR SELECT
  USING (follower_id = auth.uid() OR following_id = auth.uid());


-- ============================================================
-- 2. 一覧を見てよい相手か
--
--    投稿の見え方（can_view_post）と同じ線を引く:
--      ・自分            … 常に見える
--      ・公開アカウント  … 誰でも見える
--      ・非公開アカウント… 承認済みのフォロワーだけ
--    どちらの場合も、ブロック関係にある相手は見えない。
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_view_follows(p_user UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      p_user = auth.uid()
      OR (
        NOT public.has_block_with(p_user)
        AND (public.is_profile_public(p_user) OR public.is_following(p_user))
      )
    );
$$;


-- ============================================================
-- 3. 一覧そのもの
--
--    ★ 返す行からブロック相手を落とすこと。
--      定義者権限で読むので profiles の RLS は効かない。
--      ここで自分で落とさないと、ブロックした相手が
--      他人のフォロワー一覧に混ざって出てくる。
--
--    ★ 承認済み(accepted)だけを返す。
--      承認待ちは「その人が申請した」という事実であって、
--      繋がってはいない。数（followers_count）も accepted しか
--      数えていないので、揃えておく。
-- ============================================================

DROP FUNCTION IF EXISTS public.followers_of(UUID);
DROP FUNCTION IF EXISTS public.following_of(UUID);

CREATE OR REPLACE FUNCTION public.followers_of(p_user UUID)
RETURNS TABLE (
  id            UUID,
  username      TEXT,
  display_name  TEXT,
  photo_url     TEXT,
  avatar_emoji  TEXT,
  posts_count   INT,
  areas_count   INT,
  is_public     BOOLEAN,
  is_admin      BOOLEAN,
  followed_at   TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    pr.id, pr.username, pr.display_name, pr.photo_url, pr.avatar_emoji,
    pr.posts_count, pr.areas_count, pr.is_public, pr.is_admin,
    f.created_at
  FROM follows f
  JOIN profiles pr ON pr.id = f.follower_id
  WHERE public.can_view_follows(p_user)
    AND f.following_id = p_user
    AND f.status = 'accepted'
    AND NOT public.has_block_with(pr.id)
  ORDER BY f.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.following_of(p_user UUID)
RETURNS TABLE (
  id            UUID,
  username      TEXT,
  display_name  TEXT,
  photo_url     TEXT,
  avatar_emoji  TEXT,
  posts_count   INT,
  areas_count   INT,
  is_public     BOOLEAN,
  is_admin      BOOLEAN,
  followed_at   TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    pr.id, pr.username, pr.display_name, pr.photo_url, pr.avatar_emoji,
    pr.posts_count, pr.areas_count, pr.is_public, pr.is_admin,
    f.created_at
  FROM follows f
  JOIN profiles pr ON pr.id = f.following_id
  WHERE public.can_view_follows(p_user)
    AND f.follower_id = p_user
    AND f.status = 'accepted'
    AND NOT public.has_block_with(pr.id)
  ORDER BY f.created_at DESC;
$$;

REVOKE ALL   ON FUNCTION public.followers_of(UUID) FROM public;
REVOKE ALL   ON FUNCTION public.following_of(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.followers_of(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.following_of(UUID) TO authenticated;

COMMIT;
