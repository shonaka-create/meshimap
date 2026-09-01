/**
 * 設定画面が「開けること」を見る。
 *
 * ここは見た目の設定（ライト/ダーク）を足したときに
 * useThemeSetting を差し込んだ場所なので、フックの並びが崩れやすい。
 */
import { render, screen, waitFor } from '@testing-library/react-native'

const ME = '11111111-1111-1111-1111-111111111111'

jest.mock('../lib/supabase', () => ({
  supabase: require('./supabaseMock').makeSupabaseMock({
    follows: { count: 0, data: [], error: null },
    profiles: { data: null, error: null },
  }),
}))

jest.mock('../hooks/useAuth', () => ({
  PHOTO_CLEANUP_FAILED: 'PHOTO_CLEANUP_FAILED',
  useAuth: () => ({
    user: { id: ME },
    profile: {
      id: ME, username: 'taro', display_name: '田中太郎',
      is_public: true, is_admin: false, posts_count: 1, areas_count: 1,
    },
    signOut: jest.fn(),
    deleteAccount: jest.fn(),
    refreshProfile: jest.fn().mockResolvedValue(true),
  }),
}))

jest.mock('expo-router', () => {
  const React = require('react')
  return {
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
    Stack: { Screen: () => React.createElement(React.Fragment) },
  }
})

it('設定画面が開ける（見た目の設定つき）', async () => {
  const Settings = require('../../app/settings/index').default
  // ★ 実アプリの app/_layout.tsx と同じ形で包むこと。
  //   包まずに描くと本番と違う木を試すことになり、テストの意味が薄れる。
  const { ThemeSettingProvider } = require('../hooks/useThemeSetting')
  render(<ThemeSettingProvider><Settings /></ThemeSettingProvider>)
  await waitFor(() => expect(screen.getByText('画面の見た目')).toBeTruthy())
})
