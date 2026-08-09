/**
 * 既存投稿の prefecture / area をバックフィルする（一度きり）。
 *
 * Web 版は長らく posts に座標と店名しか入れていなかったため、
 * Web から作られた投稿は都道府県→エリアの集計にも
 * profiles.areas_count にも載らなかった。座標は入っているので、
 * 内蔵データ（lib/regions.ts）で後から埋められる。
 *
 * 埋めるのは prefecture と area の2列だけ。
 * city は Google Geocoding が要るのでここでは触らない
 * （最寄りエリアが 8km 以内にあれば area が入るので集計には十分）。
 *
 * areas_count は posts の UPDATE で trg_areas_count が自動的に数え直す。
 *
 * 実行:
 *   NEXT_PUBLIC_SUPABASE_URL='https://xxxx.supabase.co' \
 *   SUPABASE_SERVICE_ROLE_KEY='＜service_role キー＞' \
 *   node scripts/backfill-regions.mjs [--dry-run]
 *
 *   PowerShell:
 *     $env:SUPABASE_SERVICE_ROLE_KEY='＜service_role キー＞'
 *     node scripts/backfill-regions.mjs --dry-run
 *
 * ※ service_role キーは RLS を無視して全データを読み書きできる管理者キー。
 *   .env に置かず、実行時だけ環境変数で渡し、終わったら閉じること。
 *   他人の投稿も更新する必要があるため、ここだけは anon キーでは足りない。
 */

import { createClient } from '@supabase/supabase-js'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * lib/regions.ts は TypeScript なので node から直接 import できない。
 * 型注釈を自前の正規表現で落とすと書き方が変わった瞬間に壊れるので、
 * devDependency の TypeScript にトランスパイルさせる。
 * regions.ts は外部 import を持たない純粋なデータ + 関数なので、
 * これだけでそのまま評価できる。
 */
async function loadRegions() {
  const src = readFileSync(join(root, 'lib', 'regions.ts'), 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  })
  const encoded = Buffer.from(outputText).toString('base64')
  return import(`data:text/javascript;base64,${encoded}`)
}

const { nearestArea, PREFECTURE_BY_ID } = await loadRegions()

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const dryRun = process.argv.includes('--dry-run')

if (!url || !serviceKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください。')
  process.exit(1)
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// 内蔵データで判定を試みる距離。lib/geocode.ts と揃えること。
const LOCAL_HIT_METERS = 8000

const { data: posts, error } = await supabase
  .from('posts')
  .select('id, location_lat, location_lng, prefecture, area')
  .is('prefecture', null)

if (error) {
  console.error('投稿の取得に失敗しました:', error.message)
  process.exit(1)
}

console.log(`prefecture が空の投稿: ${posts.length} 件`)

let filled = 0
let skipped = 0

for (const post of posts) {
  const { location_lat: lat, location_lng: lng } = post
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    skipped++
    continue
  }

  const hit = nearestArea(lat, lng, LOCAL_HIT_METERS)
  if (!hit) {
    // 8km 以内にエリアが無い。都道府県だけでも入れたいところだが、
    // 県境付近で誤判定すると地図の階層が静かに壊れるので触らない。
    skipped++
    continue
  }

  const prefecture = PREFECTURE_BY_ID[hit.area.prefId]?.name ?? null
  if (!prefecture) {
    skipped++
    continue
  }

  if (dryRun) {
    console.log(`  [dry-run] ${post.id} → ${prefecture} / ${hit.area.name}`)
    filled++
    continue
  }

  const { error: updateError } = await supabase
    .from('posts')
    .update({ prefecture, area: hit.area.name })
    .eq('id', post.id)

  if (updateError) {
    console.error(`  失敗 ${post.id}: ${updateError.message}`)
    skipped++
  } else {
    filled++
  }
}

console.log(`\n${dryRun ? '[dry-run] ' : ''}埋めた: ${filled} 件 / 見送り: ${skipped} 件`)
if (skipped > 0) {
  console.log('見送りは、内蔵エリアから 8km 以上離れた地点の投稿です。')
  console.log('必要なら Google Geocoding で市区町村を引いて手当てしてください。')
}
if (!dryRun && filled > 0) {
  console.log('profiles.areas_count は trg_areas_count が自動で数え直しています。')
}
