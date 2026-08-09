-- ============================================================
-- MeshiMap 移行 0008
--   1. インプレッション（表示回数）の計測
--   2. 注目フラグ（直近よく見られている投稿を自動で立てる）
--   3. 月ごとに入れ替わる多段ランク
--
-- 設計の前提:
--   ・数えるのは「公開投稿を、投稿者以外が見たとき」だけ。
--     自分で開いて数字を伸ばせると、注目もランクも意味を失う。
--   ・同じ人が同じ投稿を何度開いても 1日1回しか数えない。
--     リロードで伸ばせる数字は、指標ではなく操作対象になってしまう。
--     「何回開かれたか」ではなく「何人に届いたか」を数えている。
--   ・誰が見たかは本人にも見せない。閲覧履歴は覗かれると気まずい情報で、
--     見せることで得られるものより失うものが大きい。
--     そのため post_impressions には RLS ポリシーを1つも作らない
--     （RLS 有効 + ポリシー無し = 誰も直接読めない）。書き込みも
--     下の SECURITY DEFINER 関数を通したときだけ通る。
--
-- 日付の区切りは日本時間。UTC で切ると深夜の投稿が前日扱いになる。
--
-- Supabase SQL Editor に貼り付けて実行。冪等。
-- ============================================================

BEGIN;

-- ============================================================
-- 前提の確認
--
-- 番号を飛ばして流すと素の PostgreSQL のエラーになり、
-- どれを流し直せばよいか分からない。ここで先に見て番号で答える。
-- 一覧は supabase/check_state.sql で出せる。
-- ============================================================

DO $$
BEGIN
  IF to_regprocedure('public.can_view_post(uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION
      '移行 0001 が未適用です。先に 0001_accounts_privacy_regions.sql から順に実行してください。'
      USING HINT = 'supabase/check_state.sql を実行すると、どこまで適用済みかを一覧で確認できます。';
  END IF;
END $$;


-- ============================================================
-- 0. 共通の設定値
--
--    しきい値をあちこちに散らすと、片方だけ直したときに
--    「バッジは出ているのに条件を満たしていない」状態になる。
--    ★ mobile/src/lib/impressions.ts の値と必ず揃えること。
-- ============================================================

-- 注目に必要な「直近の閲覧人数」
CREATE OR REPLACE FUNCTION public.featured_threshold()
RETURNS INT LANGUAGE sql IMMUTABLE AS $$ SELECT 20 $$;

-- 注目の集計期間 兼 表示期間（日）
CREATE OR REPLACE FUNCTION public.featured_window_days()
RETURNS INT LANGUAGE sql IMMUTABLE AS $$ SELECT 7 $$;

-- 日本時間での「今日」
CREATE OR REPLACE FUNCTION public.jst_today()
RETURNS DATE LANGUAGE sql STABLE AS $$
  SELECT (NOW() AT TIME ZONE 'Asia/Tokyo')::date;
$$;

-- 日本時間での「今月の1日」
CREATE OR REPLACE FUNCTION public.jst_month()
RETURNS DATE LANGUAGE sql STABLE AS $$
  SELECT date_trunc('month', (NOW() AT TIME ZONE 'Asia/Tokyo'))::date;
$$;


-- ============================================================
-- 1. 計測用のテーブルと列
-- ============================================================

-- 投稿側の集計値。ここを読むだけでバッジも数字も出せるようにする。
ALTER TABLE posts ADD COLUMN IF NOT EXISTS impressions_count INT NOT NULL DEFAULT 0;
-- 注目に「最後に達していた」時刻。NULL なら一度も達していない。
ALTER TABLE posts ADD COLUMN IF NOT EXISTS featured_at TIMESTAMPTZ;

-- 投稿者側の通算。プロフィールの「どれだけ届いたか」に使う。
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS impressions_count INT NOT NULL DEFAULT 0;

-- 1人1投稿1日1回。主キーがそのまま重複除去になる。
CREATE TABLE IF NOT EXISTS post_impressions (
  post_id    UUID REFERENCES posts(id)    ON DELETE CASCADE NOT NULL,
  viewer_id  UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  viewed_on  DATE NOT NULL DEFAULT public.jst_today(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, viewer_id, viewed_on)
);

-- 注目判定は「直近N日ぶんを投稿ごとに数える」ので、この並びの索引が要る
CREATE INDEX IF NOT EXISTS post_impressions_recent_idx
  ON post_impressions (post_id, created_at DESC);

ALTER TABLE post_impressions ENABLE ROW LEVEL SECURITY;
-- ★ ポリシーは作らない。閲覧履歴は誰にも直接触らせない。
--   過去に作ってしまっていた場合に備えて明示的に落としておく。
DROP POLICY IF EXISTS "post_impressions_select" ON post_impressions;
DROP POLICY IF EXISTS "post_impressions_insert" ON post_impressions;

-- 注目の投稿を引くとき用
CREATE INDEX IF NOT EXISTS posts_featured_idx
  ON posts (featured_at DESC) WHERE featured_at IS NOT NULL;


-- ============================================================
-- 2. 月ごとの集計
--
--    ランクを「通算」で決めると、先に始めた人が上に居座り続けて
--    後から入った人には追いつく道がない。月で区切って毎月入れ替える。
--    過去の月も残すので、いつが良かったかを後から振り返れる。
-- ============================================================

CREATE TABLE IF NOT EXISTS profile_monthly_impressions (
  user_id     UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  -- 月初日（日本時間）
  period      DATE NOT NULL,
  impressions INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, period)
);

-- ランキングは「その月の多い順」に引く
CREATE INDEX IF NOT EXISTS profile_monthly_impressions_rank_idx
  ON profile_monthly_impressions (period, impressions DESC);

ALTER TABLE profile_monthly_impressions ENABLE ROW LEVEL SECURITY;

-- 集計値は誰でも見てよい（順位を出すのに要る）。
-- 「誰が見たか」はここには入っていないので、これで漏れるものは無い。
DROP POLICY IF EXISTS "profile_monthly_impressions_select" ON profile_monthly_impressions;
CREATE POLICY "profile_monthly_impressions_select"
  ON profile_monthly_impressions FOR SELECT USING (true);
-- 書き込みポリシーは作らない（下のトリガーだけが更新する）

-- 月間ランクの段位。
--   0 ランク外 / 1 芽 / 2 灯 / 3 常連客 / 4 今月の顔
-- ★ mobile/src/lib/impressions.ts の MONTHLY_TIERS と揃えること。
CREATE OR REPLACE FUNCTION public.monthly_tier(p_impressions INT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_impressions >= 8000 THEN 4
    WHEN p_impressions >= 2000 THEN 3
    WHEN p_impressions >=  500 THEN 2
    WHEN p_impressions >=  100 THEN 1
    ELSE 0
  END;
$$;


-- ============================================================
-- 3. 1件数えたときに走る処理
--
--    投稿・投稿者・今月、の3か所を進めて、最後に注目を判定する。
--    毎回まとめて数え直すのではなく差分で足すのは、
--    投稿が増えても1件あたりの重さが変わらないようにするため。
-- ============================================================

CREATE OR REPLACE FUNCTION public.apply_impression()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_author UUID;
  v_recent INT;
BEGIN
  UPDATE posts
     SET impressions_count = impressions_count + 1
   WHERE id = NEW.post_id
  RETURNING user_id INTO v_author;

  IF v_author IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE profiles
     SET impressions_count = impressions_count + 1
   WHERE id = v_author;

  INSERT INTO profile_monthly_impressions (user_id, period, impressions)
  VALUES (v_author, public.jst_month(), 1)
  ON CONFLICT (user_id, period)
  DO UPDATE SET impressions = profile_monthly_impressions.impressions + 1;

  -- 注目の判定。
  -- 通算ではなく直近だけを見る。通算で決めると、古い人気投稿が
  -- 「いま注目されているもの」の枠を永久に占めてしまう。
  SELECT COUNT(*) INTO v_recent
  FROM post_impressions pi
  WHERE pi.post_id = NEW.post_id
    AND pi.created_at > NOW() - (public.featured_window_days() || ' days')::interval;

  IF v_recent >= public.featured_threshold() THEN
    -- 達している間は時刻を更新し続ける。閲覧が止まれば更新も止まり、
    -- 期間が過ぎた時点で自然に注目から外れる（掃除の仕組みが要らない）。
    UPDATE posts SET featured_at = NOW() WHERE id = NEW.post_id;
  END IF;

  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_apply_impression ON post_impressions;
CREATE TRIGGER trg_apply_impression
  AFTER INSERT ON post_impressions
  FOR EACH ROW EXECUTE FUNCTION public.apply_impression();


-- ============================================================
-- 4. 端末から呼ぶ入口
--
--    SECURITY DEFINER にしているのは post_impressions を
--    誰にも直接触らせないため。数える条件はすべてここで検査する。
--    端末側の判定だけに任せると、API を直接叩いて水増しできてしまう。
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_impression(p_post UUID)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_author UUID;
  v_public BOOLEAN;
  v_count  INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 0;
  END IF;

  SELECT p.user_id, p.is_public INTO v_author, v_public
  FROM posts p WHERE p.id = p_post;

  IF v_author IS NULL THEN
    RETURN 0;
  END IF;

  -- 自分の投稿は数えない
  IF v_author = auth.uid() THEN
    SELECT impressions_count INTO v_count FROM posts WHERE id = p_post;
    RETURN COALESCE(v_count, 0);
  END IF;

  -- 公開投稿だけを数える。
  -- あわせて can_view_post も見る。投稿が公開でも投稿者が非公開なら、
  -- フォロワー以外はそもそも見られない＝届いていないので数えない。
  IF NOT v_public OR NOT public.can_view_post(v_author, v_public) THEN
    SELECT impressions_count INTO v_count FROM posts WHERE id = p_post;
    RETURN COALESCE(v_count, 0);
  END IF;

  -- 同じ人・同じ日は重複しない（主キーで弾かれ、トリガーも走らない）
  INSERT INTO post_impressions (post_id, viewer_id, viewed_on)
  VALUES (p_post, auth.uid(), public.jst_today())
  ON CONFLICT DO NOTHING;

  SELECT impressions_count INTO v_count FROM posts WHERE id = p_post;
  RETURN COALESCE(v_count, 0);
END $$;


-- ============================================================
-- 5. 月間ランクの参照
-- ============================================================

-- 自分（または指定した人）の今月の成績。
-- 順位を出すのに他人の行を読む必要があるので SECURITY DEFINER。
CREATE OR REPLACE FUNCTION public.monthly_standing(p_user UUID DEFAULT NULL)
-- ★ 列名に position は使えない。RETURNS TABLE の名前は関数の引数として
--   扱われ、POSITION は SQL の関数名なので引数名にできない
--   （"syntax error at or near position" になる）。
RETURNS TABLE (
  user_id       UUID,
  period        DATE,
  impressions   INT,
  tier          INT,
  rank_position INT,
  entrants      INT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH target AS (
    SELECT COALESCE(p_user, auth.uid()) AS id
  ), board AS (
    SELECT
      m.user_id,
      m.impressions,
      (RANK() OVER (ORDER BY m.impressions DESC))::INT AS rank_position,
      (COUNT(*) OVER ())::INT                          AS entrants
    FROM profile_monthly_impressions m
    WHERE m.period = public.jst_month()
      AND m.impressions > 0
  )
  SELECT
    t.id,
    public.jst_month(),
    COALESCE(b.impressions, 0),
    public.monthly_tier(COALESCE(b.impressions, 0)),
    b.rank_position,   -- 0件ならランク外なので NULL
    -- ★ 別名で必ず修飾する。RETURNS TABLE の名前と同じ綴りを裸で書くと、
    --   列なのか関数の引数なのかが決まらず ambiguous になる。
    COALESCE((SELECT MAX(b2.entrants) FROM board b2), 0)
  FROM target t
  LEFT JOIN board b ON b.user_id = t.id
  WHERE t.id IS NOT NULL;
$$;

-- 今月の上位。プロフィールを結合して返す。
-- 非公開アカウントも「今月どれだけ届いたか」は公開情報にしてよい
-- （中身は出さず、名前と数字だけ）。
CREATE OR REPLACE FUNCTION public.monthly_ranking(p_limit INT DEFAULT 50)
RETURNS TABLE (
  user_id       UUID,
  username      TEXT,
  display_name  TEXT,
  photo_url     TEXT,
  avatar_emoji  TEXT,
  impressions   INT,
  tier          INT,
  rank_position INT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    m.user_id,
    pr.username,
    pr.display_name,
    pr.photo_url,
    pr.avatar_emoji,
    m.impressions,
    public.monthly_tier(m.impressions),
    (RANK() OVER (ORDER BY m.impressions DESC))::INT
  FROM profile_monthly_impressions m
  JOIN profiles pr ON pr.id = m.user_id
  WHERE m.period = public.jst_month()
    AND m.impressions > 0
  ORDER BY m.impressions DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
$$;

COMMIT;
