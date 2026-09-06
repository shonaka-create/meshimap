/**
 * 地図を乱暴に動かしたときの回帰テスト。
 *
 * なぜ要るか:
 *   「地図を適当に動かしているとクラッシュする」という報告があった。
 *   原因として、階層が切り替わるたびにバブル（Marker の子ビュー）を
 *   全部外して作り直していたことを疑い、外さない作りに直した。
 *   react-native-maps は新アーキテクチャ(Fabric)に非対応で
 *   互換層越しに動いており、地図が動いている最中に Marker の子を
 *   外すのがいちばん危ないため。
 *
 *   ネイティブ側の落ち方は jest では再現できない。
 *   代わりに「そこへ至る JS 側の振る舞い」を固定する:
 *     ・階層をまたぐ拡大縮小を繰り返しても例外が飛ばないこと
 *     ・バブルの取得が止まらなくなったりしないこと（暴走の検出）
 *     ・行き来を繰り返しても階層が発振しないこと
 *
 * ★ MapView は替え玉にして、渡された props を掴んでおく。
 *   onRegionChangeComplete はネイティブが呼ぶものなので、
 *   テストからは掴んだ関数を直接呼んで再現する。
 */
import { render, waitFor, act } from '@testing-library/react-native'

/** 最後に描かれた MapView の props。テストから触るので mock 接頭辞が要る */
const mockMapProps: { current: Record<string, unknown> | null } = { current: null }

jest.mock('react-native-maps', () => {
  const React = require('react')
  const { View } = require('react-native')
  const MapView = (props: Record<string, unknown>) => {
    // 描かれるたびに最新の props を控える。
    // onRegionChangeComplete は useCallback の依存で作り替わるので、
    // 古いものを掴んだままにすると、直近の状態を見ていないことになる。
    mockMapProps.current = props
    return React.createElement(View, null, props.children as React.ReactNode)
  }
  const Stub = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(View, null, children)
  return {
    __esModule: true,
    default: MapView,
    Marker: Stub,
    Callout: Stub,
    PROVIDER_GOOGLE: 'google',
    PROVIDER_DEFAULT: undefined,
  }
})

jest.mock('expo-router', () => {
  const React = require('react')
  const Passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children)
  return {
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
    useLocalSearchParams: () => ({}),
    useSegments: () => [],
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
    Link: Passthrough,
    Stack: Object.assign(Passthrough, { Screen: () => null }),
  }
})

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue({ coords: { latitude: 35.7, longitude: 139.74 } }),
  getLastKnownPositionAsync: jest.fn().mockResolvedValue(null),
  Accuracy: { High: 4 },
}))

jest.mock('expo-blur', () => {
  const React = require('react')
  const { View } = require('react-native')
  return { BlurView: () => React.createElement(View) }
})

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, right: 0, bottom: 34, left: 0 }),
}))

/**
 * DBの替え玉。
 *
 * ★ 鎖（.select().eq().or().order()...）は supabaseMock に任せること。
 *   自前で組むと、画面が使っているメソッドを1つ書き漏らしただけで
 *   「is not a function」になり、本物のバグと見分けがつかなくなる。
 *   数えたいのは呼ばれ方だけなので、そこだけ横から覗く。
 */
const mockRpc = jest.fn()
/** from() に渡されたテーブル名の記録 */
const mockFromTables: string[] = []

jest.mock('../lib/supabase', () => {
  const base = require('./supabaseMock').makeSupabaseMock({
    posts: { data: [], error: null },
    profiles: { data: null, error: null },
  })
  return {
    supabase: {
      ...base,
      from: (table: string) => {
        mockFromTables.push(table)
        return base.from(table)
      },
      rpc: (...args: unknown[]) => mockRpc(...args),
    },
  }
})

jest.mock('../hooks/useAuth', () => {
  const actual = jest.requireActual('../hooks/useAuth')
  return {
    ...actual,
    useAuth: () => ({ user: { id: 'u1' }, profile: null, loading: false, refreshProfile: jest.fn() }),
  }
})

beforeEach(() => {
  mockMapProps.current = null
  mockFromTables.length = 0
  mockRpc.mockReset()
  mockRpc.mockImplementation((name: string, params: Record<string, unknown>) => {
    if (name === 'map_pins') return Promise.resolve({ data: [], error: null })
    // post_counts_by_region
    const rows =
      params?.p_level === 'prefecture'
        ? [{ name: '東京都', center_lat: 35.68, center_lng: 139.76, post_count: 8 }]
        : [{ name: '神楽坂', center_lat: 35.7018, center_lng: 139.7405, post_count: 7 }]
    return Promise.resolve({ data: rows, error: null })
  })
})

/** ネイティブの代わりに「地図が動き終わった」を伝える */
async function moveTo(latitudeDelta: number) {
  const handler = mockMapProps.current?.onRegionChangeComplete as
    | ((r: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }) => void)
    | undefined
  expect(typeof handler).toBe('function')
  await act(async () => {
    handler!({ latitude: 35.7018, longitude: 139.7405, latitudeDelta, longitudeDelta: latitudeDelta })
    // 取得(Promise)が解決するところまで進める
    await Promise.resolve()
  })
}

async function renderMap() {
  const { ThemeSettingProvider } = require('../hooks/useThemeSetting')
  const HomeMap = require('../../app/(tabs)/index').default
  render(<ThemeSettingProvider><HomeMap /></ThemeSettingProvider>)
  await waitFor(() => expect(mockMapProps.current).not.toBeNull())
}

describe('地図を乱暴に動かす', () => {
  it('階層をまたぐ拡大縮小を繰り返しても落ちない', async () => {
    await renderMap()

    // 都道府県 → エリア → 投稿 → エリア → 都道府県 を何往復もする。
    // しきい値は index.tsx の定数どおり:
    //   降り: 県→エリア 1.2 未満 / エリア→投稿 0.10 未満
    //   戻り: 投稿→エリア 0.35 超 / エリア→県 3.0 超
    const journey = [14, 5, 1.0, 0.5, 0.08, 0.5, 2.0, 4.0, 0.9, 0.05, 1.0, 6.0]

    for (let lap = 0; lap < 3; lap++) {
      for (const d of journey) {
        await moveTo(d)
      }
    }

    // ここまで例外が飛んでいなければ合格。地図はまだ描かれている。
    expect(mockMapProps.current).not.toBeNull()
  })

  it('しきい値の境目で往復しても、取得が止まらなくなったりしない', async () => {
    await renderMap()

    const before = mockRpc.mock.calls.length

    // 県→エリアの境目(1.2)と、エリア→県の境目(3.0)のあいだを何度も往復する。
    // ★ 降りと戻りのしきい値には間隔が空けてある（1.2 と 3.0）。
    //   同じ値だと、降りた直後に戻る条件も満たして発振する。
    //   ここは「その間隔が詰められていないか」の見張りでもある。
    for (let i = 0; i < 10; i++) {
      await moveTo(1.0)   // 県 → エリアへ降りる
      await moveTo(4.0)   // エリア → 県へ戻る
    }

    const calls = mockRpc.mock.calls.length - before

    // 1往復で最大2回（降りと戻りで1回ずつ）。10往復なので20回程度が上限。
    // 発振していれば、ここは桁で増える。
    expect(calls).toBeLessThan(40)
  })

  it('バブルが取れていない一瞬に寄っても、県名をエリアとして開かない', async () => {
    // ★ 実際にあったバグの再現。
    //   階層を切り替えた直後は drill.level が area になっていても、
    //   バブルはまだ県のまま。そこで一気に寄ると、
    //   降り先を「県のバブル」から選んでしまい、
    //   県名（東京都）をエリア名として投稿を探しに行っていた。
    //   投稿0件の行き止まりに取り残される。
    //
    // ★ 「県のバブルが入っている」状態を必ず作ってから寄ること。
    //   最初これを怠って、バブルが空("length === 0"で即 return)のまま
    //   試していた。ガードを外しても通ってしまい、
    //   テストが何も見ていなかった。

    // エリアの集計だけ返さない＝「降りたのに中身は県のまま」を作る
    mockRpc.mockImplementation((name: string, params: Record<string, unknown>) => {
      if (name === 'map_pins') return Promise.resolve({ data: [], error: null })
      if (params?.p_level === 'prefecture') {
        return Promise.resolve({
          data: [{ name: '東京都', center_lat: 35.68, center_lng: 139.76, post_count: 8 }],
          error: null,
        })
      }
      return new Promise(() => {})   // 永遠に解決しない
    })

    await renderMap()

    // 県のバブルが実際に入るまで待つ。ここを待たないとテストが空振りする。
    await waitFor(() => {
      expect(
        mockRpc.mock.calls.some(
          ([n, p]) => n === 'post_counts_by_region' && p?.p_level === 'prefecture'
        )
      ).toBe(true)
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    await moveTo(1.0)    // 県 → エリアへ降りる

    // 降りたことを確かめる（エリアの集計を要求している）
    expect(
      mockRpc.mock.calls.some(
        ([n, p]) => n === 'post_counts_by_region' && p?.p_level === 'area'
      )
    ).toBe(true)

    const before = mockRpc.mock.calls.length
    await moveTo(0.05)   // 中身が県のままなのに、さらに一気に寄る

    // 投稿を取りに行っていないこと。
    // 行っていれば、県のバブル（東京都）をエリア名だと思って開いている。
    //
    // ★ 見張る先は posts_in_area（移行0019）。
    //   以前は from('posts') を直接引いていたのでテーブル名を見ていたが、
    //   フォローの絞り込みをDB側へ移したときに呼び先が変わった。
    //   古いままにすると、何も呼ばれなくなったぶん常に通る
    //   ＝また「何も見ていないテスト」になる。
    const opened = mockRpc.mock.calls
      .slice(before)
      .filter(([name]) => name === 'posts_in_area')
    expect(opened).toEqual([])
  })

  it('県の一覧にエリア名が紛れていても、それを県として開かない', async () => {
    // ★ 実際にあった不具合の再現。
    //   パンくずが「全国 › 東京都 › 神楽坂」になるはずのところ、
    //   「全国 › 神楽坂」になり、0地域・計0件の行き止まりになっていた。
    //   drill.prefecture にエリア名が入ってしまうと、
    //   以後のエリア集計の絞り込み条件もエリア名で引くので、
    //   どのバブルも出ず、そこから降りることもできない。
    //
    //   原因は「印は新しいのに中身は前の階層のまま」という一瞬で、
    //   そこは regionsRef を1つにまとめて塞いだ。
    //   ここで見張るのは、それをすり抜けたときの最後の砦——
    //   降り先の名前が本当に県名かどうか——のほう。
    //   県の集計にエリア名が返ってきたことにして、降りないことを確かめる。
    mockRpc.mockImplementation((name: string, params: Record<string, unknown>) => {
      if (name === 'map_pins') return Promise.resolve({ data: [], error: null })
      if (params?.p_level === 'prefecture') {
        return Promise.resolve({
          data: [{ name: '神楽坂', center_lat: 35.7018, center_lng: 139.7405, post_count: 7 }],
          error: null,
        })
      }
      return Promise.resolve({ data: [], error: null })
    })

    await renderMap()

    // バブルが実際に入るまで待つ。待たないと空のまま(length === 0 で即 return)
    // 試すことになり、ガードを外しても通ってしまう。
    await waitFor(() => {
      expect(
        mockRpc.mock.calls.some(
          ([n, p]) => n === 'post_counts_by_region' && p?.p_level === 'prefecture'
        )
      ).toBe(true)
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const before = mockRpc.mock.calls.length
    await moveTo(1.0)   // 県 → エリアへ降りようとする

    // エリアの集計を取りに行っていないこと。
    // 行っていれば、エリア名（神楽坂）を県として開いている。
    const descended = mockRpc.mock.calls
      .slice(before)
      .filter(([n, p]) => n === 'post_counts_by_region' && p?.p_level === 'area')
    expect(descended).toEqual([])
  })
})
