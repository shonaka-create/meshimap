import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// 未設定のときにダミーの URL へフォールバックすると、接続先が存在しないまま
// 起動してしまい、ログイン失敗が「原因不明のネットワークエラー」として出る。
// mobile/src/lib/supabase.ts と同じく、ここで落として気づけるようにする。
if (!url || !anonKey) {
  throw new Error(
    'Supabase の URL / anon key が未設定です。.env.local に ' +
      'NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY を設定して、' +
      'dev サーバーを再起動してください。' +
      '（本番は Vercel の Environment Variables に設定し、再デプロイが必要です）'
  )
}

export const supabaseUrl = url
const supabaseAnonKey = anonKey

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
