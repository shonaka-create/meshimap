-- ============================================================
-- MeshiMap 移行 0018
--   @taro（デモ）を @ebichan（本アカウント）にする
--
-- 背景:
--   @taro は seed が作ったデモアカウントで、移行0010 で
--   is_demo = true の印が付いている。この印が立っている限り、
--   プロフィールにも投稿にも投稿プレビューにも
--   「デモ用のアカウントです」の帯が出る
--   （ProfileView.tsx / post/[id].tsx / PostPreviewSheet.tsx）。
--
--   このアカウントを実際に運用する本アカウントに切り替えるので、
--   印を外す。
--
-- ★ なぜ SQL Editor でしかできないのか。
--   移行0010 の protect_demo_flag が、auth.uid() のある経路からの
--   is_demo の変更を全て差し戻す。本人が自分でデモの印を外せては
--   印の意味が無くなるので、これは仕様どおり。
--   SQL Editor は auth.uid() が NULL なので通る。
--
-- ★ 名前・自己紹介・投稿は、このファイルでは触らない。
--   それは scripts/seed-ebichan.mjs の担当。ここは
--   「アプリからは変えられないもの」だけを扱う。
--
--   先に scripts/seed-ebichan.mjs --apply を流してから、
--   このファイルを SQL Editor に貼り付けて実行すること。
--
-- Supabase SQL Editor に貼り付けて実行。冪等。
-- ============================================================

BEGIN;

-- ── 1. デモの印を外す ────────────────────────────
-- username は seed-ebichan.mjs が 'ebichan' に変えている。
-- まだ流していない場合に備えて 'taro' も見る（どちらか一方しか居ない）。
UPDATE profiles
   SET is_demo = false
 WHERE username IN ('ebichan', 'taro');


-- ── 2. 移行0010 を流し直しても戻らないようにする ──
--
-- ★ 0010 の UPDATE 文からも 'taro' を消してある。
--   ここだけ直して 0010 を放置すると、0010 を再実行した瞬間に
--   デモの印が復活する。両方直っていること。
--
-- 念のため、いま印が付いているアカウントを確認する:
--   このあと出る一覧に ebichan / taro が居ないこと。

COMMIT;


-- ── 確認 ──────────────────────────────────────────
-- 期待する結果:
--   ・ebichan の is_demo が false
--   ・デモ印が付いたアカウントの一覧に ebichan が居ない

SELECT username AS "ユーザーID",
       display_name AS "アカウント名",
       is_demo AS "デモ印",
       is_admin AS "運営",
       posts_count AS "投稿数"
FROM profiles
WHERE username IN ('ebichan', 'taro')
   OR is_demo
   OR is_admin
ORDER BY is_admin DESC, is_demo DESC, username;
