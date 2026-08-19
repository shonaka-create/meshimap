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
        to_regprocedure('public.featured_post_ids(integer)') IS NOT NULL),
    -- ★ 0010 は審査に直接ひびく。この列が無いと is_demo が常に未定義になり、
    --   実在の店に付いた架空のレビューが、本物のレビューとして表示される。
    (17, '0010 デモアカウントの印', '列', 'profiles.is_demo',
        EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='profiles' AND column_name='is_demo')),
    (18, '0011 おすすめの店', '関数', 'recommend_spots',
        to_regproc('public.recommend_spots') IS NOT NULL),
    -- ★ 0012 も審査にひびく。これが無いと不適切な表現のフィルタが
    --   端末側だけになり、API を直接叩けば素通りする（Guideline 1.2）。
    (19, '0012 不適切な表現のフィルタ', '関数', 'contains_prohibited_content(text)',
        to_regprocedure('public.contains_prohibited_content(text)') IS NOT NULL),
    (20, '0012 不適切な表現のフィルタ', 'トリガー', 'posts / profiles',
        (SELECT COUNT(*) FROM pg_trigger
          WHERE NOT tgisinternal
            AND tgname IN ('trg_enforce_post_content', 'trg_enforce_profile_content')) = 2)
)
SELECT
  migration        AS "移行",
  kind             AS "種類",
  label            AS "部品",
  CASE WHEN present THEN 'あり' ELSE '★ 無い' END AS "状態"
FROM checks
ORDER BY ord;


-- ============================================================
-- 提出前の確認: デモの印が実際に付いているか
--
-- 上の一覧で「0010 … あり」でも、それは列が出来ただけ。
-- UPDATE 文まで流れて実際に印が付いたかは別に見る必要がある。
-- 印が付いていない状態で審査に出すと、架空のレビューが
-- 本物として見えるため、Guideline 1.1 / 2.3.1 の指摘になりうる。
--
-- 期待する結果: seed で作った6件が is_demo = true で並ぶ。
-- 0件なら 0010 の UPDATE を流し直すこと。
-- ============================================================

SELECT
  username        AS "ユーザーID",
  display_name    AS "アカウント名",
  is_demo         AS "デモの印",
  is_admin        AS "運営",
  is_public       AS "公開アカウント",
  posts_count     AS "投稿数"
FROM profiles
WHERE username IN ('taro', 'hanako', 'kenji', 'yuki', 'yamada', 'ebisu', 'admin')
ORDER BY is_admin DESC, username;


-- ============================================================
-- 提出前の確認: 審査員に見えるものがあるか
--
-- 投稿は「アカウントが公開」かつ「投稿が公開」のときだけ第三者に見える。
-- ここが 0 件だと、審査員がログインしても地図と検索が空になる。
-- ============================================================

SELECT
  COUNT(*)                                    AS "第三者に見える公開投稿の数",
  COUNT(*) FILTER (WHERE pr.is_demo)          AS "うちデモ投稿",
  COUNT(DISTINCT p.prefecture)                AS "都道府県の数"
FROM posts p
JOIN profiles pr ON pr.id = p.user_id
WHERE p.is_public AND pr.is_public;
