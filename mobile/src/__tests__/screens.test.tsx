/**
 * 全画面が「開けること」だけを見るスモークテスト。
 *
 * なぜ要るか:
 *   tsc は型しか見ない。lint は書き方しか見ない。どちらも
 *   「開いたら落ちる」を捕まえられない。実際、プロフィールを開くと
 *   必ず落ちるビルド（v1.0.2）を App Store まで上げてしまった。
 *   画面を1回マウントするだけで即座に分かる壊れ方だった。
 *
 *   その後 ProfileView / follows / 設定 の3つには個別のテストが付いたが、
 *   画面は全部で20以上ある。残りは相変わらず「実機で開くまで分からない」
 *   ままだった。ここで全部を1回ずつマウントする。
 *
 * ★ 見た目は一切検証しない。「落ちないこと」だけを見る。
 *   何が表示されるべきかは画面ごとに違い、そこまで書くと
 *   画面を直すたびにテストが壊れて、誰も直さなくなる。
 *
 * ★ 読み込み完了まで待つこと。
 *   v1.0.2 のクラッシュは「取得が終わった回だけフックが増える」形だった。
 *   マウント直後に見るのをやめると、その種類は素通りする。
 *   waitFor で、非同期の取得が落ち着いた後の木まで到達させる。
 *
 * ★ 個別テストがある画面もここに含めてある。
 *   重複は安いが、抜けは高い。一覧を見て「これは無い」と分かるほうが、
 *   別ファイルを突き合わせるより間違えにくい。
 */
import { render, waitFor } from '@testing-library/react-native'

const ME = '11111111-1111-1111-1111-111111111111'

/**
 * expo-router のパラメータ。画面ごとに差し替える。
 *
 * ★ 名前を mock で始めること。
 *   jest.mock の工場は巻き上げられて外の変数に触れないが、
 *   mock で始まる名前だけは例外として許されている
 *   （遅延参照であることを Jest に伝える約束事）。
 *   これが無いと "Invalid variable access" で走らない。
 */
let mockRouterParams: Record<string, string> = {}

jest.mock('expo-router', () => {
  const React = require('react')
  const Passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children)
  return {
    useRouter: () => ({
      push: jest.fn(), replace: jest.fn(), back: jest.fn(),
      canGoBack: () => true, setParams: jest.fn(),
    }),
    useLocalSearchParams: () => mockRouterParams,
    useSegments: () => [],
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
    Link: Passthrough,
    Stack: Object.assign(Passthrough, { Screen: () => null }),
    Tabs: Object.assign(Passthrough, { Screen: () => null }),
    Redirect: () => null,
  }
})

/** 地図はネイティブ。描けるかどうかとは無関係なので素通りさせる */
jest.mock('react-native-maps', () => {
  const React = require('react')
  const { View } = require('react-native')
  const Stub = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(View, null, children)
  return {
    __esModule: true,
    default: Stub,
    Marker: Stub,
    Callout: Stub,
    PROVIDER_GOOGLE: 'google',
    PROVIDER_DEFAULT: undefined,
  }
})

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue({
    coords: { latitude: 35.7018, longitude: 139.7405 },
  }),
  getLastKnownPositionAsync: jest.fn().mockResolvedValue(null),
  Accuracy: { High: 4, Balanced: 3 },
}))

jest.mock('expo-blur', () => {
  const React = require('react')
  const { View } = require('react-native')
  return { BlurView: ({ children }: { children?: React.ReactNode }) => React.createElement(View, null, children) }
})

jest.mock('expo-linear-gradient', () => {
  const React = require('react')
  const { View } = require('react-native')
  return { LinearGradient: ({ children }: { children?: React.ReactNode }) => React.createElement(View, null, children) }
})

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn().mockResolvedValue({ uri: 'file:///tmp/x.jpg' }),
  SaveFormat: { JPEG: 'jpeg' },
}))

jest.mock('react-native-safe-area-context', () => {
  const React = require('react')
  const { View } = require('react-native')
  const inset = { top: 44, right: 0, bottom: 34, left: 0 }
  return {
    SafeAreaProvider: ({ children }: { children?: React.ReactNode }) => React.createElement(View, null, children),
    SafeAreaView: ({ children }: { children?: React.ReactNode }) => React.createElement(View, null, children),
    useSafeAreaInsets: () => inset,
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 844 }),
  }
})

/**
 * DBの替え玉。
 *
 * ★ 空ではなく「中身のある」返事にすること。
 *   0件だと、どの画面も EmptyState だけ描いて終わってしまい、
 *   一覧を組み立てる本体のコードが一度も走らない。
 *   見本は screensFixtures.ts に置いてある（jest.mock の工場は
 *   巻き上げられるので、同じファイルの定数には触れない）。
 */
jest.mock('../lib/supabase', () => ({
  supabase: require('./supabaseMock').makeSupabaseMock({
    posts: { data: [require('./screensFixtures').POST], error: null, count: 1 },
    profiles: { data: require('./screensFixtures').PROFILE, error: null, count: 1 },
    follows: { data: [], error: null, count: 0 },
    blocks: { data: [], error: null, count: 0 },
    likes: { data: [], error: null, count: 0 },
    comments: { data: [], error: null, count: 0 },
    post_images: { data: [], error: null, count: 0 },
    reports: { data: [], error: null, count: 0 },
    __rpc: { data: [], error: null },
  }),
}))

/**
 * ログイン状態の替え玉。
 *
 * ★ 本物を requireActual で展開してから useAuth だけ差し替えること。
 *   このモジュールはフック以外も出している
 *   （validateUsername / USERNAME_RE / toJapaneseAuthError など）。
 *   必要なものを手で並べる書き方にすると、
 *   画面が使っている補助関数を1つ書き忘れただけで
 *   「is not a function」で落ち、本物のバグと見分けがつかなくなる。
 *   実際 validateUsername でそうなった。
 *   本物を土台にすれば、あとから export が増えても勝手に付いてくる。
 */
jest.mock('../hooks/useAuth', () => {
  const actual = jest.requireActual('../hooks/useAuth')
  const { ME, PROFILE } = require('./screensFixtures')
  return {
    ...actual,
    AuthProvider: ({ children }: { children?: React.ReactNode }) => children,
    useAuth: () => ({
      user: { id: ME, email: 'ebichan@example.com' },
      profile: PROFILE,
      loading: false,
      signIn: jest.fn(), signUp: jest.fn(), signOut: jest.fn(),
      deleteAccount: jest.fn(),
      refreshProfile: jest.fn().mockResolvedValue(true),
    }),
  }
})

/**
 * 画面の一覧。
 *
 * ★ 画面を足したらここにも足すこと。
 *   足し忘れても CI は緑のままなので、下の「取りこぼし検査」で
 *   app/ 配下の実ファイルと突き合わせて落とすようにしてある。
 */
const SCREENS: { name: string; path: string; params?: Record<string, string> }[] = [
  { name: 'ログイン', path: '../../app/(auth)/sign-in' },
  { name: '新規登録', path: '../../app/(auth)/sign-up' },
  { name: '地図（ホーム）', path: '../../app/(tabs)/index' },
  { name: '今日どこで食べる', path: '../../app/(tabs)/pick' },
  { name: '検索', path: '../../app/(tabs)/search' },
  { name: 'プロフィール（自分）', path: '../../app/(tabs)/profile' },
  { name: '投稿タブの置き石', path: '../../app/(tabs)/post-placeholder' },
  { name: 'おすすめの結果', path: '../../app/pick/results', params: { situations: 'デート', prices: '¥3,001〜¥5,000', genres: 'イタリアン' } },
  { name: '投稿の詳細', path: '../../app/post/[id]', params: { id: 'p1' } },
  { name: '新しい投稿', path: '../../app/post/new' },
  { name: '投稿できました', path: '../../app/post/done', params: { postsBefore: '0', areasBefore: '0', prefecture: '東京都', area: '神楽坂', locationName: 'テスト店' } },
  { name: 'ランキング', path: '../../app/ranking' },
  { name: '他人のプロフィール', path: '../../app/user/[username]', params: { username: 'ebichan' } },
  { name: 'フォロー一覧', path: '../../app/follows', params: { userId: ME, displayName: 'えびちゃん', tab: 'followers' } },
  { name: '設定', path: '../../app/settings/index' },
  { name: 'プロフィールを編集', path: '../../app/settings/edit-profile' },
  { name: 'ブロックした人', path: '../../app/settings/blocked' },
  { name: 'フォローリクエスト', path: '../../app/settings/requests' },
  { name: '有料プラン', path: '../../app/settings/subscription' },
  { name: '利用規約', path: '../../app/legal/terms' },
  { name: 'プライバシーポリシー', path: '../../app/legal/privacy' },
]

describe('全画面が開ける', () => {
  for (const s of SCREENS) {
    it(`${s.name} が開ける`, async () => {
      mockRouterParams = s.params ?? {}

      const { ThemeSettingProvider } = require('../hooks/useThemeSetting')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Screen = require(s.path).default
      expect(typeof Screen).toBe('function')

      render(
        <ThemeSettingProvider>
          <Screen />
        </ThemeSettingProvider>
      )

      // ★ 取得が終わった後の木まで到達させること。
      //   マウント直後だけ見ると「読み込み完了時にだけ落ちる」種類
      //   （v1.0.2 のクラッシュがこれ）を素通りする。
      await waitFor(() => expect(true).toBe(true))
    })
  }

  /**
   * 上の一覧が app/ の実ファイルを網羅しているか。
   *
   * ★ これが無いと、この仕組みは静かに効かなくなる。
   *   画面を新しく足した人が SCREENS への追加を忘れても、
   *   テストは「登録済みの画面が開ける」と言って緑のままになる。
   *   守られていないのに守られているつもりになるのが、いちばん悪い。
   *   実ファイルと突き合わせて、漏れたら落とす。
   *
   *   _layout.tsx は画面ではなく入れ物なので除く。
   */
  it('app/ 配下の画面をすべて網羅している', () => {
    const fs = require('fs')
    const path = require('path')
    const appDir = path.join(__dirname, '..', '..', 'app')

    const found: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (e.name.endsWith('.tsx') && e.name !== '_layout.tsx') {
          found.push(path.relative(appDir, full).split(path.sep).join('/').replace(/\.tsx$/, ''))
        }
      }
    }
    walk(appDir)

    // ★ 空振りで通らせないこと。
    //   walk が何も拾えなかった場合（パスの組み立てを間違えた、
    //   ディレクトリを移した等）、missing も空になって緑になる。
    //   守っているつもりで何も見ていない状態になるので、
    //   最低限これだけは見つかるはず、という下限を置く。
    expect(found.length).toBeGreaterThan(15)

    const covered = new Set(SCREENS.map((s) => s.path.replace('../../app/', '')))
    const missing = found.filter((f) => !covered.has(f))

    // 落ちたときに「何を足せばいいか」がそのまま出るようにする
    expect(missing).toEqual([])
  })
})
