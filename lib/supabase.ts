import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Web Locks API の lock 競合（bfcache 復元時の白画面）を防ぐため lock を無効化
    lock: async (_name, _acquireTimeout, fn) => fn(),
  },
})
