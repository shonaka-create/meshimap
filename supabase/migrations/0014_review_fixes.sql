-- ============================================================
-- MeshiMap 移行 0014
--   レビュー(2026-08-29)で見つかった3件を直す
--
--   1. Storage へのアップロードが自分のフォルダに限られていない
--   2. 月間ランキングがブロックを迂回して相手を見せる
--   3. 承認待ち(pending)のフォローが「地図に出せる人数」の枠を食う
--
-- Supabase SQL Editor に貼り付けて実行。冪等。
-- ============================================================

BEGIN;

-- ============================================================
-- 前提の確認
-- ============================================================

DO $$
BEGIN
  IF to_regprocedure('public.has_block_with(uuid)') IS NULL THEN
    RAISE EXCEPTION
      '移行 0001 が未適用です。先に 0001_accounts_privacy_regions.sql を実行してください。'
      USING HINT = 'supabase/check_state.sql を実行すると、どこまで適用済みかを一覧で確認できます。';
  END IF;

  IF to_regprocedure('public.free_map_users()') IS NULL THEN
    RAISE EXCEPTION
      '移行 0013 が未適用です。先に 0013_map_audience_gate.sql を実行してください。'
      USING HINT = 'supabase/check_state.sql を実行すると、どこまで適用済みかを一覧で確認できます。';
  END IF;
END $$;


-- ============================================================
-- 1. Storage: アップロードを自分のフォルダに限る
--
-- 何が起きていたか:
--   schema.sql の INSERT ポリシーは「ログインしていて、
--   バケットが post-images か avatars ならよい」だけだった。
--   アプリ側は `${uid}/...` というパスで上げているし、
--   コメントにも「先頭フォルダ = 自分のUID を要求する」と
--   書いてあるが、DB はそれを一度も確かめていない。
--
--   つまりログインさえしていれば、誰でも
--   他人のUIDの下や、まったく無関係なパスへ、
--   任意のファイルを置ける。両バケットは public なので、
--   投稿にも通報にもモデレーションにも乗らない
--   公開ファイル置き場として使えてしまう。
--
--   さらに DELETE ポリシーだけは先頭フォルダを見ているため、
--   他人のフォルダに置いたものは置いた本人にも消せない。
--
-- ★ SELECT は public バケットの意味そのものなので触らない。
--   写真は投稿から誰でも開ける前提で作ってある。
--
-- ★ UPDATE を足すのは upsert のため。
--   アプリは upload(..., { upsert: true }) を使う。
--   同じパスが既にあると UPDATE になるが、UPDATE の
--   ポリシーが1つも無いと必ず弾かれる。自分のフォルダに限って通す。
-- ============================================================

DROP POLICY IF EXISTS "認証ユーザーのみアップロード可" ON storage.objects;
DROP POLICY IF EXISTS "本人のフォルダのみアップロード可" ON storage.objects;
CREATE POLICY "本人のフォルダのみアップロード可" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id IN ('post-images', 'avatars')
    AND auth.uid() IS NOT NULL
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "本人のフォルダのみ更新可" ON storage.objects;
CREATE POLICY "本人のフォルダのみ更新可" ON storage.objects FOR UPDATE
  USING (
    bucket_id IN ('post-images', 'avatars')
    AND auth.uid()::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id IN ('post-images', 'avatars')
    AND auth.uid()::text = (storage.foldername(name))[1]
  );


-- ============================================================
-- 2. 月間ランキング: ブロックした相手を出さない
--
-- 何が起きていたか:
--   profiles の SELECT ポリシー（0001）は、ブロック関係にある
--   相手を隠す。ところが monthly_ranking() は SECURITY DEFINER で
--   profiles を直接 JOIN していたため、そのポリシーを通らない。
--   ブロックした相手が上位に入っていれば、
--   アカウント名・ユーザーID・アイコンがそのまま出ていた。
--
--   ブロックの説明文は「お互いの投稿とプロフィールが見えなくなります」
--   なので、言っていることと違う（Guideline 1.2）。
--
-- ★ SECURITY DEFINER は外せない。
--   順位を出すには他人の集計を読む必要があるため。
--   代わりに、定義者権限で読んだあとに自分でブロックを見る。
--
-- ★ 順位と total_entrants は絞る前の値のままにする。
--   ブロックした人数ぶん順位が繰り上がると、
--   同じ月の同じ人の順位が、見る人によって変わってしまう。
-- ============================================================

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
    -- ブロック関係にある相手は出さない。
    -- profiles の RLS と同じ線を、定義者権限の中で自分で引く。
    AND (b.user_id = auth.uid() OR NOT public.has_block_with(b.user_id))
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
-- 3. 地図の枠: 承認待ちのフォローを数えない
--
-- 何が起きていたか:
--   「地図に何人出しているか」を数えている場所が4つあり、
--   status の扱いが揃っていなかった。
--
--     my_map_quota()                … accepted だけ数える  ← 正
--     map_pins()                    … accepted だけ出す    ← 正
--     set_follow_on_map_default()   … status を見ていない  ← 誤
--     set_map_visible()             … status を見ていない  ← 誤
--
--   非公開アカウントへのフォローは pending で入る（0001 の
--   force_follow_status）。この行にも on_map が true で付くため、
--   承認されていない相手が枠を先に埋めてしまう。
--
--   その結果:
--     ・地図には誰も出ていないのに「地図に出せるのは2人までです」
--     ・新しくフォローした公開アカウントが地図に出てこない
--     ・引き出しの表示は「0人 / 2人」なのに、出そうとすると弾かれる
--
--   数える側を accepted に揃えて直す。
--
-- ★ 承認された時点で数え直すこと。
--   pending の行は on_map を false で入れておき、
--   承認された瞬間に空きがあるかを見る。
--   ここが無いと、承認待ちが3件まとめて承認されたときに
--   3人とも on_map = true のまま残る。
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

  -- 承認待ちは地図に出ない。枠を決めるのは承認されたときにする。
  IF NEW.status <> 'accepted' THEN
    NEW.on_map := false;
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_used
  FROM follows f
  JOIN profiles p ON p.id = f.following_id
  WHERE f.follower_id = NEW.follower_id
    AND f.status = 'accepted'
    AND f.on_map
    AND NOT p.is_admin;

  NEW.on_map := (v_used < public.free_map_users());
  RETURN NEW;
END $$;

-- 承認された瞬間に、空きがあれば地図に出す。
CREATE OR REPLACE FUNCTION public.set_follow_on_map_on_accept()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_used INT;
BEGIN
  -- 承認以外の更新（set_map_visible による on_map の切り替えなど）は触らない
  IF NEW.status <> 'accepted' OR OLD.status = 'accepted' THEN
    RETURN NEW;
  END IF;

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
    AND f.status = 'accepted'
    AND f.on_map
    AND NOT p.is_admin
    AND f.following_id <> NEW.following_id;

  NEW.on_map := (v_used < public.free_map_users());
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_set_follow_on_map_accept ON follows;
CREATE TRIGGER trg_set_follow_on_map_accept
  BEFORE UPDATE ON follows
  FOR EACH ROW EXECUTE FUNCTION public.set_follow_on_map_on_accept();


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
    -- ★ 承認済みだけを数えること。
    --   承認待ちまで数えると、地図に誰も出ていないのに
    --   map_limit_reached で弾かれる（my_map_quota は
    --   承認済みしか数えないので、画面の数字とも食い違う）。
    SELECT COUNT(*) INTO v_used
    FROM follows f
    JOIN profiles p ON p.id = f.following_id
    WHERE f.follower_id = auth.uid()
      AND f.status = 'accepted'
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
-- 4. 既存データの手当て
--
--    承認待ちの行に付いてしまった on_map を落とす。
--    落としても地図の見え方は変わらない（map_pins は
--    もともと accepted しか出さない）。変わるのは
--    「枠が空く」ことだけなので、そのまま流してよい。
-- ============================================================

UPDATE follows SET on_map = false
 WHERE status <> 'accepted' AND on_map;

COMMIT;
