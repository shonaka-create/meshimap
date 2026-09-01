/**
 * プロフィール画面が「開けること」だけを見るテスト。
 *
 * ★ 見ているのは、読み込み中 → 読み込み完了 の切り替わり。
 *   v1.0.2 のクラッシュは、早期リターンより後ろに useCallback を
 *   置いたせいで、完了した回だけフックが3つ増えて起きた。
 *   つまり「読み込み中の描画」と「完了後の描画」の両方を通さないと
 *   捕まらない。片方だけ描いて終わるテストでは意味がない。
 */
import { render, screen, waitFor } from '@testing-library/react-native'
import { makeSupabaseMock } from './supabaseMock'

const ME = '11111111-1111-1111-1111-111111111111'

const PROFILE = {
  id: ME,
  username: 'taro',
  display_name: '田中太郎',
  bio: 'よく食べる',
  photo_url: null,
  avatar_emoji: null,
  is_public: true,
  is_demo: false,
  posts_count: 15,
  areas_count: 4,
  followers_count: 3,
  following_count: 7,
  follow_on_map_count: 0,
}

jest.mock('../lib/supabase', () => ({
  supabase: require('./supabaseMock').makeSupabaseMock({}),
}))

jest.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: ME },
    profile: PROFILE,
    refreshProfile: jest.fn().mockResolvedValue(true),
  }),
}))

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  // 本物は画面に入るたびに走る。テストでは1回走れば足りる。
  useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]),
  Link: ({ children }: { children: React.ReactNode }) => children,
}))

/** テストごとに supabase の返り値を差し替える */
function setTables(tables: Record<string, unknown>) {
  const mod = require('../lib/supabase')
  const fresh = makeSupabaseMock(tables)
  mod.supabase.from = fresh.from
  mod.supabase.rpc = fresh.rpc
  mod.supabase.storage = fresh.storage
}

describe('ProfileView', () => {
  it('自分のプロフィールを開いても落ちない（読み込み中→完了まで）', async () => {
    setTables({
      profiles: { data: PROFILE, error: null },
      posts: { data: [], error: null },
      follows: { data: null, error: null },
    })
    const { ProfileView } = require('../components/ProfileView')

    render(<ProfileView selfId={ME} />)
    // 読み込みが終わって中身が出るところまで進める。
    // ここを通り抜けられれば、フックの数が途中で変わっていない。
    // 読み込みが終わって名前が出るところまで進める。
    // ここを通り抜けられれば、フックの数が途中で変わっていない。
    await waitFor(() => expect(screen.getByText('田中太郎')).toBeTruthy())
  })

  it('他人の非公開プロフィールを開いても落ちない', async () => {
    setTables({
      profiles: { data: { ...PROFILE, id: 'other', username: 'hanako', display_name: '花子', is_public: false }, error: null },
      posts: { data: [], error: null },
      follows: { data: null, error: null },
    })
    const { ProfileView } = require('../components/ProfileView')

    render(<ProfileView username="hanako" />)
    await waitFor(() => expect(screen.getByText('花子')).toBeTruthy())
  })

  it('取得に失敗しても落ちず、やり直せる案内を出す', async () => {
    setTables({ profiles: { data: null, error: { message: 'network' } } })
    const { ProfileView } = require('../components/ProfileView')

    render(<ProfileView selfId={ME} />)
    await waitFor(() => expect(screen.getByText('読み込めませんでした')).toBeTruthy())
  })

  it('相手が居なくても落ちない', async () => {
    setTables({ profiles: { data: null, error: null } })
    const { ProfileView } = require('../components/ProfileView')

    render(<ProfileView username="nobody" />)
    await waitFor(() => expect(screen.getByText('このアカウントは表示できません')).toBeTruthy())
  })
})
