/**
 * フォロー一覧の画面が「開けること」を見る。
 *
 * この画面は移行 0015 の RPC（followers_of / following_of）に
 * ぶら下がっている。DB が空を返したとき・エラーを返したときにも
 * 落ちずに何か出すのが最低条件。
 */
import { render, screen, waitFor } from '@testing-library/react-native'
import { makeSupabaseMock } from './supabaseMock'

const ME = '11111111-1111-1111-1111-111111111111'

jest.mock('../lib/supabase', () => ({
  supabase: require('./supabaseMock').makeSupabaseMock({}),
}))

jest.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: ME }, profile: null, refreshProfile: jest.fn() }),
}))

jest.mock('expo-router', () => {
  const React = require('react')
  return {
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    useLocalSearchParams: () => ({ userId: ME, displayName: '田中太郎', tab: 'followers' }),
    Stack: { Screen: () => React.createElement(React.Fragment) },
  }
})

function setRpc(result: unknown) {
  const mod = require('../lib/supabase')
  // rpc は名前で分岐しないので、どの RPC も同じ結果を返す
  mod.supabase.rpc = () => makeSupabaseMock({ __rpc: result }).rpc()
}

describe('フォロー一覧', () => {
  it('一覧が返ってきたら並べる', async () => {
    setRpc({
      data: [{
        id: 'u2', username: 'hanako', display_name: '花子',
        photo_url: null, avatar_emoji: null, posts_count: 3, areas_count: 1,
        is_public: true, is_admin: false, followed_at: '2026-01-01T00:00:00Z',
      }],
      error: null,
    })
    const Screen = require('../../app/follows').default

    render(<Screen />)
    await waitFor(() => expect(screen.getByText('花子')).toBeTruthy())
  })

  it('0件でも落ちない', async () => {
    setRpc({ data: [], error: null })
    const Screen = require('../../app/follows').default

    render(<Screen />)
    // 何かしら描き終わること。落ちなければここまで来る。
    await waitFor(() => expect(screen.toJSON()).toBeTruthy())
  })

  it('DBがエラーを返しても落ちない', async () => {
    setRpc({ data: null, error: { message: 'boom' } })
    const Screen = require('../../app/follows').default

    render(<Screen />)
    await waitFor(() => expect(screen.toJSON()).toBeTruthy())
  })
})
