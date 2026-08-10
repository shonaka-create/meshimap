-- ============================================================
-- MeshiMap 移行 0010
--   デモアカウントである印
--
-- なぜ要るか:
--   デモデータには実在の店が入っていて、評価は★5で揃えてある。
--   書いた人物は架空なので、そのまま公開すると
--   「行っていない人のレビュー」を実在の店に載せていることになる。
--
--   消すと審査時に地図が空になり、それはそれで評価されない。
--   なので消さずに、デモであることを画面に出す。
--
-- 印は is_admin と同じ扱いにする。
--   アプリからは立てられない（トリガーが差し戻す）。
--   SQL Editor（auth.uid() が NULL）からだけ操作できる。
--   本人が自分で外せてしまうと、印の意味が無くなる。
--
-- Supabase SQL Editor に貼り付けて実行。冪等。
-- ============================================================

BEGIN;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

-- ★ アプリから is_demo を書き換えられないようにする。
--   0003 の protect_admin_flag と同じ考え方。あちらは
--   「上げられない」ためだったが、こちらは「外せない」ため。
CREATE OR REPLACE FUNCTION public.protect_demo_flag()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.is_demo IS DISTINCT FROM OLD.is_demo THEN
    NEW.is_demo := OLD.is_demo;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_protect_demo_flag ON profiles;
CREATE TRIGGER trg_protect_demo_flag
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_demo_flag();

-- サインアップ時に仕込まれないようにする（0003 の deny_admin_on_insert と同じ趣旨）
CREATE OR REPLACE FUNCTION public.deny_demo_on_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.is_demo := false;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_deny_demo_on_insert ON profiles;
CREATE TRIGGER trg_deny_demo_on_insert
  BEFORE INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.deny_demo_on_insert();


-- ============================================================
-- デモアカウントに印を付ける
--
--   scripts/seed.mjs が作るアカウントが対象。
--   運営（admin）は本物の窓口なので含めない。
--
--   ★ 本番で実在のユーザーがこれらの username を取っていないこと。
--     seed で作ったものだけが対象になる。
-- ============================================================

UPDATE profiles
   SET is_demo = true
 WHERE username IN ('taro', 'hanako', 'kenji', 'yuki', 'yamada', 'ebisu');

COMMIT;

-- 確認: 印が付いたアカウント
SELECT username, display_name, is_demo, is_admin
FROM profiles
WHERE is_demo OR is_admin
ORDER BY is_admin DESC, username;
