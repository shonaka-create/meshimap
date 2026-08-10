#!/usr/bin/env node
/**
 * .env.local の値を Vercel の Environment Variables へ登録する。
 *
 * なぜスクリプトにするか:
 *   3変数 × 3環境 = 9回、画面に貼り付ける作業になる。
 *   鍵は長く、末尾の1文字が欠けても気付けない。
 *   さらに GOOGLE_GEOCODING_KEY を誤って NEXT_PUBLIC_ 側に入れると、
 *   ブラウザに出た瞬間に第三者が課金を使い切れる。
 *   Geocoding のウェブサービスは HTTP リファラ制限を無視するため、
 *   鍵を絞って被害を止めることができない。
 *   手で9回運ぶより、名前を固定してまとめて流したほうが安全。
 *
 * 値は一切表示しない。ログに残ると .env.local を隠している意味が無くなる。
 *
 * 使い方:
 *   npx vercel login && npx vercel link   ← 先に済ませること
 *   node scripts/vercel-env.mjs --dry-run  ← 何を送るか確認
 *   node scripts/vercel-env.mjs
 */

import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry-run')

/**
 * Web が実際に使っている変数だけ。
 * grep で確かめたもの以外は送らない。使っていない鍵を本番に置くと、
 * 消し忘れたまま残り、あとから何のために置いたか分からなくなる。
 */
const VARS = [
  {
    name: 'NEXT_PUBLIC_SUPABASE_URL',
    required: true,
    note: 'Supabase 接続先。NEXT_PUBLIC_ なのでブラウザに出る（設計通り）',
  },
  {
    name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    required: true,
    note: '匿名キー。ブラウザに出る前提で、RLS で守る',
  },
  {
    // app/api/geocode/route.ts は鍵が無ければ null を返し、
    // 呼び出し側は内蔵の地域データだけで判定を続ける。
    // つまり無くてもデプロイは通り、投稿も止まらない。
    // 入っていない環境で「必須」と言って止めるほうが害になる。
    name: 'GOOGLE_GEOCODING_KEY',
    required: false,
    note: '★ サーバー専用。NEXT_PUBLIC_ を付けないこと。未設定なら内蔵データだけで判定する',
  },
]

const TARGETS = ['production', 'preview', 'development']

// ---- .env.local を読む ----------------------------------------
const envPath = resolve(ROOT, '.env.local')
if (!existsSync(envPath)) {
  console.error('❌ .env.local がありません:', envPath)
  process.exit(1)
}

/** KEY=VALUE を読む。引用符は外す。値は返すだけで、決して出力しない。 */
function parseEnv(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    out[m[1]] = v
  }
  return out
}

const env = parseEnv(readFileSync(envPath, 'utf8'))

// ---- 事前確認 --------------------------------------------------
const missingRequired = VARS.filter((v) => v.required && !env[v.name])
if (missingRequired.length) {
  console.error('❌ .env.local に必須の変数がありません。これが無いとビルドが落ちます:')
  for (const v of missingRequired) console.error(`   ${v.name}  … ${v.note}`)
  process.exit(1)
}

const skipped = VARS.filter((v) => !v.required && !env[v.name])
for (const v of skipped) {
  console.warn(`⚠️  ${v.name} は .env.local にありません。送信を飛ばします。`)
  console.warn(`   ${v.note}\n`)
}

/** 実際に送るもの */
const sending = VARS.filter((v) => env[v.name])

// 取り違えの検出。これを本番に置くと課金を守れなくなる。
if (env.NEXT_PUBLIC_GOOGLE_GEOCODING_KEY) {
  console.error('❌ NEXT_PUBLIC_GOOGLE_GEOCODING_KEY が .env.local にあります。')
  console.error('   Geocoding の鍵はブラウザに出してはいけません。')
  console.error('   NEXT_PUBLIC_ を外して GOOGLE_GEOCODING_KEY にしてください。')
  process.exit(1)
}

// dry-run は何も送らないので、リンク前でも中身を確認できるようにする。
if (!DRY && !existsSync(resolve(ROOT, '.vercel/project.json'))) {
  console.error('❌ プロジェクトがまだ Vercel にリンクされていません。')
  console.error('   先に実行してください:')
  console.error('     npx vercel login')
  console.error('     npx vercel link')
  process.exit(1)
}

// ---- 登録 ------------------------------------------------------
console.log(`${DRY ? '🔍 (dry-run) ' : '🚀 '}Vercel に環境変数を登録します\n`)

let failed = 0
for (const v of sending) {
  console.log(`  ${v.name}`)
  console.log(`    ${v.note}`)
  for (const target of TARGETS) {
    if (DRY) {
      console.log(`    - ${target}: 送信予定（${env[v.name].length} 文字）`)
      continue
    }
    // 値は stdin で渡す。引数に置くとプロセス一覧やシェル履歴に残る。
    const r = spawnSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['vercel', 'env', 'add', v.name, target],
      { input: env[v.name] + '\n', cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' },
    )
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    if (r.status === 0) {
      console.log(`    ✅ ${target}`)
    } else if (/already exists/i.test(out)) {
      // 上書きは自動でやらない。消すつもりのない値を消す事故が起きる。
      console.log(`    ⏭️  ${target}: 既に登録済み（変更するなら先に vercel env rm）`)
    } else {
      failed++
      console.log(`    ❌ ${target}: 登録できませんでした`)
      console.log(`       ${out.trim().split('\n').slice(-3).join('\n       ')}`)
    }
  }
  console.log('')
}

if (DRY) {
  console.log('dry-run です。実際には送っていません。')
  process.exit(0)
}

if (failed) {
  console.error(`❌ ${failed}件 失敗しました。`)
  process.exit(1)
}

console.log('✅ 完了。次にデプロイしてください:')
console.log('     npx vercel --prod')
console.log('')
console.log('👉 デプロイ後、Google Maps の鍵の HTTP リファラ制限に')
console.log('   新しいドメインを追加してください（Web の地図が白くなります）。')
