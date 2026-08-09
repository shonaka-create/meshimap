-- ============================================================
-- 管理者の任命 / 解任
--
-- Supabase の SQL Editor（service_role）からのみ実行できる。
-- アプリ側からは移行0003 のトリガーが is_admin の変更を差し戻すため、
-- ユーザーが自分を管理者に昇格させることはできない。
--
-- migrations/ には置かない。「誰が管理者か」は環境ごとに違う運用の設定で、
-- スキーマではないため。
-- ============================================================

-- ---- 任命 --------------------------------------------------
UPDATE profiles SET is_admin = true
WHERE username = 'admin';   -- ← 対象のユーザーIDに書き換える

-- ---- 解任 --------------------------------------------------
-- UPDATE profiles SET is_admin = false WHERE username = 'admin';

-- ---- 確認 --------------------------------------------------
SELECT username, display_name, is_admin
FROM profiles
WHERE is_admin
ORDER BY username;
