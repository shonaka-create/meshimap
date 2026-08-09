/**
 * lib/regions.ts から「地域列バックフィル用の SQL」を生成する。
 *
 * バックフィルは node スクリプト（backfill-regions.mjs）でもできるが、
 * そちらは他人の投稿も更新するため service_role キーが要る。
 * 生成した SQL なら SQL Editor に貼るだけで済み、管理者キーを
 * 手元に出さずに同じ結果が得られる。判定ロジックは JS 版と同じ
 * （ハーバサインで最寄りエリア、8km 以内なら採用）。
 *
 * 実行: node scripts/gen-region-backfill-sql.mjs
 * 出力: supabase/migrations/0007_backfill_post_regions.sql
 */

import ts from 'typescript'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

async function loadRegions() {
  const src = readFileSync(join(root, 'lib', 'regions.ts'), 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}

const { AREAS, PREFECTURE_BY_ID } = await loadRegions()

/** SQL の文字列リテラル。単一引用符のエスケープだけ気にすればよい */
const q = (s) => `'${String(s).replace(/'/g, "''")}'`

const rows = AREAS.map((a, i) => {
  const pref = PREFECTURE_BY_ID[a.prefId]
  if (!pref) throw new Error(`エリア「${a.name}」の prefId「${a.prefId}」が PREFECTURES にありません`)
  // ord は同距離のときの優先順。JS の nearestArea は配列の先頭を勝たせるので揃える。
  return `  (${i}, ${q(a.name)}, ${q(pref.name)}, ${a.center[0]}, ${a.center[1]})`
}).join(',\n')

const sql = `-- ============================================================
-- 0007: 既存投稿の prefecture / area をバックフィル
--
-- ⚠ このファイルは自動生成されています。直接編集しないでください。
--   生成元: lib/regions.ts
--   再生成: node scripts/gen-region-backfill-sql.mjs
--
-- Web 版は長らく posts に座標と店名しか入れていなかったため、
-- Web から作られた投稿は都道府県→エリアの集計にも
-- profiles.areas_count にも載らなかった。座標は入っているので、
-- 内蔵エリアデータ（${AREAS.length}件）から後追いで埋められる。
--
-- 判定は lib/geocode.ts と同じ:
--   ハーバサインで最寄りエリアを探し、8km 以内なら採用する。
--   8km 以内に何も無い地点は触らない。県境付近で都道府県だけ入れると
--   誤判定が地図の階層に残るため、素直に見送る。
--
-- city は Google Geocoding が要るのでここでは埋めない。
-- 集計は COALESCE(area, city) なので、area が入れば実績には載る。
--
-- profiles.areas_count は posts の UPDATE で
-- trg_areas_count（0004）が自動的に数え直す。
--
-- 冪等。prefecture が入っている投稿は対象外なので、何度実行してもよい。
-- ============================================================

BEGIN;

CREATE TEMP TABLE _areas (
  ord  INT,
  name TEXT,
  pref TEXT,
  lat  DOUBLE PRECISION,
  lng  DOUBLE PRECISION
) ON COMMIT DROP;

INSERT INTO _areas (ord, name, pref, lat, lng) VALUES
${rows};

-- 投稿ごとに最寄りエリアを1件だけ選ぶ。
-- 距離が同じときは ord の小さい方（= lib/regions.ts の配列で先に出る方）を採る。
WITH nearest AS (
  SELECT DISTINCT ON (p.id)
    p.id,
    a.name AS area,
    a.pref AS prefecture,
    2 * 6371000 * asin(sqrt(
      power(sin(radians(a.lat - p.location_lat) / 2), 2) +
      cos(radians(p.location_lat)) * cos(radians(a.lat)) *
      power(sin(radians(a.lng - p.location_lng) / 2), 2)
    )) AS meters
  FROM posts p
  CROSS JOIN _areas a
  WHERE p.prefecture IS NULL
    AND p.location_lat IS NOT NULL
    AND p.location_lng IS NOT NULL
  ORDER BY p.id, meters, a.ord
)
UPDATE posts p
SET prefecture = n.prefecture,
    area       = n.area
FROM nearest n
WHERE n.id = p.id
  AND n.meters <= 8000;   -- lib/geocode.ts の LOCAL_HIT_METERS と揃えること

COMMIT;

-- 確認: まだ prefecture が空の投稿。
-- 内蔵エリアから 8km 以上離れた地点なので、必要なら個別に手当てする。
SELECT count(*) AS remaining_without_prefecture
FROM posts
WHERE prefecture IS NULL;

-- 確認: 埋まったエリアの内訳
SELECT prefecture, area, count(*) AS posts
FROM posts
WHERE prefecture IS NOT NULL
GROUP BY prefecture, area
ORDER BY posts DESC, prefecture, area;
`

const out = join(root, 'supabase', 'migrations', '0007_backfill_post_regions.sql')
writeFileSync(out, sql)
console.log(`生成しました: supabase/migrations/0007_backfill_post_regions.sql（エリア ${AREAS.length} 件）`)
