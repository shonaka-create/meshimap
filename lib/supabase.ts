import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key'

// createBrowserClient はブラウザでシングルトンを返す。
// @supabase/ssr 経由にすることで Next.js App Router と Cookie ベースで整合し、
// Navigator Lock のオーファン問題（React Strict Mode 二重 mount）を回避する。
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Strict Mode の二重 mount で古いロックが残った場合に即スティールして回復する
    lockAcquireTimeout: 0,
  },
})
