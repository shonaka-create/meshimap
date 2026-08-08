-- ============================================================
-- MeshiMap 移行 0001
--   1. アカウント名(display_name) と ユーザーID(username) の分離
--   2. 投稿・アカウントの公開/非公開
--   3. Instagram型フォロー（非公開アカウントは承認制）
--   4. 地域（県/市区町村/駅）集計
--   5. App Store 必須要件（通報・ブロック・アカウント削除）
--   6. カウンタをトリガー化（手動UPDATEの競合バグを解消）
--
-- Supabase SQL Editor に貼り付けて実行。何度実行しても安全（冪等）。
-- ============================================================

BEGIN;

-- 部分一致検索（アカウント名 / ユーザーID）用
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- 1. profiles: username(ユーザーID) と is_public を追加
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username  TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;

-- 既存ユーザーの username を採番（未設定のみ）。
-- 'user' + id先頭8桁の英字化。衝突しないよう a-z のみに写像する。
UPDATE profiles
SET username = 'user' || translate(substr(replace(id::text, '-', ''), 1, 10),
                                   '0123456789', 'abcdefghij')
WHERE username IS NULL;

-- 小文字英字のみ・3〜20文字。
-- ※数字やアンダースコアも許可したくなったら下の正規表現を
--   '^[a-z][a-z0-9_]{2,19}$' に変えるだけでよい。
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_username_format;
ALTER TABLE profiles ADD  CONSTRAINT profiles_username_format
  CHECK (username ~ '^[a-z]{3,20}$');

ALTER TABLE profiles ALTER COLUMN username SET NOT NULL;

-- ★ 旧トリガーはメールのローカル部を display_name にしていたため、
--   既存ユーザーの表示名にメールアドレスが露出している場合がある。
--   個人情報なので username で置き換える（本人がアプリ内で改名できる）。
UPDATE profiles SET display_name = username
WHERE display_name LIKE '%@%' OR display_name IS NULL OR btrim(display_name) = '';

-- ユーザーIDは一意（アカウント名 display_name は重複OK＝制約を付けない）
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_key ON profiles (username);

-- アカウント名・ユーザーIDの部分一致検索用
CREATE INDEX IF NOT EXISTS profiles_display_name_trgm_idx
  ON profiles USING gin (display_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS profiles_username_trgm_idx
  ON profiles USING gin (username gin_trgm_ops);


-- ============================================================
-- 2. posts: 公開フラグ と 地域カラム
-- ============================================================

-- 初期は非公開。ユーザーが明示的に公開に切り替える。
ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_public   BOOLEAN NOT NULL DEFAULT false;

-- 投稿時に Google Geocoding で逆ジオコーディングして格納する
ALTER TABLE posts ADD COLUMN IF NOT EXISTS prefecture  TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS city        TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS station     TEXT;

CREATE INDEX IF NOT EXISTS posts_prefecture_idx ON posts (prefecture);
CREATE INDEX IF NOT EXISTS posts_city_idx       ON posts (prefecture, city);
CREATE INDEX IF NOT EXISTS posts_station_idx    ON posts (prefecture, city, station);
CREATE INDEX IF NOT EXISTS posts_user_created_idx ON posts (user_id, created_at DESC);


-- ============================================================
-- 3. follows: 承認制（非公開アカウント用）
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'follow_status') THEN
    CREATE TYPE follow_status AS ENUM ('pending', 'accepted');
  END IF;
END $$;

ALTER TABLE follows ADD COLUMN IF NOT EXISTS status follow_status NOT NULL DEFAULT 'accepted';

CREATE INDEX IF NOT EXISTS follows_following_idx ON follows (following_id, status);
CREATE INDEX IF NOT EXISTS follows_follower_idx  ON follows (follower_id,  status);

-- 自分自身をフォローできないようにする
ALTER TABLE follows DROP CONSTRAINT IF EXISTS follows_no_self;
ALTER TABLE follows ADD  CONSTRAINT follows_no_self CHECK (follower_id <> following_id);


-- ============================================================
-- 4. App Store 必須: ブロック / 通報
--    Guideline 1.2 (UGCアプリ) に対応
-- ============================================================

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT blocks_no_self CHECK (blocker_id <> blocked_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reporter_id   UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  target_post_id UUID REFERENCES posts(id)    ON DELETE CASCADE,
  target_user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  reason        TEXT NOT NULL,
  detail        TEXT DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'open',  -- open / reviewed / actioned
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT reports_target_present
    CHECK (target_post_id IS NOT NULL OR target_user_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS reports_status_idx ON reports (status, created_at DESC);


-- ============================================================
-- 5. 補助関数（RLSの相互再帰を避けるため SECURITY DEFINER）
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_profile_public(target UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT is_public FROM profiles WHERE id = target), false);
$$;

CREATE OR REPLACE FUNCTION public.is_following(target UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM follows
    WHERE follower_id = auth.uid() AND following_id = target AND status = 'accepted'
  );
$$;

-- どちらかがブロックしていれば true
CREATE OR REPLACE FUNCTION public.has_block_with(target UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM blocks
    WHERE (blocker_id = auth.uid() AND blocked_id = target)
       OR (blocker_id = target      AND blocked_id = auth.uid())
  );
$$;

-- 投稿が閲覧可能か: 本人 / (公開投稿 かつ (公開アカウント or フォロー済)) かつ 非ブロック
CREATE OR REPLACE FUNCTION public.can_view_post(p_user_id UUID, p_is_public BOOLEAN)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p_user_id = auth.uid()
    OR (
      p_is_public
      AND NOT public.has_block_with(p_user_id)
      AND (public.is_profile_public(p_user_id) OR public.is_following(p_user_id))
    );
$$;


-- ============================================================
-- 6. RLS 貼り直し
-- ============================================================

ALTER TABLE blocks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- ---- posts -------------------------------------------------
DROP POLICY IF EXISTS "誰でも閲覧可"     ON posts;
DROP POLICY IF EXISTS "posts_select"     ON posts;
CREATE POLICY "posts_select" ON posts FOR SELECT
  USING (public.can_view_post(user_id, is_public));

-- ---- post_images: 親投稿の可視性に従う ----------------------
DROP POLICY IF EXISTS "誰でも閲覧可"           ON post_images;
DROP POLICY IF EXISTS "認証ユーザーのみ挿入可" ON post_images;
DROP POLICY IF EXISTS "認証ユーザーのみ削除可" ON post_images;
DROP POLICY IF EXISTS "post_images_select"     ON post_images;
DROP POLICY IF EXISTS "post_images_insert"     ON post_images;
DROP POLICY IF EXISTS "post_images_delete"     ON post_images;

CREATE POLICY "post_images_select" ON post_images FOR SELECT
  USING (EXISTS (SELECT 1 FROM posts p WHERE p.id = post_images.post_id));
CREATE POLICY "post_images_insert" ON post_images FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM posts p WHERE p.id = post_images.post_id AND p.user_id = auth.uid()));
CREATE POLICY "post_images_delete" ON post_images FOR DELETE
  USING (EXISTS (SELECT 1 FROM posts p WHERE p.id = post_images.post_id AND p.user_id = auth.uid()));

-- ---- profiles ----------------------------------------------
-- ★ 旧ポリシー "誰でも閲覧可" USING (true) を必ず消す。
--   RLSの許可ポリシーはORで結合されるため、残っていると
--   ブロックしても相手に見えてしまう（実測で検出したバグ）。
DROP POLICY IF EXISTS "誰でも閲覧可"   ON profiles;
DROP POLICY IF EXISTS "profiles_select" ON profiles;
-- プロフィール自体は検索のため閲覧可（投稿はRLSで守られる）。
-- ただしブロック相手からは見えない。
CREATE POLICY "profiles_select" ON profiles FOR SELECT
  USING (id = auth.uid() OR NOT public.has_block_with(id));

-- ---- likes / comments: 親投稿が見える場合のみ ---------------
-- 旧 USING(true) のままだと、非公開投稿への いいね/コメント が
-- 第三者から数えられてしまう。
DROP POLICY IF EXISTS "誰でも閲覧可"   ON likes;
DROP POLICY IF EXISTS "likes_select"   ON likes;
CREATE POLICY "likes_select" ON likes FOR SELECT
  USING (EXISTS (SELECT 1 FROM posts p WHERE p.id = likes.post_id));

DROP POLICY IF EXISTS "誰でも閲覧可"    ON comments;
DROP POLICY IF EXISTS "comments_select" ON comments;
CREATE POLICY "comments_select" ON comments FOR SELECT
  USING (EXISTS (SELECT 1 FROM posts p WHERE p.id = comments.post_id));

-- ---- follows -----------------------------------------------
DROP POLICY IF EXISTS "誰でも閲覧可"   ON follows;
DROP POLICY IF EXISTS "本人のみ操作可" ON follows;
DROP POLICY IF EXISTS "follows_select" ON follows;
DROP POLICY IF EXISTS "follows_insert" ON follows;
DROP POLICY IF EXISTS "follows_delete" ON follows;
DROP POLICY IF EXISTS "follows_update" ON follows;

CREATE POLICY "follows_select" ON follows FOR SELECT USING (true);
-- 申請は本人のみ。accepted/pending の判定はサーバー側トリガーが強制するため
-- クライアントは status を送らなくてよい（送っても上書きされる）。
CREATE POLICY "follows_insert" ON follows FOR INSERT
  WITH CHECK (
    follower_id = auth.uid()
    AND NOT public.has_block_with(following_id)
  );
-- フォロー解除は本人、申請の削除(拒否)は相手も可
CREATE POLICY "follows_delete" ON follows FOR DELETE
  USING (follower_id = auth.uid() OR following_id = auth.uid());
-- 承認できるのはフォローされる側だけ
CREATE POLICY "follows_update" ON follows FOR UPDATE
  USING (following_id = auth.uid()) WITH CHECK (following_id = auth.uid());

-- ---- blocks ------------------------------------------------
DROP POLICY IF EXISTS "blocks_all" ON blocks;
CREATE POLICY "blocks_all" ON blocks FOR ALL
  USING (blocker_id = auth.uid()) WITH CHECK (blocker_id = auth.uid());

-- ---- reports -----------------------------------------------
DROP POLICY IF EXISTS "reports_insert" ON reports;
DROP POLICY IF EXISTS "reports_select" ON reports;
CREATE POLICY "reports_insert" ON reports FOR INSERT WITH CHECK (reporter_id = auth.uid());
CREATE POLICY "reports_select" ON reports FOR SELECT USING (reporter_id = auth.uid());


-- ============================================================
-- 7. カウンタをトリガーで自動更新
--    （従来のクライアント側 手動UPDATE は競合でズレるため廃止）
-- ============================================================

-- 公開アカウントへのフォローは即時成立、非公開アカウントへは承認待ちにする。
-- クライアントが status を詐称しても、ここで必ず正しい値に矯正される。
CREATE OR REPLACE FUNCTION public.force_follow_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.status := CASE
    WHEN public.is_profile_public(NEW.following_id) THEN 'accepted'
    ELSE 'pending'
  END::follow_status;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_force_follow_status ON follows;
CREATE TRIGGER trg_force_follow_status
  BEFORE INSERT ON follows
  FOR EACH ROW EXECUTE FUNCTION public.force_follow_status();

CREATE OR REPLACE FUNCTION public.sync_follow_counts()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- accepted になったフォローだけを数える
  IF TG_OP = 'INSERT' AND NEW.status = 'accepted' THEN
    UPDATE profiles SET followers_count = followers_count + 1 WHERE id = NEW.following_id;
    UPDATE profiles SET following_count = following_count + 1 WHERE id = NEW.follower_id;
  ELSIF TG_OP = 'DELETE' AND OLD.status = 'accepted' THEN
    UPDATE profiles SET followers_count = GREATEST(followers_count - 1, 0) WHERE id = OLD.following_id;
    UPDATE profiles SET following_count = GREATEST(following_count - 1, 0) WHERE id = OLD.follower_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.status <> NEW.status THEN
    IF NEW.status = 'accepted' THEN
      UPDATE profiles SET followers_count = followers_count + 1 WHERE id = NEW.following_id;
      UPDATE profiles SET following_count = following_count + 1 WHERE id = NEW.follower_id;
    ELSE
      UPDATE profiles SET followers_count = GREATEST(followers_count - 1, 0) WHERE id = NEW.following_id;
      UPDATE profiles SET following_count = GREATEST(following_count - 1, 0) WHERE id = NEW.follower_id;
    END IF;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_follow_counts ON follows;
CREATE TRIGGER trg_follow_counts
  AFTER INSERT OR UPDATE OR DELETE ON follows
  FOR EACH ROW EXECUTE FUNCTION public.sync_follow_counts();

CREATE OR REPLACE FUNCTION public.sync_post_counts()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE profiles SET posts_count = posts_count + 1 WHERE id = NEW.user_id;
  ELSE
    UPDATE profiles SET posts_count = GREATEST(posts_count - 1, 0) WHERE id = OLD.user_id;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_post_counts ON posts;
CREATE TRIGGER trg_post_counts
  AFTER INSERT OR DELETE ON posts
  FOR EACH ROW EXECUTE FUNCTION public.sync_post_counts();

CREATE OR REPLACE FUNCTION public.sync_like_counts()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
  ELSE
    UPDATE posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_like_counts ON likes;
CREATE TRIGGER trg_like_counts
  AFTER INSERT OR DELETE ON likes
  FOR EACH ROW EXECUTE FUNCTION public.sync_like_counts();

CREATE OR REPLACE FUNCTION public.sync_comment_counts()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
  ELSE
    UPDATE posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_comment_counts ON comments;
CREATE TRIGGER trg_comment_counts
  AFTER INSERT OR DELETE ON comments
  FOR EACH ROW EXECUTE FUNCTION public.sync_comment_counts();


-- ============================================================
-- 8. 新規ユーザー作成トリガーを修正
--    ★ メールアドレスから表示名を作るのをやめ、
--      サインアップ時に渡された display_name / username を使う
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_username TEXT;
  v_display  TEXT;
BEGIN
  v_username := lower(COALESCE(NEW.raw_user_meta_data->>'username', ''));
  v_display  := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'display_name', '')), '');

  -- username 未指定 or 形式不正なら自動採番（OAuth経由など）
  IF v_username !~ '^[a-z]{3,20}$' THEN
    v_username := 'user' || translate(substr(replace(NEW.id::text, '-', ''), 1, 10),
                                      '0123456789', 'abcdefghij');
  END IF;

  -- 万一衝突したら末尾を伸ばして回避
  WHILE EXISTS (SELECT 1 FROM profiles WHERE username = v_username) LOOP
    v_username := substr(v_username, 1, 16) || translate(substr(md5(random()::text), 1, 4),
                                                         '0123456789', 'abcdefghij');
  END LOOP;

  INSERT INTO public.profiles (id, username, display_name, photo_url)
  VALUES (
    NEW.id,
    v_username,
    COALESCE(v_display, v_username),   -- メールアドレスは絶対に使わない
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ============================================================
-- 9. RPC: 地域別の投稿数（県 → 市区町村 → 駅）
--    SECURITY INVOKER なので posts のRLSがそのまま効き、
--    「自分が見られる投稿」だけが集計される。
-- ============================================================

CREATE OR REPLACE FUNCTION public.post_counts_by_region(
  p_level      TEXT,                 -- 'prefecture' | 'city' | 'station'
  p_prefecture TEXT DEFAULT NULL,
  p_city       TEXT DEFAULT NULL
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
      WHEN 'city'       THEN p.city
      ELSE                   p.station
    END                    AS name,
    COUNT(*)               AS post_count,
    AVG(p.location_lat)    AS center_lat,
    AVG(p.location_lng)    AS center_lng
  FROM posts p
  WHERE (p_prefecture IS NULL OR p.prefecture = p_prefecture)
    AND (p_city       IS NULL OR p.city       = p_city)
    AND CASE p_level
          WHEN 'prefecture' THEN p.prefecture
          WHEN 'city'       THEN p.city
          ELSE                   p.station
        END IS NOT NULL
  GROUP BY 1
  ORDER BY 2 DESC;
$$;


-- ============================================================
-- 10. RPC: ユーザーID の空き確認（サインアップ前に呼ぶ）
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_username_available(p_username TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_username ~ '^[a-z]{3,20}$'
     AND NOT EXISTS (SELECT 1 FROM profiles WHERE username = p_username);
$$;

GRANT EXECUTE ON FUNCTION public.is_username_available(TEXT) TO anon, authenticated;


-- ============================================================
-- 10b. RPC: 自分がブロックした相手の一覧
--   profiles の RLS はブロック相手を隠すため、通常の JOIN では
--   0 件になってしまう。解除UIのために SECURITY DEFINER で取り出す。
-- ============================================================

CREATE OR REPLACE FUNCTION public.my_blocked_accounts()
RETURNS TABLE (id UUID, username TEXT, display_name TEXT, photo_url TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.username, p.display_name, p.photo_url
  FROM blocks b
  JOIN profiles p ON p.id = b.blocked_id
  WHERE b.blocker_id = auth.uid()
  ORDER BY b.created_at DESC;
$$;

REVOKE ALL    ON FUNCTION public.my_blocked_accounts() FROM public;
GRANT EXECUTE ON FUNCTION public.my_blocked_accounts() TO authenticated;


-- ============================================================
-- 11. RPC: アカウント削除（App Store Guideline 5.1.1(v) 必須）
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  -- profiles は auth.users への ON DELETE CASCADE で連鎖削除される
  DELETE FROM auth.users WHERE id = auth.uid();
END $$;

REVOKE ALL   ON FUNCTION public.delete_my_account() FROM public;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;


-- ============================================================
-- 12. カウンタ再集計（移行時に一度だけ整合させる）
-- ============================================================

UPDATE profiles pr SET
  posts_count     = (SELECT COUNT(*) FROM posts   p WHERE p.user_id      = pr.id),
  followers_count = (SELECT COUNT(*) FROM follows f WHERE f.following_id = pr.id AND f.status = 'accepted'),
  following_count = (SELECT COUNT(*) FROM follows f WHERE f.follower_id  = pr.id AND f.status = 'accepted');

UPDATE posts p SET
  likes_count    = (SELECT COUNT(*) FROM likes    l WHERE l.post_id = p.id),
  comments_count = (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id);

COMMIT;
