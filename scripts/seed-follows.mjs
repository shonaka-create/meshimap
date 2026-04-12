/**
 * 全アカウント間を相互フォローにするスクリプト（各ユーザーとしてサインイン）
 * 実行: node scripts/seed-follows.mjs
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://eeyfbohwyvxwglzmpgov.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_Nc-UnYPPW2PMveOS_FaHhg_hGRlYooI'

// ★ demo_ebi のメールアドレスを設定してください
const ACCOUNTS = [
  { email: 'taro.meshimap@gmail.com',    password: 'password123' },
  { email: 'hanako.meshimap@gmail.com',  password: 'password123' },
  { email: 'kenji.meshimap@gmail.com',   password: 'password123' },
  { email: 'yuki.meshimap@gmail.com',    password: 'password123' },
  { email: 'yamada.meshimap@gmail.com',  password: 'password123' },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// まず全プロフィールIDを取得（匿名で可）
const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const { data: allProfiles } = await anonClient.from('profiles').select('id, display_name')
const allIds = allProfiles?.map((p) => p.id) ?? []
console.log(`全体 ${allIds.length} アカウント\n`)

for (const account of ACCOUNTS) {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { data: authData, error: authErr } = await client.auth.signInWithPassword({
    email: account.email, password: account.password,
  })
  if (authErr || !authData.user) {
    console.error(`❌ ログイン失敗 ${account.email}: ${authErr?.message}`)
    continue
  }
  const myId = authData.user.id
  const myName = allProfiles?.find((p) => p.id === myId)?.display_name ?? account.email

  // 自分以外の全員をフォロー
  const targets = allIds.filter((id) => id !== myId)
  const rows = targets.map((following_id) => ({ follower_id: myId, following_id }))
  const { error: followErr } = await client.from('follows').upsert(rows, {
    onConflict: 'follower_id,following_id', ignoreDuplicates: true,
  })
  if (followErr) {
    console.error(`  ❌ ${myName} フォロー失敗: ${followErr.message}`)
  } else {
    console.log(`  ✅ ${myName} → ${targets.length}人をフォロー`)
  }
  await client.auth.signOut()
  await sleep(500)
}

// カウントを再集計
console.log('\nカウントを再集計中...')
for (const p of allProfiles) {
  const { count: fc } = await anonClient.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', p.id)
  const { count: ing } = await anonClient.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', p.id)
  await anonClient.from('profiles').update({ followers_count: fc ?? 0, following_count: ing ?? 0 }).eq('id', p.id)
  console.log(`  ${p.display_name}: フォロワー ${fc} / フォロー中 ${ing}`)
}

console.log('\n✅ 完了')
