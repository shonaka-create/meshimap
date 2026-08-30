-- ============================================================
-- MeshiMap 移行 0016
--   1投稿あたりの写真を5枚までに、DB側でも止める
--
-- 背景:
--   端末側は3重に止めている（選択の上限・追加ボタンの非表示・slice）。
--   ただし post_images の INSERT ポリシーは「その投稿の持ち主か」しか
--   見ておらず、枚数は一度も数えていなかった。
--   アプリを改造されるか anon キーで PostgREST を直接叩かれれば、
--   1投稿に何枚でも入れられる状態だった。
--
--   このアプリの決め事どおり、最後に止めるのは DB でやる
--   （禁止語・地図の枠・Storage の置き場所と同じ考え方）。
--
-- ★ トリガーで COUNT して弾く、はやらない。
--   同時に投げられると、どちらも「まだ4枚」を見て両方通る。
--   代わりに position を使う:
--     ・position は 0〜4 しか許さない（CHECK）
--     ・(post_id, position) は重複させない（UNIQUE）
--   この2つで「1投稿に最大5行」が構造として保証される。
--   数え上げが要らないので競合しない。
--
-- ★ 上限は mobile/app/post/new.tsx の MAX_IMAGES と対。
--   片方だけ変えると、端末では6枚目が選べるのに保存で弾かれる
--   （またはその逆）という食い違いになる。
--
-- Supabase SQL Editor に貼り付けて実行。冪等。
-- ============================================================

BEGIN;

-- ============================================================
-- 1. position を必ず入れる
--
--    それまで position は NULL を許していた（DEFAULT 0 だけ）。
--    NULL は UNIQUE では互いに重複と見なされないので、
--    ここを埋めておかないと下の制約が意味を持たない。
--
--    投稿ごとに 0 から振り直す。すべて 0 で埋めると、
--    同じ投稿に複数の NULL があった場合に重複してしまう。
-- ============================================================

UPDATE post_images pi
   SET position = numbered.rn
  FROM (
    SELECT id, (ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY position NULLS LAST, id) - 1)::INT AS rn
    FROM post_images
  ) AS numbered
 WHERE pi.id = numbered.id
   AND (pi.position IS NULL OR pi.position <> numbered.rn);

ALTER TABLE post_images ALTER COLUMN position SET DEFAULT 0;
ALTER TABLE post_images ALTER COLUMN position SET NOT NULL;


-- ============================================================
-- 2. 既に上限を超えている投稿が無いか確かめる
--
--    あったら黙って直さない。写真を消すことになるので、
--    どれを消すかは人が決めること。何が引っかかったかを見せて止める。
-- ============================================================

DO $$
DECLARE
  v_bad INT;
BEGIN
  SELECT COUNT(*) INTO v_bad
  FROM (
    SELECT post_id FROM post_images GROUP BY post_id HAVING COUNT(*) > 5
  ) AS over_limit;

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      '写真が5枚を超えている投稿が % 件あります。先に減らしてから実行してください。', v_bad
      USING HINT =
        'SELECT post_id, COUNT(*) FROM post_images GROUP BY post_id HAVING COUNT(*) > 5; '
        'で対象を確認できます。';
  END IF;
END $$;


-- ============================================================
-- 3. 構造として上限を持たせる
--
--    ★ 5 という数字を直接書いている。
--      CHECK に関数を挟むと、あとで関数を変えたときに
--      既存の行が検査し直されず、通っているのか通っていないのかが
--      分からなくなる。上限を変えるときは、この移行と
--      MAX_IMAGES の両方を直すこと。
-- ============================================================

ALTER TABLE post_images DROP CONSTRAINT IF EXISTS post_images_position_range;
ALTER TABLE post_images ADD  CONSTRAINT post_images_position_range
  CHECK (position >= 0 AND position < 5);

CREATE UNIQUE INDEX IF NOT EXISTS post_images_post_position_key
  ON post_images (post_id, position);

COMMIT;
