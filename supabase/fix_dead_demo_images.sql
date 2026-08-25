-- ============================================================
-- 死んだデモ画像の差し替え（データ修正・1回だけ流す）
--
-- seed が入れたデモ投稿の画像は Unsplash を直接参照している。
-- そのうち3枚が Unsplash 側で削除され、404 を返すようになった。
-- アプリでは「投稿によっては画像が出ない」という形で見えていた。
--
-- 41本すべてを叩いて確認した結果、死んでいたのはこの3枚だけ:
--
--   photo-1516901408873-81eed5ee17e5   天ぷら 大黒屋 浅草
--   photo-1607301405345-41e34312ba64   北新地 弧柳
--   photo-1617196034183-421b4040ed20   久兵衛 新宿高島屋店（2枚目）
--
-- 差し替え先は、同じ和食系の投稿で既に使っていて生存を確認済みのもの。
-- scripts/seed.mjs も同じ内容に直してあるので、seed を流し直した場合も一致する。
--
-- ★ この修正は対症療法でしかない。
--   外部サイトの画像を直接参照している限り、また同じことが起きる。
--   審査中に画像が消えると印象が悪いので、デモ画像は Supabase Storage に
--   置き直すのが本来の直し方。
-- ============================================================


-- ── 1. 流す前の確認 ───────────────────────────────
-- 3行出れば想定どおり。0行なら既に直っている。

SELECT
  p.location_name AS "店名",
  pi.position     AS "何枚目",
  pi.url          AS "URL"
FROM post_images pi
JOIN posts p ON p.id = pi.post_id
WHERE pi.url LIKE '%photo-1516901408873-81eed5ee17e5%'
   OR pi.url LIKE '%photo-1607301405345-41e34312ba64%'
   OR pi.url LIKE '%photo-1617196034183-421b4040ed20%'
ORDER BY p.location_name, pi.position;


-- ── 2. 差し替え ───────────────────────────────────

-- 天ぷら 大黒屋 浅草 → 石かわ 神楽坂 と同じ割烹の写真
UPDATE post_images
SET url = 'https://images.unsplash.com/photo-1547592180-85f173990554?w=800'
WHERE url = 'https://images.unsplash.com/photo-1516901408873-81eed5ee17e5?w=800';

-- 北新地 弧柳 → しらす問屋 と同じ和食の写真
UPDATE post_images
SET url = 'https://images.unsplash.com/photo-1534482421-64566f976cfa?w=800&q=90'
WHERE url = 'https://images.unsplash.com/photo-1607301405345-41e34312ba64?w=800&q=90';

-- 久兵衛 新宿高島屋店 は2枚目だけが死んでいる。
-- 1枚目は生きているので、差し替えず単に落とす。
DELETE FROM post_images
WHERE url = 'https://images.unsplash.com/photo-1617196034183-421b4040ed20?w=800';


-- ── 3. 流した後の確認 ─────────────────────────────
-- 期待する結果: 「死んだURLの残り」が 0。
-- 「画像が1枚も無い投稿」も 0 であること（0 なら全投稿に画像がある）。

SELECT
  (SELECT COUNT(*)
     FROM post_images
    WHERE url LIKE '%photo-1516901408873-81eed5ee17e5%'
       OR url LIKE '%photo-1607301405345-41e34312ba64%'
       OR url LIKE '%photo-1617196034183-421b4040ed20%')  AS "死んだURLの残り",

  (SELECT COUNT(*)
     FROM posts p
    WHERE NOT EXISTS (SELECT 1 FROM post_images pi WHERE pi.post_id = p.id))
                                                          AS "画像が1枚も無い投稿";
