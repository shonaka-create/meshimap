/**
 * lib/regions.ts（Web）と mobile/src/lib/regions.ts（Expo）の中身が
 * 一致しているかを確認する。
 *
 * この2つは別 npm プロジェクトのため import で共有できず、実体を複製している。
 * 片方だけ更新されると「Web では新宿、アプリでは代々木」のように
 * 同じ座標が別エリアとして集計され、地図の階層が静かに壊れる。
 *
 * 先頭のコメントブロックだけは意図的に違う（複製である旨の注意書き）ので、
 * 最初の `export` 以降を比較対象にする。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const FILES = {
  web: join(root, 'lib', 'regions.ts'),
  mobile: join(root, 'mobile', 'src', 'lib', 'regions.ts'),
}

/** 先頭コメントを落とし、改行コードの差も吸収する */
function body(path) {
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
  const at = text.indexOf('\nexport ')
  if (at === -1) throw new Error(`${path} に export が見つかりません`)
  return text.slice(at).trimEnd()
}

const web = body(FILES.web)
const mobile = body(FILES.mobile)

if (web === mobile) {
  console.log('OK: lib/regions.ts と mobile/src/lib/regions.ts は一致しています')
  process.exit(0)
}

// どこが違うのか分からないと直しようがないので、最初のずれた行を出す
const a = web.split('\n')
const b = mobile.split('\n')
const i = a.findIndex((line, n) => line !== b[n])

console.error('エラー: 地域データがずれています。')
console.error('  Web   : lib/regions.ts')
console.error('  Mobile: mobile/src/lib/regions.ts')
if (i !== -1) {
  console.error(`\n最初の差分（本文 ${i + 1} 行目）:`)
  console.error(`  Web   : ${a[i] ?? '(行なし)'}`)
  console.error(`  Mobile: ${b[i] ?? '(行なし)'}`)
} else {
  console.error(`\n行数が違います: Web ${a.length} 行 / Mobile ${b.length} 行`)
}
console.error('\n正しい方を残して、もう片方へコピーしてください。')
process.exit(1)
