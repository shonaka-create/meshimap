/**
 * 禁止語の一覧が、端末側とDB側で一致しているかを確認する。
 *
 *   mobile/src/lib/moderation.ts               … 押す前に教えるための判定
 *   supabase/migrations/0012_content_moderation.sql … 最後に止めるための判定
 *
 * 二重に持っているのは、片方だけでは足りないため。
 * 端末側は改造で外せるので止める力が無く、DB側だけだと
 * 入力し終えて送信するまで駄目だと分からない。
 *
 * ★ 食い違うと「端末では弾かれるのにDBは通す」（またはその逆）になる。
 *   前者は素通しの穴、後者は原因の分からない保存失敗になる。
 *   どちらも気付きにくいので、機械で見る。
 *
 * 実行: npm run check:moderation   （リポジトリ直下で）
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const TS_PATH = join(root, 'mobile', 'src', 'lib', 'moderation.ts')
const SQL_PATH = join(root, 'supabase', 'migrations', '0012_content_moderation.sql')

/**
 * TS と SQL のどちらからも、シングルクォートで囲まれた語だけを拾う。
 *
 * 行コメント（TS の // と SQL の --）は先に落とす。
 * 落とさないと、コメントに書いた語まで一覧に混ざる。
 * このファイルのコメントには実際に語が出てくる。
 */
function words(text, startMarker, endMarker) {
  const from = text.indexOf(startMarker)
  if (from === -1) throw new Error(`${startMarker} が見つかりません`)

  const to = text.indexOf(endMarker, from + startMarker.length)
  if (to === -1) throw new Error(`${startMarker} の終わり（${endMarker}）が見つかりません`)

  return text
    .slice(from + startMarker.length, to)
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').replace(/--.*$/, ''))
    .join('\n')
    .match(/'([^']*)'/g)
    ?.map((s) => s.slice(1, -1)) ?? []
}

const ts = readFileSync(TS_PATH, 'utf8').replace(/\r\n/g, '\n')
const sql = readFileSync(SQL_PATH, 'utf8').replace(/\r\n/g, '\n')

/**
 * 一覧ごとの、両側の切り出し位置。
 *
 * ★ TS 側の開始位置に `= [` まで含めているのは、型注釈の
 *   `readonly string[]` にある `]` を配列の終わりと取り違えるため。
 *   終わりは行頭の `]` で見る。
 */
const LISTS = [
  {
    name: 'SAFE_PHRASES / moderation_safe_phrases()',
    ts: ['export const SAFE_PHRASES: readonly string[] = [', '\n]'],
    sql: ['CREATE OR REPLACE FUNCTION public.moderation_safe_phrases()', ']::TEXT[]'],
  },
  {
    name: 'PROHIBITED_JA / moderation_prohibited_ja()',
    ts: ['export const PROHIBITED_JA: readonly string[] = [', '\n]'],
    sql: ['CREATE OR REPLACE FUNCTION public.moderation_prohibited_ja()', ']::TEXT[]'],
  },
  {
    name: 'PROHIBITED_LATIN / moderation_prohibited_latin()',
    ts: ['export const PROHIBITED_LATIN: readonly string[] = [', '\n]'],
    sql: ['CREATE OR REPLACE FUNCTION public.moderation_prohibited_latin()', ']::TEXT[]'],
  },
]

let failed = false

for (const list of LISTS) {
  const a = words(ts, ...list.ts)
  const b = words(sql, ...list.sql)

  if (a.length === 0) {
    console.error(`エラー: ${list.name} … 端末側から語を1つも読めませんでした`)
    failed = true
    continue
  }

  // 順序も含めて同じであることを見る。並びまで揃えておくと、
  // 語を足したときの差分が1行で済み、レビューで見落としにくい。
  const same = a.length === b.length && a.every((w, i) => w === b[i])
  if (same) {
    console.log(`OK: ${list.name}（${a.length}語）`)
    continue
  }

  failed = true
  console.error(`\nエラー: ${list.name} がずれています。`)

  const onlyTs = a.filter((w) => !b.includes(w))
  const onlySql = b.filter((w) => !a.includes(w))

  if (onlyTs.length) console.error(`  端末側にだけある: ${onlyTs.join(', ')}`)
  if (onlySql.length) console.error(`  DB側にだけある  : ${onlySql.join(', ')}`)
  if (!onlyTs.length && !onlySql.length) {
    const i = a.findIndex((w, n) => w !== b[n])
    console.error(`  語は同じですが並びが違います（${i + 1}番目: ${a[i]} / ${b[i]}）`)
  }
}

if (failed) {
  console.error('\n  端末側: mobile/src/lib/moderation.ts')
  console.error('  DB側  : supabase/migrations/0012_content_moderation.sql')
  console.error('\n正しい方を残して、もう片方へ同じ順で書き写してください。')
  console.error('DB側を直したら、本番の Supabase にも流し直すこと。')
  process.exit(1)
}

console.log('\nOK: 禁止語の一覧は端末側とDB側で一致しています')
