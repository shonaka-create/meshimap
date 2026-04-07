import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key'

// createBrowserClient はブラウザでシングルトンを返す。
// @supabase/ssr 経由にすることで Next.js App Router と整合し、
// Navigator Lock のオーファン問題（React Strict Mode 二重 mount）を回避する。
// lockAcquireTimeout はデフォルト（5000ms）のまま使う。
// 0 にすると「即取得できなければエラー」になり INITIAL_SESSION が発火しなくなる。
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)
