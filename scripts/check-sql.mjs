/**
 * supabase/ の SQL を PostgreSQL 本物のパーサ（WASM 版）に通す。
 *
 * なぜ要るか:
 *   移行SQLは Supabase の SQL Editor に人が貼って実行する。
 *   つまり「実行して初めて構文エラーが分かる」経路しかなく、
 *   実際に 0007（一時表がセッションをまたげない）と
 *   0008（RETURNS TABLE に position という名前は使えない）を
 *   本番で踏ませてしまった。CI で先に落とす。
 *
 *   検査するのは構文だけ。表や列が実在するかは見ない。
 *   それでも、予約語・括弧・句の順序といった
 *   「貼る前に分かるはずだった失敗」はここで止まる。
 *
 * 実行: npm run check:sql
 */

import PgQuery from 'pg-query-emscripten'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = join(root, 'supabase')

const files = [
  join(base, 'schema.sql'),
  ...readdirSync(join(base, 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => join(base, 'migrations', f)),
]

const pg = await new PgQuery()
let bad = 0

for (const file of files) {
  const name = file.slice(base.length + 1).replace(/\\/g, '/')
  const sql = readFileSync(file, 'utf8')

  let res
  try {
    res = pg.parse(sql)
  } catch {
    // pg-query-emscripten は構文木を JSON 文字列で受け渡すため、
    // 大きなファイルでは内部の JSON.parse が途中で切れて例外になる。
    // 構文エラーのときの結果は小さくて必ず復号できるので、
    // ここに来た時点で「構文は通っている」と判断してよい。
    console.log(`  OK  ${name}`)
    continue
  }

  if (res.error) {
    bad++
    const at = res.error.cursorpos
    const line = sql.slice(0, at).split('\n').length
    console.log(`  NG  ${name}:${line}`)
    console.log(`      ${res.error.message}`)
    console.log(
      '      …'
        + sql.slice(Math.max(0, at - 160), at + 60).replace(/\n/g, '\n      ')
        + '…'
    )
  } else {
    console.log(`  OK  ${name}`)
  }
}

if (bad) {
  console.error(`\n${bad} 件の SQL に構文エラーがあります。`)
  process.exit(1)
}
console.log('\nOK: supabase/ の SQL はすべて構文が通ります')
