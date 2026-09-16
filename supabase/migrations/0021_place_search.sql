-- ============================================================
-- MeshiMap 移行 0021
--   店名で場所を探せるようにする（過去データ検索 ＋ 呼び出し回数の上限）
--
-- 背景:
--   投稿時の場所検索は、内蔵エリアデータと端末の地理コーダだけで動いていた。
--   どちらも駅名・地名・住所は引けるが、店名（例:「用心棒」）は引けない。
--   登録したい店をそのまま打っても何も出ないので、
--   最寄り駅で寄せてから地図でつまむしかなかった。
--
-- ここでやること:
--   1. place_search_usage … Places API を何回叩いたかを日ごとに数える
--   2. consume_place_search() … 上限内なら1回ぶん使う。超えていたら断る
--   3. known_places() … 過去の投稿の店名から候補を出す（費用ゼロ）
--
-- ★ 上限を「アプリ側だけ」で持たないこと。
--   端末のコードは書き換えられるので、柵はサーバー側（この関数）に置く。
--   Google Cloud の日次上限と二重にして、請求が青天井にならないようにする。
--
-- ★ known_places は SECURITY DEFINER にしないこと。
--   posts の RLS（can_view_post / 移行0001・0003）をそのまま効かせる。
--   DEFINER にすると、非公開投稿の店名と座標が検索候補として漏れる。
--
-- Supabase SQL Editor に貼り付けて実行。冪等。
-- ============================================================

BEGIN;

-- 前提の確認。番号を飛ばすと素の PostgreSQL のエラーになり、
-- どれを流し直せばよいか分からなくなる。
DO $$
BEGIN
  IF to_regprocedure('public.can_view_post(uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION '移行 0001 が未適用です。先に 0001_accounts_privacy_regions.sql から順に実行してください。'
      USING HINT = 'supabase/check_state.sql で適用状況を一覧できます。';
  END IF;
END $$;


-- ============================================================
-- 1. 呼び出し回数の記録
--
--    1行 = その日・その人の呼び出し回数。
--    全体の回数は、その日の行を合計して求める（利用者はまだ少なく、
--    1日ぶんの行を足すだけなので索引で足りる）。
--
--    ★ RLS を有効にしたまま、ポリシーを1つも作らないこと。
--      そうすると authenticated からは直接読み書きできず、
--      下の SECURITY DEFINER 関数を通したときだけ触れる。
--      端末から回数を書き換えて上限を外す、という抜け道を塞ぐ。
-- ============================================================
CREATE TABLE IF NOT EXISTS public.place_search_usage (
  day     DATE NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::DATE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  calls   INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (day, user_id)
);

ALTER TABLE public.place_search_usage ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS place_search_usage_day_idx
  ON public.place_search_usage (day);

-- ★ 全体の回数を、上の表の合計で求めないこと。
--   上の表は auth.users への CASCADE が付いているので、退会すると
--   その人の消費履歴ごと消える。合計で見ていると、実際には課金済みの
--   呼び出しが未使用に戻り、登録 → 使う → 退会 を繰り返すだけで
--   全体上限をいくらでも回避できる（delete_my_account / 移行0001）。
--
--   こちらの表は誰にも紐づかないので、退会しても減らない。
--   人ごとの上限は上の表、全体の上限はこの表、と役割を分ける。
CREATE TABLE IF NOT EXISTS public.place_search_total_usage (
  day   DATE PRIMARY KEY DEFAULT (now() AT TIME ZONE 'UTC')::DATE,
  calls INT NOT NULL DEFAULT 0
);

ALTER TABLE public.place_search_total_usage ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 2. 上限
--
--    Places の無料枠は SKU ごとに月10,000回（2025年の改定後）。
--    候補を出すのに1回、選ばれた店の座標を取るのに1回使うので、
--    1日の全体上限を 250 にしておくと 250 × 31 = 7,750 で月の枠に収まる。
--
--    1人あたりの上限は、1人が枠を食い尽くさないための柵。
--    投稿1件につき数回あれば足りるので、1日 40 回にしてある。
--
--    ★ 数字をここ以外に書かないこと。
--      サーバー（app/api/places/*）も端末も、この関数の値を使う。
-- ============================================================
CREATE OR REPLACE FUNCTION public.place_search_caps()
RETURNS TABLE (
  user_daily  INT,   -- 1人が1日に使える回数
  total_daily INT    -- 全員合わせて1日に使える回数
)
LANGUAGE sql IMMUTABLE AS $$
  SELECT 40, 250;
$$;


-- ============================================================
-- 3. 1回ぶん使う
--
--    上限内なら数えて TRUE を返し、超えていたら数えずに FALSE を返す。
--    数えるのと判定するのを1つの関数にしてあるのは、
--    「判定してから数える」の間に別の呼び出しが入ると上限を越えられるため。
--
--    ★ 断るときも画面を止めないこと。
--      呼び出し側は FALSE を受け取ったら、過去データ（known_places）と
--      内蔵エリアだけで候補を出す。検索そのものは使えるままにする。
-- ============================================================
CREATE OR REPLACE FUNCTION public.consume_place_search()
RETURNS TABLE (
  allowed         BOOLEAN,
  user_used_today INT,
  total_used_today INT,
  user_daily      INT,
  total_daily     INT
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_day   DATE := (now() AT TIME ZONE 'UTC')::DATE;
  v_caps  RECORD;
  v_user  INT;
  v_total INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です';
  END IF;

  -- ★ 数える前に鍵を取ること。
  --   「読んでから足す」の間に別の呼び出しが割り込むと、両方とも
  --   足す前の回数を見て上限を通過する（ON CONFLICT が守るのは足し算だけで、
  --   その前の判定は守らない）。残り1回のときに同時に叩かれると上限を越える。
  --   日付ごとの鍵で、判定と加算をまとめて直列にする。
  --   取引が終われば自動で外れる（xact ロック）ので、外し忘れが起きない。
  PERFORM pg_advisory_xact_lock(hashtext('place_search_quota:' || v_day::TEXT));

  SELECT c.user_daily, c.total_daily INTO v_caps FROM public.place_search_caps() c;

  -- いまの消費量。行が無ければ 0
  SELECT COALESCE((SELECT u.calls FROM public.place_search_usage u
                    WHERE u.day = v_day AND u.user_id = v_uid), 0)
    INTO v_user;

  -- その日の全体の行を用意する。
  -- 初回だけ、すでにある人ごとの消費で埋める（この移行を日中に流し直しても
  -- 全体の回数が 0 に戻らないようにするため）。以後は下の UPDATE だけが動く。
  INSERT INTO public.place_search_total_usage (day, calls)
       VALUES (v_day,
               COALESCE((SELECT SUM(u.calls)::INT FROM public.place_search_usage u
                          WHERE u.day = v_day), 0))
  ON CONFLICT (day) DO NOTHING;

  SELECT t.calls INTO v_total
    FROM public.place_search_total_usage t
   WHERE t.day = v_day;

  IF v_user >= v_caps.user_daily OR v_total >= v_caps.total_daily THEN
    RETURN QUERY SELECT FALSE, v_user, v_total, v_caps.user_daily, v_caps.total_daily;
    RETURN;
  END IF;

  INSERT INTO public.place_search_usage (day, user_id, calls)
       VALUES (v_day, v_uid, 1)
  ON CONFLICT (day, user_id)
    DO UPDATE SET calls = public.place_search_usage.calls + 1
    RETURNING calls INTO v_user;

  -- 全体の回数は、退会で消えないこちらに足す
  UPDATE public.place_search_total_usage
     SET calls = calls + 1
   WHERE day = v_day
  RETURNING calls INTO v_total;

  RETURN QUERY SELECT TRUE, v_user, v_total, v_caps.user_daily, v_caps.total_daily;
END;
$$;


-- ============================================================
-- 4. 過去の投稿から店を探す（費用ゼロ）
--
--    誰かが一度でも登録した店なら、外部のサービスを呼ばずに出せる。
--    上限に達したときの受け皿でもあり、普段も候補の先頭に置く
--    （すでにこのアプリにある店は、座標も店名の表記も揃っているため）。
--
--    1行 = 1店。同じ店に複数の投稿があってもまとめる。
--    代表の座標は、その店でいちばん見られている投稿のもの。
--
--    ★ 店名の表記ゆれはまとめないこと。
--      「用心棒」と「用心棒 神保町店」は別の行として出す。
--      勝手にまとめると、選んだ店と違う座標が入る。
-- ============================================================
CREATE OR REPLACE FUNCTION public.known_places(
  p_query TEXT,
  p_limit INT DEFAULT 8
)
RETURNS TABLE (
  name        TEXT,
  detail      TEXT,   -- 「東京都 · 神楽坂」のような、取り違えを防ぐ補足
  latitude    DOUBLE PRECISION,
  longitude   DOUBLE PRECISION,
  posts_count INT
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH q AS (
    -- ILIKE の特殊文字を打ち消す。'100%' のような店名で誤爆させない
    SELECT BTRIM(p_query) AS raw,
           replace(replace(replace(BTRIM(p_query), '\', '\\'), '%', '\%'), '_', '\_') AS esc
  ),
  -- ここに出てくる時点で posts の RLS を通っている（非公開投稿は入らない）
  --
  -- ★ 店名とエリアだけで1店にまとめないこと。
  --   同じ街に同じ名前の店が2つあると（支店名を書かずに登録した
  --   チェーン店など）、片方が候補から消える。消えた側は、Places が
  --   上限に達した日には二度と選べない。
  --   座標を小数3桁（約110m四方）に丸めたものまで含めて1店と見なす。
  --   同じ店への複数の投稿は、ピンが数十m ずれていても同じ桁に収まる。
  hit AS (
    SELECT p.location_name,
           COALESCE(p.area, p.city, p.prefecture) AS place,
           round(p.location_lat::NUMERIC, 3) AS lat_key,
           round(p.location_lng::NUMERIC, 3) AS lng_key,
           p.location_lat,
           p.location_lng,
           p.impressions_count,
           p.created_at
      FROM posts p, q
     WHERE q.raw <> ''
       AND p.location_name ILIKE '%' || q.esc || '%'
  ),
  agg AS (
    SELECT h.location_name, h.place, h.lat_key, h.lng_key, COUNT(*)::INT AS posts_count
      FROM hit h
     GROUP BY h.location_name, h.place, h.lat_key, h.lng_key
  ),
  rep AS (
    SELECT DISTINCT ON (h.location_name, h.place, h.lat_key, h.lng_key)
           h.location_name, h.place, h.lat_key, h.lng_key, h.location_lat, h.location_lng
      FROM hit h
     ORDER BY h.location_name, h.place, h.lat_key, h.lng_key,
              COALESCE(h.impressions_count, 0) DESC, h.created_at DESC
  )
  SELECT r.location_name AS name,
         NULLIF(r.place, '') AS detail,
         r.location_lat  AS latitude,
         r.location_lng  AS longitude,
         a.posts_count
    FROM rep r
    -- まとめる条件は agg・rep・この結合の3箇所で必ず揃えること。
    -- 1箇所でも違うと、件数と座標が別の店のものになる。
    JOIN agg a ON a.location_name = r.location_name
              AND a.place IS NOT DISTINCT FROM r.place
              AND a.lat_key = r.lat_key
              AND a.lng_key = r.lng_key
    CROSS JOIN q
   -- 完全一致 → 前方一致 → 部分一致。同じ順位なら投稿の多い店を上に
   ORDER BY (lower(r.location_name) = lower(q.raw)) DESC,
            (lower(r.location_name) LIKE lower(q.esc) || '%') DESC,
            a.posts_count DESC,
            length(r.location_name)
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 8), 20));
$$;


GRANT EXECUTE ON FUNCTION public.place_search_caps()   TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_place_search() TO authenticated;
GRANT EXECUTE ON FUNCTION public.known_places(TEXT, INT) TO authenticated;

-- 関数が増えたので、PostgREST にスキーマを読み直させる。
NOTIFY pgrst, 'reload schema';

COMMIT;


-- ── 確認 ──────────────────────────────────────────
-- SQL Editor では auth.uid() が NULL なので、known_places は 0 行になる。
-- それが正しい（未ログインには何も見せない）。実際の候補はアプリから確認する。

SELECT '上限の設定' AS "確認";
SELECT * FROM public.place_search_caps();

SELECT '過去データからの候補（SQL Editor では auth.uid() が NULL なので 0 行が正常）' AS "確認";
SELECT * FROM public.known_places('ラーメン'::TEXT, 5::INT);

-- 今日の消費量を見る（運用時の確認用）
-- 全体は専用の表で見ること。人ごとの表の合計は、退会した人のぶんが抜ける。
-- SELECT t.day, t.calls AS 全体,
--        (SELECT COUNT(*) FROM public.place_search_usage u WHERE u.day = t.day) AS 人数
--   FROM public.place_search_total_usage t ORDER BY t.day DESC LIMIT 7;
