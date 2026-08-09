-- ============================================================
-- どの移行まで適用されているかを調べる（読み取りのみ・副作用なし）
--
-- Supabase SQL Editor に貼り付けて実行してください。
-- 「移行 N が未適用です」と言われたとき、どこから流し直せばよいかが分かります。
--
-- 移行は番号順に依存しています。途中を飛ばすと、
-- 後の移行が「関数が存在しない」で落ちます。
-- 0006 と 0007 はデータを直すだけで新しい部品を作らないため、
-- 適用済みかどうかをここから判定することはできません（再実行しても安全です）。
-- ============================================================

WITH checks (ord, migration, kind, label, present) AS (
  VALUES
    (1, '0001 アカウント/公開設定/地域', '関数', 'can_view_post(uuid,boolean)',
        to_regprocedure('public.can_view_post(uuid,boolean)') IS NOT NULL),
    (2, '0001 アカウント/公開設定/地域', '列',   'profiles.username',
        to_regclass('public.profiles') IS NOT NULL AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='profiles' AND column_name='username')),
    (3, '0002 エリア階層/シチュエーション', '列', 'posts.area',
        EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='posts' AND column_name='area')),
    (4, '0003 運営アカウント', '列', 'profiles.is_admin',
        EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='profiles' AND column_name='is_admin')),
    (5, '0004 ランク/地図のアイコン', '関数', 'rank_of(int,int)',
        to_regprocedure('public.rank_of(integer,integer)') IS NOT NULL),
    (6, '0004 ランク/地図のアイコン', '表',   'avatar_emojis',
        to_regclass('public.avatar_emojis') IS NOT NULL),
    (7, '0005 フォロー上限/課金状態', '表',   'subscriptions',
        to_regclass('public.subscriptions') IS NOT NULL),
    (8, '0005 フォロー上限/課金状態', '関数', 'is_subscribed(uuid)',
        to_regprocedure('public.is_subscribed(uuid)') IS NOT NULL),
    (9, '0005 フォロー上限/課金状態', '関数', 'is_admin_user(uuid)',
        to_regprocedure('public.is_admin_user(uuid)') IS NOT NULL),
    (10, '0005 フォロー上限/課金状態', '関数', 'my_follow_quota()',
        to_regprocedure('public.my_follow_quota()') IS NOT NULL),
    (11, '0008 表示回数/注目/月間ランク', '列', 'posts.impressions_count',
        EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='posts' AND column_name='impressions_count')),
    (12, '0008 表示回数/注目/月間ランク', '表', 'post_impressions',
        to_regclass('public.post_impressions') IS NOT NULL),
    (13, '0008 表示回数/注目/月間ランク', '関数', 'record_impression(uuid)',
        to_regprocedure('public.record_impression(uuid)') IS NOT NULL),
    (14, '0008 表示回数/注目/月間ランク', '関数', 'monthly_standing(uuid)',
        to_regprocedure('public.monthly_standing(uuid)') IS NOT NULL),
    (15, '0009 プレミアムの線引き', '関数', 'has_premium()',
        to_regprocedure('public.has_premium()') IS NOT NULL),
    (16, '0009 プレミアムの線引き', '関数', 'featured_post_ids(int)',
        to_regprocedure('public.featured_post_ids(integer)') IS NOT NULL)
)
SELECT
  migration        AS "移行",
  kind             AS "種類",
  label            AS "部品",
  CASE WHEN present THEN 'あり' ELSE '★ 無い' END AS "状態"
FROM checks
ORDER BY ord;
