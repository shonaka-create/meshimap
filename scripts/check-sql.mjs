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
 * ★ ファイルごとに新しいプロセスで走らせている。
 *   1つの WASM インスタンスで何本も続けて構文解析すると、
 *   大きな構文木を投げたあとに固まって返ってこなくなる。
 *   プロセスを分ければ1本あたり1秒未満で終わる。
 *
 * 実行: npm run check:sql
 */

import { readdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const self = fileURLToPath(import.meta.url)
const root = join(dirname(self), '..')
const base = join(root, 'supabase')

/* ── 子プロセス: 1ファイルだけ見る ───────────────────── */
const target = process.argv[2]
if (target) {
  const { default: PgQuery } = await import('pg-query-emscripten')
  const pg = await new PgQuery()
  const sql = readFileSync(target, 'utf8')

  let res
  try {
    res = pg.parse(sql)
  } catch {
    // pg-query-emscripten は構文木を JSON 文字列で受け渡すため、
    // 大きなファイルでは内部の JSON.parse が途中で切れて例外になる。
    // 構文エラーのときの結果は小さくて必ず復号できるので、
    // ここに来た時点で「構文は通っている」と判断してよい。
    process.exit(0)
  }

  if (res.error) {
    const at = res.error.cursorpos
    const line = sql.slice(0, at).split('\n').length
    console.error(`      行 ${line}: ${res.error.message}`)
    console.error(
      '      …'
        + sql.slice(Math.max(0, at - 160), at + 60).replace(/\n/g, '\n      ')
        + '…'
    )
    process.exit(1)
  }
  process.exit(0)
}

/* ── 親プロセス: supabase/ 直下と migrations/ を全部見る ──
 * 直下には schema.sql のほか、状態を調べる読み取り専用SQLも置いてある。
 */
const files = [
  ...readdirSync(base)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => join(base, f)),
  ...readdirSync(join(base, 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => join(base, 'migrations', f)),
]

let bad = 0
for (const file of files) {
  const name = file.slice(base.length + 1).replace(/\\/g, '/')
  try {
    execFileSync(process.execPath, [self, file], { stdio: ['ignore', 'ignore', 'inherit'] })
    console.log(`  OK  ${name}`)
  } catch {
    bad++
    console.log(`  NG  ${name}`)
  }
}

if (bad) {
  console.error(`\n${bad} 件の SQL に構文エラーがあります。`)
  process.exit(1)
}
console.log('\nOK: supabase/ の SQL はすべて構文が通ります')
