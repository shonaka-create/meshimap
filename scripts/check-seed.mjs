/**
 * デモデータ（scripts/seed.mjs）の整合性を検査する。
 *
 * なぜ要るか:
 *   投稿1件ごとに prefecture / area を手で書いている。これは本来
 *   座標から regions.ts が判定するもので、両者がずれると
 *   「地図では中央区なのに、一覧では銀座」のような食い違いが出る。
 *   しかも投入するまで気づけない。
 *
 *   実際、内蔵エリアを225→307件に増やしたときに「築地」が入り、
 *   築地本店の投稿の判定が銀座から築地に変わって、
 *   既存のデモデータが静かに壊れていた。エリアを増やすたびに
 *   同じことが起きるので、機械で見る。
 *
 * 見ているもの:
 *   - ジャンル / 価格帯 / シチュエーションが theme.ts の選択肢にあるか
 *   - rating が 1〜5 か
 *   - 座標から判定した都道府県・エリアが、書いてある値と一致するか
 *   - 8km 以内に内蔵エリアがあるか（無いと投入時に Geocoding API を消費する）
 *
 * ★ seed.mjs も theme.ts も、そのまま import できない。
 *   前者は読み込んだだけで投入が走り、後者は react-native を要求する。
 *   なので、どちらもソースから定義部分だけを切り出して評価している。
 *
 * 実行: npm run check:seed
 */

import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 中かっこ・角かっこの対応を数えて、開始位置から閉じ位置までを返す */
function block(src, from, open, close) {
  const s = src.indexOf(open, from)
  let depth = 0
  for (let i = s; i < src.length; i++) {
    if (src[i] === open) depth++
    else if (src[i] === close) {
      depth--
      if (depth === 0) return src.slice(s, i + 1)
    }
  }
  throw new Error(`かっこが閉じていません（${open} から）`)
}

/* ── regions.ts は TypeScript を落とせば普通に読める ───────── */
const { outputText } = ts.transpileModule(
  readFileSync(join(root, 'lib', 'regions.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }
)
const { nearestArea, PREFECTURE_BY_ID } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)

/* ── theme.ts は react-native を import しているので、配列だけ抜く ── */
const theme = readFileSync(join(root, 'mobile', 'src', 'theme.ts'), 'utf8')
const arrayOf = (name) =>
  (0, eval)('(' + block(theme, theme.indexOf(`export const ${name} = [`), '[', ']') + ')')

const GENRES = new Set(arrayOf('GENRES'))
const SITUATIONS = new Set(arrayOf('SITUATIONS'))
const PRICE_RANGES = new Set(arrayOf('PRICE_RANGES'))

/* ── seed.mjs は読み込むと投入が走るので、定義だけ抜く ────── */
const seed = readFileSync(join(root, 'scripts', 'seed.mjs'), 'utf8')
const POSTS_BY_USER = (0, eval)(
  '(' + block(seed, seed.indexOf('const POSTS_BY_USER = {'), '{', '}') + ')'
)

/** 内蔵データで判定できる距離。mobile/src/lib/geocode.ts の LOCAL_HIT_METERS と対 */
const LOCAL_HIT_METERS = 8000

let bad = 0
let total = 0

for (const [username, posts] of Object.entries(POSTS_BY_USER)) {
  for (const p of posts) {
    total++
    const errs = []

    if (!GENRES.has(p.genre)) errs.push(`ジャンル「${p.genre}」が GENRES にありません`)
    if (!PRICE_RANGES.has(p.price_range)) errs.push(`価格帯「${p.price_range}」がありません`)
    for (const s of p.situations ?? []) {
      if (!SITUATIONS.has(s)) errs.push(`シチュエーション「${s}」がありません`)
    }
    if (!(p.rating >= 1 && p.rating <= 5)) errs.push(`rating が範囲外です（${p.rating}）`)

    const hit = nearestArea(p.location_lat, p.location_lng, LOCAL_HIT_METERS)
    if (!hit) {
      errs.push(
        `${LOCAL_HIT_METERS / 1000}km 以内に内蔵エリアがありません`
          + '（投入時に Geocoding API を消費します）'
      )
    } else {
      const pref = PREFECTURE_BY_ID[hit.area.prefId]?.name
      if (hit.area.name !== p.area) {
        errs.push(`area: 記載「${p.area}」/ 座標からの判定「${hit.area.name}」`)
      }
      if (pref !== p.prefecture) {
        errs.push(`prefecture: 記載「${p.prefecture}」/ 座標からの判定「${pref}」`)
      }
    }

    if (errs.length) {
      bad++
      console.log(`  NG  @${username} / ${p.location_name}`)
      for (const e of errs) console.log(`        - ${e}`)
    }
  }
}

if (bad) {
  console.error(`\n${bad} / ${total} 件のデモ投稿に不整合があります。`)
  process.exit(1)
}
console.log(
  `OK: デモ投稿 ${total} 件すべて、座標からの判定と記載が一致しています`
    + '（Geocoding API を消費しません）'
)
