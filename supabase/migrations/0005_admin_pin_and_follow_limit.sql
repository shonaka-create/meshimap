-- ============================================================
-- MeshiMap 移行 0005
--   1. 運営アカウントは全員に必ず見える
--   2. フォローの上限（無料は2人まで / 運営は数えない）
--   3. 課金状態を保持する subscriptions
--
-- 背景:
--   運営アカウントは、飲食店に掲載営業をかけるための枠になる。
--   「フォローしていないと見えない」ままだと掲載の価値が出ないので、
--   フォロー関係に関わらず必ず地図に出るようにする。
--
--   一方で一般ユーザーのフォローは無料2人までとし、
--   3人目以降を課金対象にする。運営はこの数に含めない
--   （運営を数えると、実質1人しかフォローできなくなるため）。
--
-- Supabase SQL Editor に貼り付けて実行。冪等。
-- ============================================================

BEGIN;

-- ============================================================
-- 1. 補助関数
-- ============================================================

-- 既存の is_admin() は「今のログインユーザーが管理者か」を見る。
-- ここでは「指定したユーザーが管理者か」を見たいので別に用意する。
CREATE OR REPLACE FUNCTION public.is_admin_user(p_user UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT pr.is_admin FROM profiles pr WHERE pr.id = p_user), false);
$$;


-- ============================================================
-- 2. 課金状態
--
--    ★ 決済業者を1つに決め打ちしない。
--      iOS アプリ内の課金は Apple の App内課金が必須になる可能性が高く、
--      Web からは Stripe を使う、という二本立てになりうる。
--      「誰が契約中か」の判定はどちらでも同じにしておきたいので、
--      業者固有の ID は provider + external_* に寄せてある。
--
--    書き込むのは Webhook（service_role）だけ。
--    クライアントには参照だけ許し、更新ポリシーは作らない
--    （RLS は既定で拒否なので、ポリシーが無い＝書けない）。
--
--    ※ カード番号などの決済情報はここにも他のどこにも保存しない。
--      決済画面は業者側（Stripe / Apple）で完結させ、
--      こちらは「契約中かどうか」だけを受け取る。
-- ============================================================

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id                  UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  -- 'stripe' | 'apple'
  provider                 TEXT NOT NULL DEFAULT 'stripe',
  -- Stripe なら customer / subscription、Apple なら originalTransactionId など
  external_customer_id     TEXT,
  external_subscription_id TEXT,
  -- active / trialing / past_due / canceled / incomplete / inactive
  status                   TEXT NOT NULL DEFAULT 'inactive',
  current_period_end       TIMESTAMPTZ,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT subscriptions_provider_check CHECK (provider IN ('stripe', 'apple'))
);

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_external_sub_idx
  ON subscriptions (provider, external_subscription_id)
  WHERE external_subscription_id IS NOT NULL;

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subscriptions_select" ON subscriptions;
CREATE POLICY "subscriptions_select" ON subscriptions FOR SELECT
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS subscriptions_status_idx ON subscriptions (status);

-- 契約中か。past_due（支払い失敗中）は猶予を持たせず対象外にする。
CREATE OR REPLACE FUNCTION public.is_subscribed(p_user UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM subscriptions s
    WHERE s.user_id = p_user
      AND s.status IN ('active', 'trialing')
      AND (s.current_period_end IS NULL OR s.current_period_end > NOW())
  );
$$;


-- ============================================================
-- 3. フォローの上限
--
--    無料は運営を除いて2人まで。
--    ★ この数を変えるときは mobile/src/lib/limits.ts も合わせること。
--
--    クライアント側のチェックだけだと API を直接叩けば回避できるので、
--    トリガーで止める。エラーメッセージは端末側で日本語に変換するため
--    識別しやすい固定文字列にしてある。
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_follow_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_used INT;
BEGIN
  -- 運営アカウントへのフォローは無制限（掲載枠なので数に入れない）
  IF public.is_admin_user(NEW.following_id) THEN
    RETURN NEW;
  END IF;

  IF public.is_subscribed(NEW.follower_id) THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_used
  FROM follows f
  JOIN profiles p ON p.id = f.following_id
  WHERE f.follower_id = NEW.follower_id
    AND NOT p.is_admin;

  IF v_used >= 2 THEN
    RAISE EXCEPTION 'follow_limit_reached'
      USING HINT = '無料では2人までフォローできます';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_follow_limit ON follows;
CREATE TRIGGER trg_enforce_follow_limit
  BEFORE INSERT ON follows
  FOR EACH ROW EXECUTE FUNCTION public.enforce_follow_limit();

-- 端末から「あと何人フォローできるか」を出すための関数。
-- 上限そのものは上のトリガーが持っているので、ここは表示専用。
CREATE OR REPLACE FUNCTION public.my_follow_quota()
RETURNS TABLE (used INT, limit_count INT, subscribed BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    (SELECT COUNT(*)::INT
       FROM follows f JOIN profiles p ON p.id = f.following_id
      WHERE f.follower_id = auth.uid() AND NOT p.is_admin),
    2,
    public.is_subscribed(auth.uid());
$$;


-- ============================================================
-- 4. 運営アカウントを必ず見えるようにする
--
--    (a) 新規登録時に自動でフォローする（Fav やフィードに出るように）
--    (b) フォローの有無に関わらず地図には必ず出す
--        … 利用者が運営を外しても掲載が消えないようにするため
-- ============================================================

-- (a) サインアップ時の処理に「運営を自動フォロー」を足す。
--     0001 で作った handle_new_user を置き換える。
--     ★ メールアドレスは display_name に絶対に使わないこと（0001 の趣旨）。
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_username TEXT;
  v_display  TEXT;
BEGIN
  v_username := lower(COALESCE(NEW.raw_user_meta_data->>'username', ''));
  v_display  := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'display_name', '')), '');

  IF v_username !~ '^[a-z]{3,20}$' THEN
    v_username := 'user' || translate(substr(replace(NEW.id::text, '-', ''), 1, 10),
                                      '0123456789', 'abcdefghij');
  END IF;

  INSERT INTO public.profiles (id, username, display_name, photo_url)
  VALUES (
    NEW.id,
    v_username,
    COALESCE(v_display, v_username),   -- メールアドレスは絶対に使わない
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;

  -- 運営アカウントを自動フォロー。
  -- 上限トリガーは管理者を数えないので、ここで枠は消費されない。
  INSERT INTO public.follows (follower_id, following_id)
  SELECT NEW.id, pr.id
  FROM public.profiles pr
  WHERE pr.is_admin AND pr.id <> NEW.id
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 既存ユーザーにも運営フォローを入れる
INSERT INTO follows (follower_id, following_id)
SELECT me.id, adm.id
FROM profiles me
CROSS JOIN profiles adm
WHERE adm.is_admin AND me.id <> adm.id
ON CONFLICT DO NOTHING;

-- (b) 地図。運営はフォローの有無に関わらず出す。
-- 返す列が増えるため、CREATE OR REPLACE では置き換えられない（戻り値の型が変わる）
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
      OR EXISTS (
        SELECT 1 FROM follows f
        WHERE f.follower_id = auth.uid()
          AND f.following_id = p.user_id
          AND f.status = 'accepted'
      )
    )
  ORDER BY p.user_id, p.created_at DESC;
$$;

-- 運営の紹介ページは、ブロック等に関わらず必ず引けるようにする。
-- （profiles_select は 0001 で「ブロック相手からは見えない」にしてある。
--   運営をブロックして掲載を消せてしまうと営業上の約束が守れない）
DROP POLICY IF EXISTS "profiles_select" ON profiles;
CREATE POLICY "profiles_select" ON profiles FOR SELECT
  USING (is_admin OR id = auth.uid() OR NOT public.has_block_with(id));

COMMIT;
