/**
 * テストユーザー5件を作成するスクリプト
 * 実行: node scripts/seed-users.mjs
 *
 * ※ Supabaseに schema.sql を適用した後に実行してください
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://eeyfbohwyvxwglzmpgov.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_Nc-UnYPPW2PMveOS_FaHhg_hGRlYooI'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const TEST_USERS = [
  { email: 'taro.meshimap@gmail.com', password: 'password123', displayName: '田中太郎' },
  { email: 'hanako.meshimap@gmail.com', password: 'password123', displayName: '佐藤花子' },
  { email: 'kenji.meshimap@gmail.com', password: 'password123', displayName: '鈴木健二' },
  { email: 'yuki.meshimap@gmail.com', password: 'password123', displayName: '伊藤由紀' },
  { email: 'yamada.meshimap@gmail.com', password: 'password123', displayName: '山田翔太' },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

for (const u of TEST_USERS) {
  const { data, error } = await supabase.auth.signUp({
    email: u.email,
    password: u.password,
    options: { data: { full_name: u.displayName } },
  })

  if (error) {
    console.error(`❌ ${u.email}: ${error.message}`)
    await sleep(2000)
    continue
  }

  if (data.user) {
    const { error: profileError } = await supabase.from('profiles').upsert(
      { id: data.user.id, display_name: u.displayName },
      { onConflict: 'id', ignoreDuplicates: true }
    )
    if (profileError) {
      console.error(`  プロフィール作成失敗: ${profileError.message}`)
    } else {
      console.log(`✅ ${u.displayName} (${u.email}) 作成完了`)
    }
  }
  await sleep(1500)
}

console.log('\n全アカウントのパスワード: password123')
