-- ============================================================
-- MeshiMap 移行 0003
--   運営（管理者）アカウントの仕組み
--
-- 背景:
--   App Store Guideline 1.2 は UGC アプリに「通報された内容を24時間以内に
--   審査すること」を求めている。しかし移行0001 時点の reports の RLS は
--   「通報した本人だけが自分の通報を読める」なので、
--   **誰も通報を確認できない** 状態だった。それを塞ぐ。
--
-- 方針:
--   ロールを表に持たせるのは profiles.is_admin の1列だけ。
--   権限の付与は SQL Editor（サービス側）からしか行えないようにする。
--
-- Supabase SQL Editor に貼り付けて実行。冪等。
-- ============================================================

BEGIN;

-- ============================================================
-- 1. 管理者フラグ
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- ★ 権限昇格の防止
--   profiles の UPDATE ポリシーは「本人なら更新可」なので、
--   このままだとアプリから自分の is_admin を true にできてしまう。
--   RLS の WITH CHECK では更新前の値(OLD)を参照できないため、
--   トリガーで矯正する。
--
--   auth.uid() が NULL のとき（= SQL Editor / service_role からの操作）は
--   通すので、運営が管理者を任命する経路だけは残る。
CREATE OR REPLACE FUNCTION public.protect_admin_flag()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    NEW.is_admin := OLD.is_admin;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_protect_admin_flag ON profiles;
CREATE TRIGGER trg_protect_admin_flag
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_admin_flag();

-- サインアップ直後の profiles も同様。
-- handle_new_user は raw_user_meta_data を読むので、
-- 「メタデータに is_admin を仕込んでサインアップ」を防いでおく。
-- （現状の handle_new_user は is_admin を読まないが、将来の事故防止）
CREATE OR REPLACE FUNCTION public.deny_admin_on_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.is_admin := false;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_deny_admin_on_insert ON profiles;
CREATE TRIGGER trg_deny_admin_on_insert
  BEFORE INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.deny_admin_on_insert();


-- ============================================================
-- 2. 判定関数
--    RLS から呼ぶので SECURITY DEFINER（profiles の RLS で再帰しないため）
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT p.is_admin FROM profiles p WHERE p.id = auth.uid()),
    false
  );
$$;


-- ============================================================
-- 3. 通報の閲覧・対応
-- ============================================================

-- 通報した本人 or 管理者
DROP POLICY IF EXISTS "reports_select" ON reports;
CREATE POLICY "reports_select" ON reports FOR SELECT
  USING (reporter_id = auth.uid() OR public.is_admin());

-- 対応状況(status)を進められるのは管理者だけ
DROP POLICY IF EXISTS "reports_update" ON reports;
CREATE POLICY "reports_update" ON reports FOR UPDATE
  USING (public.is_admin()) WITH CHECK (public.is_admin());


-- ============================================================
-- 4. 通報された投稿は管理者が読める
--
--    通報を受けても中身が見られなければ審査のしようがない。
--    ただし「管理者は全ての非公開投稿を読める」ようにはしない。
--    通報が1件でも付いている投稿に限定する。
-- ============================================================

DROP POLICY IF EXISTS "posts_select" ON posts;
CREATE POLICY "posts_select" ON posts FOR SELECT
  USING (
    public.can_view_post(user_id, is_public)
    OR (
      public.is_admin()
      AND EXISTS (SELECT 1 FROM reports r WHERE r.target_post_id = posts.id)
    )
  );


-- ============================================================
-- 5. 未対応の通報一覧
--    reports だけでは「誰の何が通報されたか」が分からないので、
--    審査に必要な情報を1クエリで返す。
--    SECURITY INVOKER なので上の RLS がそのまま効き、
--    管理者以外が呼んでも自分の通報しか返らない。
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_open_reports(p_limit INT DEFAULT 100)
RETURNS TABLE (
  id                UUID,
  reason            TEXT,
  detail            TEXT,
  status            TEXT,
  created_at        TIMESTAMPTZ,
  reporter_username TEXT,
  target_username   TEXT,
  target_post_id    UUID,
  target_caption    TEXT
)
LANGUAGE sql STABLE AS $$
  SELECT
    r.id, r.reason, r.detail, r.status, r.created_at,
    rep.username                       AS reporter_username,
    COALESCE(tu.username, pu.username) AS target_username,
    r.target_post_id,
    left(p.caption, 120)               AS target_caption
  FROM reports r
  LEFT JOIN profiles rep ON rep.id = r.reporter_id
  LEFT JOIN profiles tu  ON tu.id  = r.target_user_id
  LEFT JOIN posts    p   ON p.id   = r.target_post_id
  LEFT JOIN profiles pu  ON pu.id  = p.user_id
  WHERE r.status = 'open'
  ORDER BY r.created_at
  LIMIT p_limit;
$$;

COMMIT;

-- ============================================================
-- 使い方: 管理者を任命する
--
--   この SQL Editor（service_role）からのみ実行できる。
--   scripts/seed.mjs で admin アカウントを作ったあとに:
--
--     UPDATE profiles SET is_admin = true WHERE username = 'admin';
--
--   取り消すときは false に戻す。
--   supabase/scripts/grant-admin.sql も用意してある。
-- ============================================================
