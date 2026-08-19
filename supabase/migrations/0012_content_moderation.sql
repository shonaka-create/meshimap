-- ============================================================
-- MeshiMap 移行 0012
--   不適切な表現をDB側で止める
--
-- なぜ要るか:
--   App Store Review Guideline 1.2 は UGC アプリに
--   「不適切な内容をあらかじめ取り除く仕組み」を求めている。
--   通報とブロックは既にあるが、あれは出てしまった後の始末なので、
--   出る前に止めるものが別に要る。
--
-- なぜ端末側だけでは駄目か:
--   mobile/src/lib/moderation.ts に同じ判定がある。あれは
--   「押す前に教える」ためのもので、止める力は無い。
--   アプリを改造されるか、anon キーで PostgREST を直接叩かれれば
--   素通りする。最後に止めるのはここ。
--
-- ★ 語の一覧は mobile/src/lib/moderation.ts と対。
--   片方だけ直すと、端末では弾かれるのにDBは通す（またはその逆）
--   という食い違いが起きる。`npm run check:moderation` が毎回見る。
--
-- ★ 既存の投稿・プロフィールは作り直さない。
--   トリガーは「その列が実際に変わったとき」だけ判定する。
--   全行を検査すると、過去に入った語のせいで
--   公開/非公開の切り替えやカウンタ更新まで通らなくなる。
--
-- Supabase SQL Editor に貼り付けて実行。冪等。
-- ============================================================

BEGIN;

-- ============================================================
-- 0. 語の一覧
--
--    ★ mobile/src/lib/moderation.ts の SAFE_PHRASES /
--      PROHIBITED_JA / PROHIBITED_LATIN と1語ずつ揃えること。
--      並び順まで同じにしてある（差分を読みやすくするため）。
--
--    関数にしているのは、定数表にすると RLS とバックアップの
--    対象が増えて扱いが面倒になるため。
-- ============================================================

-- 判定の前に取り除く、無害な語。
-- 禁止語は部分一致で見るので、無害な語の中に禁止語が入っていると
-- 巻き添えで弾かれる。飲食の言葉にはこれが実際にある。
CREATE OR REPLACE FUNCTION public.moderation_safe_phrases()
RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $fn$
  SELECT ARRAY[
    'グレイプ',      -- 「レイプ」を含む。グレープフルーツの別表記
    '大麻駅',        -- 「大麻」を含む。北海道江別市の地名
    '大麻銀座',
    '大麻中町',
    '大麻東町'
  ]::TEXT[];
$fn$;

-- 日本語の禁止語。正規化した本文への部分一致で見る。
--
-- ここに入れなかったもの（意図的に外している。戻さないこと）:
--   シャブ    … 「シャブシャブ」。この一語でしゃぶしゃぶの店が全滅する
--   麻薬      … 「麻薬卵」は実在する韓国料理の名前
--   支那      … 「支那そば」はラーメンの一般的なメニュー名
--   殺す      … 「悩殺する」「相殺する」に含まれる
--   4ね       … 「4年」に含まれる
--   ちんちん  … 名古屋方言で「熱々」
--   フェラ    … 「フェラーリ」に含まれる
--   バカ/クソ/アホ/デブ … 「バカうま」「クソうまい」「デブ活」は褒め言葉
CREATE OR REPLACE FUNCTION public.moderation_prohibited_ja()
RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $fn$
  SELECT ARRAY[
    -- 露骨な性的表現
    'セックス', 'せっくす', 'フェラチオ', 'クンニ', 'オナニー',
    'まんこ', 'マンコ', 'ちんぽ', 'チンポ', 'ちんこ', 'チンコ',
    'ヤリマン', 'av女優', '風俗嬢', 'エロ動画', 'エロ画像', '裏ビデオ',
    '売春', '援助交際', '援交', 'ポルノ', '児童ポルノ',
    -- 差別・ヘイト
    'キチガイ', 'きちがい', '気違い', '基地外', 'ガイジ',
    '池沼', '土人', '穢多',
    -- 脅迫・暴力を助長する表現
    '死ね', '氏ね', 'ぶっ殺', '殺すぞ', '殺してやる',
    '殺害予告', '自殺しろ', '死んで詫び',
    -- 強い侮辱・嫌がらせ
    'くたばれ', 'クソ野郎', 'くそ野郎', 'ゴミクズ',
    '消え失せろ', '生きる価値がない', 'この世から消えろ',
    -- 違法行為を明確に助長する表現
    '覚醒剤', '覚せい剤', 'コカイン', 'ヘロイン', '大麻',
    '違法薬物', '脱法ハーブ', '危険ドラッグ'
  ]::TEXT[];
$fn$;

-- ラテン文字の禁止語。すべて小文字。
-- 部分一致では見ない。"ass" は "bass"（スズキ）に、
-- "cum" は "cumin"（クミン）に、"rape" は "grape" に入ってしまう。
-- 前後が英数字でないときだけ当てる。
CREATE OR REPLACE FUNCTION public.moderation_prohibited_latin()
RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $fn$
  SELECT ARRAY[
    'fuck', 'fucking', 'fucker', 'motherfucker',
    'shit', 'bullshit', 'bitch', 'cunt', 'whore', 'slut',
    'nigger', 'nigga', 'faggot',
    'rape', 'rapist', 'porn', 'pornhub', 'sex',
    'retard', 'kys', 'kill yourself'
  ]::TEXT[];
$fn$;


-- ============================================================
-- 1. 判定
--
--    ★ mobile/src/lib/moderation.ts の
--      normalizeForModeration + containsProhibitedContent と
--      同じ結果になるようにしてある。
--      lower(normalize(t, NFKC)) が向こうの
--      normalize('NFKC') → 全角英数の半角化 → toLowerCase() に対応する。
-- ============================================================

CREATE OR REPLACE FUNCTION public.contains_prohibited_content(p_text TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  t TEXT;
  w TEXT;
BEGIN
  -- 未入力は通す。任意項目を空のまま保存できなくなるため。
  IF p_text IS NULL OR btrim(p_text) = '' THEN
    RETURN false;
  END IF;

  -- 「ｆｕｃｋ」（全角）や「ﾌｪﾗﾁｵ」（半角カナ）で素通りしないよう字をそろえる。
  -- ★ 空白は取り除かない。詰めると「美味いしね」が「死ね」に化ける。
  t := lower(normalize(p_text, NFKC));

  -- 無害な語を先に抜く。消さずに空白へ置き換えて、
  -- 前後がくっついて別の語になるのを防ぐ。
  FOREACH w IN ARRAY public.moderation_safe_phrases() LOOP
    t := replace(t, w, ' ');
  END LOOP;

  FOREACH w IN ARRAY public.moderation_prohibited_ja() LOOP
    IF position(w IN t) > 0 THEN
      RETURN true;
    END IF;
  END LOOP;

  FOREACH w IN ARRAY public.moderation_prohibited_latin() LOOP
    -- 前後が英数字でないときだけ当てる（grape の rape を拾わないため）。
    -- \y は使わない。ロケールによっては日本語も語構成文字と見なされ、
    -- 「これはfuck」の先頭側に境界が立たないことがある。
    IF t ~ ('(^|[^a-z0-9])' || w || '($|[^a-z0-9])') THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END $fn$;

COMMENT ON FUNCTION public.contains_prohibited_content(TEXT) IS
  '不適切な表現を含むか。mobile/src/lib/moderation.ts と対。npm run check:moderation で一致を検査する。';


-- ============================================================
-- 2. 投稿（店舗名・本文）
--
--    ★ 変わっていない列は見ない。
--      公開/非公開の切り替えは posts の UPDATE なので、
--      全行検査にすると過去の投稿を非公開に戻せなくなる。
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_post_content_policy()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- 入れ子にしているのは、SQL の AND が左から評価される保証が無く、
    -- INSERT のときに OLD を触ると実行時エラーになるため。
    IF NEW.location_name IS NOT DISTINCT FROM OLD.location_name
       AND NEW.caption IS NOT DISTINCT FROM OLD.caption THEN
      RETURN NEW;
    END IF;
  END IF;

  IF public.contains_prohibited_content(NEW.location_name)
     OR public.contains_prohibited_content(NEW.caption) THEN
    -- ★ どの語に当たったかは返さない。返すと
    --   「この語を避ければ通る」と教えることになる。
    RAISE EXCEPTION 'prohibited_content'
      USING HINT = '不適切な表現が含まれている可能性があります。内容を修正してから再度お試しください。';
  END IF;

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_enforce_post_content ON posts;
CREATE TRIGGER trg_enforce_post_content
  BEFORE INSERT OR UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_post_content_policy();


-- ============================================================
-- 3. プロフィール（アカウント名・自己紹介）
--
--    ユーザーID(username) は見ない。小文字英字3〜20文字という
--    既存の CHECK 制約で別に守られている。仕様を変えない。
--
--    ★ カウンタ更新（posts_count など）も profiles の UPDATE なので、
--      ここでも「変わった列だけ」を守ること。
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_profile_content_policy()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.display_name IS NOT DISTINCT FROM OLD.display_name
       AND NEW.bio IS NOT DISTINCT FROM OLD.bio THEN
      RETURN NEW;
    END IF;
  END IF;

  IF public.contains_prohibited_content(NEW.display_name)
     OR public.contains_prohibited_content(NEW.bio) THEN
    RAISE EXCEPTION 'prohibited_content'
      USING HINT = '不適切な表現が含まれている可能性があります。内容を修正してから再度お試しください。';
  END IF;

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_enforce_profile_content ON profiles;
CREATE TRIGGER trg_enforce_profile_content
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_content_policy();

COMMIT;


-- ============================================================
-- 確認: 判定がそれらしく動くか
--
--   期待する結果:
--     「通す」は全部 false（普通の飲食レビューを弾いていない）
--     「弾く」は全部 true
-- ============================================================

SELECT '通す' AS "区分", s AS "入力",
       public.contains_prohibited_content(s) AS "禁止語"
FROM unnest(ARRAY[
  '麺屋 こうじ',
  'ここのラーメンは死ぬほど美味い',
  'バカうまい。クソうまい。アホみたいな量',
  'デブ活の締めにシャブシャブ',
  '支那そばが名物です',
  '麻薬卵をのせた丼',
  'グレイプフルーツサワーが good',
  'sea bass のカルパッチョ',
  'クミン（cumin）が効いている',
  '大麻駅前の喫茶店'
]) AS s

UNION ALL

SELECT '弾く', s, public.contains_prohibited_content(s)
FROM unnest(ARRAY[
  '死ね',
  'ｆｕｃｋ this place',
  'この店の店員はキチガイ',
  '殺すぞ',
  '覚醒剤を売っています'
]) AS s;
