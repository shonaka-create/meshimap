import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import MapView, { Marker, type MapPressEvent, type Region } from 'react-native-maps'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../../src/lib/supabase'
import {
  useTheme, space, radius, shadow, GENRE_EMOJI, GENRES,
} from '../../src/theme'
import { Txt, Chip } from '../../src/components/ui'
import { useLocation } from '../../src/hooks/useLocation'
import { MAP_PROVIDER } from '../../src/lib/mapProvider'
import type { MapPin, Post, RegionCount, RegionLevel } from '../../src/lib/types'
import { toPost } from '../../src/lib/posts'
import { PREFECTURE_BY_NAME } from '../../src/lib/regions'
import { PostPreviewSheet } from '../../src/components/PostPreviewSheet'
import { RankAvatar } from '../../src/components/RankAvatar'
import {
  CloudTransition, CLEAR_MS, COVER_MS, type CloudTransitionHandle,
} from '../../src/components/CloudTransition'
import { MapAudienceDrawer } from '../../src/components/MapAudienceDrawer'
import { useAuth } from '../../src/hooks/useAuth'
import { RANKS } from '../../src/lib/rank'

/** 日本全体が収まる初期表示 */
const JAPAN: Region = {
  latitude: 36.5,
  longitude: 138.0,
  latitudeDelta: 14,
  longitudeDelta: 14,
}

/**
 * ドリルダウンの現在位置。
 * 県 → エリア（主要駅・繁華街）の2段。エリアを選ぶと個々の投稿ピンに切り替わる。
 */
type Drill =
  | { level: 'prefecture' }
  | { level: 'area'; prefecture: string }

const LEVEL_LABEL: Record<RegionLevel, string> = {
  prefecture: '都道府県',
  area: 'エリア',
}

/**
 * いま出ているバブルが「どの階層・どのジャンルの集計か」を表す印。
 *
 * 取得は非同期なので、階層やジャンルを変えた直後の一瞬は
 * 前の条件のバブルが画面に残る。その状態でピンチすると、
 * いま出ていないエリアへ降りてしまう（降り先はバブルから選ぶため）。
 *
 * 以前は取得前にバブルを空にして防いでいたが、
 * Marker の子ビューを毎回まとめて外すことになり、
 * 地図が動いている最中だと危ない（index.tsx の取得処理のコメント参照）。
 * 消す代わりに、この印が現在の条件と一致するまで降りないようにする。
 *
 * ★ 印とバブルの中身は、必ず同時に書き換えること（regionsRef）。
 *   別々に持つと「印は新しいのに中身は前の階層のまま」という
 *   一瞬が生まれ、この見張りをすり抜ける。
 */
const regionKeyOf = (d: Drill, genre: string) =>
  `${d.level}:${d.level === 'area' ? d.prefecture : ''}:${genre}`

/**
 * 引いたときに1階層上へ戻すしきい値（latitudeDelta）。
 *
 * これが無いと、階層はパンくずでしか戻せない。地図を引けば上の階層に
 * 戻ると思って操作した人には「押せていた県や区が出てこなくなった」ように見える。
 *
 * ドリル時のカメラは 都道府県→エリア が 0.45、エリア→投稿 が 0.06 なので、
 * その中間に置いて、少し引いたくらいでは戻らないようにしてある。
 */
const BACK_TO_AREAS_DELTA = 0.35   // 投稿ピン表示 → エリア一覧
const BACK_TO_PREFS_DELTA = 3.0    // エリア一覧   → 都道府県一覧

/**
 * 寄ったときに1階層下へ降ろすしきい値（latitudeDelta）。
 *
 * バブルを押さなくても、指で拡大するだけで降りられるようにする。
 * 「地図なんだから寄れば詳しくなる」という当たり前の期待に合わせる。
 *
 * ★ 戻るしきい値より内側に置くこと。
 *   同じ値だと、降りた直後に戻る条件も満たしてしまい、
 *   階層が行ったり来たりする。
 *   戻り: エリア→県 が 3.0、投稿→エリア が 0.35
 *   降り: 県→エリア が 1.2、エリア→投稿 が 0.10
 *
 * ★ 地図の読み込みは増えない。
 *   Google Maps SDK の課金は「地図を読み込んだ回数」で、
 *   拡大・縮小・移動は何回やっても無料。ここでやっているのは
 *   出すピンを差し替えることと、DBの集計を取り直すことだけ。
 */
const INTO_AREAS_DELTA = 1.2    // 都道府県一覧 → エリア一覧
const INTO_POSTS_DELTA = 0.10   // エリア一覧   → 投稿ピン表示

/** 2点間のおおよその距離。どのバブルの上に居るかを決めるためだけに使う */
function roughDistance(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const dLat = a.lat - b.lat
  // 緯度が上がるほど経度1度は短くなる。日本の緯度帯では無視できない
  const dLng = (a.lng - b.lng) * Math.cos((a.lat * Math.PI) / 180)
  return dLat * dLat + dLng * dLng
}

export default function HomeMap() {
  const { colors, isDark } = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const mapRef = useRef<MapView>(null)
  const cloudRef = useRef<CloudTransitionHandle>(null)
  const { permission, locating, locate, lastKnown } = useLocation()

  const [drill, setDrill] = useState<Drill>({ level: 'prefecture' })
  const [regions, setRegions] = useState<RegionCount[]>([])
  const [posts, setPosts] = useState<Post[]>([])
  /** 投稿ピンを表示しているエリア。null なら地域バブル表示中。 */
  const [openArea, setOpenArea] = useState<string | null>(null)
  const [genre, setGenre] = useState<string>('すべて')
  const [loadingRegions, setLoadingRegions] = useState(true)
  const [selectedPost, setSelectedPost] = useState<Post | null>(null)

  /** 自分とフォロー中の人のアイコン。「最後に投稿したお店」の位置に出る */
  const [pins, setPins] = useState<MapPin[]>([])
  const [showPins, setShowPins] = useState(true)

  /**
   * 「誰の地図を出すか」の引き出し。
   *
   * 出す相手は follows.on_map としてDBに持たせてある（移行 0013）。
   * 端末側で絞り込むのではなく、map_pins() が出せる人だけを返す。
   * フォローが増えてもピンが重ならないのと、
   * 無料で出せる人数（運営を除いて2人）を端末の外で守れるのが理由。
   */
  const { user } = useAuth()
  const [drawerOpen, setDrawerOpen] = useState(false)

  /**
   * こちらから動かしたカメラを、ユーザーのズーム操作と取り違えないための猶予。
   * animateToRegion も onRegionChangeComplete を呼ぶため、これが無いと
   * 「階層を降りた直後に、その移動自体が引く操作と判定されて戻る」ことが起きる。
   */
  const suppressUntil = useRef(0)

  /**
   * 地図が動かせる状態になったか。
   *
   * ★ これが要る理由。
   *   iOS の animateToRegion は、地図がまだ組み上がっていないうちに
   *   呼んでも**何も起きずに黙って捨てられる**。エラーも出ない。
   *
   *   起動直後の寄せは、端末が覚えている位置（lastKnown）を使うので
   *   ほぼ即座に返ってくる。つまり地図が組み上がるより先に
   *   animateToRegion を呼んでいて、その1回が丸ごと消えていた。
   *   そのあとの実測（locate）が返れば結果的に寄るが、
   *   屋内などで実測が遅い・失敗すると、日本全体が映ったままになる。
   *   「現在地が読み込めないときがある」の正体はこれ。
   *
   *   準備できるまでは行き先を持っておいて、できた瞬間に動かす。
   */
  const mapReady = useRef(false)
  const pendingCamera = useRef<{ region: Region; ms: number } | null>(null)

  const moveCamera = useCallback((region: Region, ms: number) => {
    suppressUntil.current = Date.now() + ms + 400
    // ★ ネイティブ呼び出しなので囲む。
    //   react-native-maps は新アーキテクチャに非対応で互換層越しに動く。
    //   画面を離れた直後や MapView が作り直された直後に呼ぶと、
    //   ref はあるのに内側が入れ替わっていて投げることがある。
    //   カメラが動かないのは困るが、それでアプリが落ちるのはもっと困る。
    try {
      mapRef.current?.animateToRegion(region, ms)
    } catch (e) {
      console.warn('[home] 地図を動かせませんでした', e)
    }
  }, [])

  const flyTo = useCallback((region: Region, ms = 600) => {
    if (!mapReady.current) {
      // 行き先だけ覚えておく。複数来たら最後のものが正しい
      pendingCamera.current = { region, ms }
      return
    }
    moveCamera(region, ms)
  }, [moveCamera])

  const onMapReady = useCallback(() => {
    mapReady.current = true

    const pending = pendingCamera.current
    pendingCamera.current = null
    if (!pending) return

    // ★ onMapReady の中で即座に動かさないこと。
    //   その時点ではまだ最初の描画が終わっておらず、
    //   iOS では取りこぼすことがある。1フレーム待ってから動かす。
    requestAnimationFrame(() => moveCamera(pending.region, pending.ms))
  }, [moveCamera])

  /**
   * いまのカメラの高さ（latitudeDelta）。
   * 降りる演出で「必ず寄る」ようにするために持っておく。
   * これが無いと、エリアから投稿へ降りるときに一度引いてしまう。
   */
  const cameraDelta = useRef(JAPAN.latitudeDelta)

  /**
   * ピンを押した時刻。地図の onPress を無視するために使う。
   *
   * ★ iOS（Apple地図）では、ピンを押すと Marker の onPress と
   *   MapView の onPress が両方呼ばれる。react-native-maps の
   *   AIRMapManager.handleMapTap は「ピンに当たったか」を見ずに
   *   必ず map.onPress を呼び、さらにピンの選択を通すために
   *   tap.cancelsTouchesInView = NO にしているため。
   *
   *   その結果 setSelectedPost(p) → setSelectedPost(null) が
   *   同じ tick で走り、プレビューが一度も出なかった。
   *
   *   Android は event.action === 'marker-press' で判別できるが、
   *   iOS の onPress には action が入らないので時刻で弾く。
   */
  const markerPressedAt = useRef(0)
  const markMarkerPress = useCallback(() => {
    markerPressedAt.current = Date.now()
  }, [])

  /** 地図の余白を押したときだけプレビューを閉じる */
  const onMapPress = useCallback((e: MapPressEvent) => {
    if (e.nativeEvent?.action === 'marker-press') return   // Android
    if (Date.now() - markerPressedAt.current < 350) return // iOS
    setSelectedPost(null)
  }, [])

  /* ── 起動時に現在地へ寄せる ─────────────────────────
   *
   * 2段構えにしている。実測（locate）は衛星を待つので数秒かかり、
   * そのあいだ日本全体が映っていると「位置がおかしい」と感じる。
   * まず端末が覚えている位置で寄せて、あとから実測で寄せ直す。
   */
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const quick = await lastKnown()
      if (!cancelled && quick) {
        flyTo({ ...quick, latitudeDelta: 0.15, longitudeDelta: 0.15 }, 600)
      }

      const exact = await locate()
      if (!cancelled && exact) {
        flyTo({ ...exact, latitudeDelta: 0.08, longitudeDelta: 0.08 }, 600)
      }
    })()

    return () => { cancelled = true }
  }, [locate, lastKnown, flyTo])

  /* ── 階層に応じた投稿数を取得 ─────────────────────── */
  useEffect(() => {
    let cancelled = false
    const key = regionKeyOf(drill, genre)

    const load = async () => {
      setLoadingRegions(true)

      // ★ ここで setRegions([]) をしないこと。
      //   以前は取得の前に空にしていた。狙いは「前のジャンルのバブルが
      //   残っている状態でピンチして、いま出ていないエリアへ降りる」のを
      //   防ぐことだったが、副作用のほうが重かった。
      //
      //   バブルは Marker の中に自前のビューを置いて描いている。
      //   空にすると、その子ビューが一度に全部アンマウントされる。
      //   react-native-maps は新アーキテクチャ(Fabric)に対応しておらず、
      //   互換層(Legacy Interop)越しに動いているため、
      //   地図が動いている最中に Marker の子を外すのがいちばん危ない
      //   （AIRGoogleMapMarker removeReactSubview で落ちる報告がある）。
      //   地図を動かすたびに階層とジャンルの取得が走るので、
      //   全消し→再生成を一日に何百回も繰り返していた。
      //
      //   降り先の取り違えは、消すのではなく「いまの階層・ジャンルの
      //   結果かどうか」を下の regionsKeyRef で見分けて防ぐ。
      //   こうするとバブルは付け替わるだけで、外れない。

      // 絞り込みは地図の読み込みとは無関係（DBの集計なので課金されない）
      const { data, error } = await supabase.rpc('post_counts_by_region', {
        p_level: drill.level,
        p_prefecture: drill.level === 'area' ? drill.prefecture : null,
        p_genre: genre === 'すべて' ? null : genre,
      })
      if (cancelled) return

      // ★ 中身と印は必ず同時に入れること。
      //   以前は一覧を state から effect 経由で ref に写し、
      //   印だけをここで書いていた。書く時点がずれるので、
      //   取得が終わってから effect が走るまでの一瞬だけ
      //   「印は新しいのに中身は前の階層のまま」になる。
      //   その隙に地図の移動が1回入ると、県の一覧のつもりで
      //   前の階層のエリア名を掴み、drill.prefecture に
      //   「神楽坂」のようなエリア名が入っていた。
      //   パンくずが「全国 › 神楽坂」になり、0地域の行き止まりになる。
      const list = error ? [] : ((data ?? []) as RegionCount[])
      if (error) console.warn('[home] 地域集計に失敗', error.message)

      // 中身が「いまの階層・ジャンルのもの」になった印。
      // これが合うまで、ピンチで降りる判定はしない。
      regionsRef.current = { key, list }
      setRegions(list)
      setLoadingRegions(false)
    }

    load()
    return () => { cancelled = true }
  }, [drill, genre])

  /* ── 自分とフォロー中の人のアイコンを取得 ─────────────
   * 現在地ではなく「最後に投稿したお店」の座標。
   * 常時の位置追跡をしないので、位置情報を保存する必要がない。
   * 画面に戻るたびに取り直す（新しい投稿で位置が動くため）。
   */
  const loadPins = useCallback(async () => {
    const { data, error } = await supabase.rpc('map_pins')
    if (error) {
      console.warn('[home] アイコンの取得に失敗', error.message)
      return
    }
    setPins((data ?? []) as MapPin[])
  }, [])

  useFocusEffect(useCallback(() => { loadPins() }, [loadPins]))

  /* ── エリアを選んだら、その中の投稿を取得 ───────────── */
  const loadPostsForArea = useCallback(
    async (prefecture: string, area: string) => {
      // ★ 先に階層を切り替えること。
      //   openArea を取得のあとに立てていたので、投稿が返ってくるまでの
      //   あいだ地域バブル（数字）が最下層に残り続けていた。
      //   「いちばん下まで降りたのに番号のバブルが出る」の原因はこれ。
      setOpenArea(area)
      setPosts([])

      // ★ posts を直接引かないこと。posts_in_area（移行0019）を通すこと。
      //
      //   以前はここで posts を直接引いていた。フォローの条件が
      //   どこにも無く、公開されている投稿は誰のものでも地図に出ていた。
      //   アイコン（map_pins）は正しく絞っていたので、
      //   「アイコンは出ていない人の投稿だけが出る」状態だった。
      //
      //   絞り込みを端末に書き足すのではなく、DB側の関数に寄せる。
      //   端末で filter すると、アプリを改造されるか anon キーで
      //   PostgREST を直接叩かれた時点で素通りする。
      //   エリアの判定（COALESCE(area, city)）もバブル側と同じ式で
      //   関数の中に入っているので、数の食い違いも起きない。
      const { data, error } = await supabase.rpc('posts_in_area', {
        p_prefecture: prefecture,
        p_area: area,
      })

      if (error) {
        // ★ 先に降ろした階層を戻すこと。
        //   openArea を立てたまま失敗すると、投稿が1件も無い
        //   エリアに取り残され、引かないと出られなくなる。
        console.warn('[home] 投稿取得に失敗', error.message)
        setOpenArea(null)
        return
      }
      setPosts((data ?? []).map(toPost))
    },
    []
  )

  /* ── 地域バブルをタップ → 1階層下る ───────────────────
   * 雲を抜けて降りる演出を挟む。
   * 雲が覆いきった裏でカメラを動かすので、切り替わりが見えず、
   * 地図の再描画の重さもそこで吸収できる。
   */
  const onRegionPress = useCallback(
    (r: RegionCount) => {
      const finalDelta = drill.level === 'prefecture' ? 0.45 : 0.06
      const at = (d: number, ms: number) =>
        flyTo(
          {
            latitude: r.center_lat,
            longitude: r.center_lng,
            latitudeDelta: d,
            longitudeDelta: d,
          },
          ms
        )

      /** 階層を1つ進める。雲で隠れている間に済ませる */
      const advance = () => {
        if (drill.level === 'prefecture') {
          setDrill({ level: 'area', prefecture: r.name })
        } else {
          // 最下層。エリアを選んだので個々の投稿ピンに切り替える
          loadPostsForArea(drill.prefecture, r.name)
        }
      }

      // 移動を3段に分けて「降りていく」ように見せる。
      //
      // 以前は雲が覆いきってから一気に飛ばしていたので、
      // 地面は瞬間移動していて、動いているのは雲だけだった。
      // 近づいた実感が出なかったのはそのため。
      //
      //   1. 雲が覆うより先に寄りはじめる … 動き出しを見せる
      //   2. 覆っている裏で目的地の少し上まで飛ぶ … ここは見えない
      //   3. 雲が晴れながら最後に降りる     … 抜けた先に着地する
      //
      // どの段でも必ず今より寄る。エリアから投稿へ降りるときに
      // 一度引いてしまうと、近づく話の筋が途切れる。
      const approach = Math.max(finalDelta * 1.8, cameraDelta.current * 0.55)
      const overhead = Math.max(finalDelta * 2.2, finalDelta)

      at(approach, COVER_MS)

      cloudRef.current?.fly({
        onCovered: () => {
          at(Math.min(approach, overhead), 1)
          advance()
        },
        // 晴れる時間より少し長くとって、抜けきった後もまだ寄っている
        onClearing: () => at(finalDelta, CLEAR_MS + 140),
        // 演出しない設定のときは、素直に1回で寄せる
        onSkip: () => {
          at(finalDelta, 420)
          advance()
        },
      })
    },
    [drill, loadPostsForArea, flyTo]
  )

  /**
   * 地図を引いたら1階層上へ戻す。
   * パンくずを押さなくても、地図の操作だけで行き来できるようにする。
   */
  const onRegionChangeComplete = useCallback(
    (region: Region) => {
      const d = region.latitudeDelta
      // 高さは常に控える。こちらから動かした分も「いまの高さ」ではある。
      cameraDelta.current = d

      if (Date.now() < suppressUntil.current) return

      if (openArea !== null) {
        if (d > BACK_TO_AREAS_DELTA) {
          setPosts([])
          setOpenArea(null)
          setSelectedPost(null)
        }
        return
      }

      if (drill.level === 'area' && d > BACK_TO_PREFS_DELTA) {
        setDrill({ level: 'prefecture' })
        return
      }

      /* ── 寄ったら降りる ─────────────────────────
       * バブルを押さなくても、指で拡大するだけで階層が進む。
       *
       * どこへ降りるかは「画面の中心にいちばん近いバブル」で決める。
       * 寄っている以上、その1つが画面の主役になっているはず。
       * バブルが1つも無ければ降りない（降りた先が空になる）。
       */
      const { key: regionsKey, list } = regionsRef.current
      if (list.length === 0) return

      // ★ いま出ているバブルが、いまの階層・ジャンルの集計でなければ降りない。
      //   取得は非同期なので、階層やジャンルを変えた直後は
      //   前の条件のバブルがまだ残っている。それを降り先に選ぶと、
      //   いま出ていないエリア（ひどい場合は県名を「エリア」として）
      //   開いてしまい、投稿0件の行き止まりに取り残される。
      if (regionsKey !== regionKeyOf(drill, genre)) return

      const center = { lat: region.latitude, lng: region.longitude }
      let nearest = list[0]
      let best = roughDistance(center, { lat: nearest.center_lat, lng: nearest.center_lng })

      for (const r of list) {
        const dist = roughDistance(center, { lat: r.center_lat, lng: r.center_lng })
        if (dist < best) { best = dist; nearest = r }
      }

      if (drill.level === 'prefecture' && d < INTO_AREAS_DELTA) {
        // ★ 県名でないものを drill.prefecture に入れないこと。
        //   ここに入る値は、そのままパンくずの2つめとして出て、
        //   以後のエリア集計の絞り込み条件にもなる。
        //   エリア名が紛れ込むと「全国 › 神楽坂 / 0地域・計0件」という、
        //   どのバブルも出ない行き止まりができる。
        //   印の突き合わせだけに頼らず、名前そのものも見る。
        if (!PREFECTURE_BY_NAME[nearest.name]) return
        setDrill({ level: 'area', prefecture: nearest.name })
        return
      }

      if (drill.level === 'area' && d < INTO_POSTS_DELTA) {
        loadPostsForArea(drill.prefecture, nearest.name)
      }
    },
    [openArea, drill, genre, loadPostsForArea]
  )

  /* ── パンくずで上の階層へ戻る ───────────────────── */
  const goToPrefectures = useCallback(() => {
    setPosts([])
    setOpenArea(null)
    setSelectedPost(null)
    setDrill({ level: 'prefecture' })
    flyTo(JAPAN, 600)
  }, [flyTo])

  const goToAreas = useCallback(() => {
    setPosts([])
    setOpenArea(null)
    setSelectedPost(null)
  }, [])

  /* ── 現在地に戻る ─────────────────────────────── */
  const recenter = useCallback(async () => {
    /**
     * ★ 実測を待ってからカメラを動かさないこと。
     *
     *   getCurrentPositionAsync(Accuracy.High) は衛星の測位を待つので、
     *   屋外でも数秒、屋内なら打ち切りの10秒までかかる。
     *   以前はそれを待ってから初めて寄せていたので、押しても
     *   数秒のあいだ地図が一切動かず、くるくるが回るだけだった。
     *   「押してから戻るまでが長い」の正体はこれ。
     *
     *   端末が覚えている位置は衛星を待たないので即座に返る。
     *   起動時の寄せと同じ2段構えにして、まずそこへ動かし、
     *   実測が返ったら寄せ直す。指を離した直後に地図が動きはじめ、
     *   正確な位置には数秒後に落ち着く。
     *
     * ★ 精度は下げないこと。
     *   locate() は投稿画面（近くのお店を探す）とも共用していて、
     *   そちらは数百メートルのずれが致命的になる。
     *   ここで直すのは「待たせ方」であって「精度」ではない。
     */
    const quick = await lastKnown()
    if (quick) flyTo({ ...quick, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 400)

    // ★ 前に取った座標を使い回さないこと。
    //   使い回すと、押すたびに「起動したときの場所」へ飛ぶ。
    //   移動したあとに押した人には、ボタンが壊れているようにしか見えない。
    const c = await locate()

    if (!c) {
      // ★ 覚えている位置で既に動かしてあるなら、黙って戻ること。
      //   地図は現在地付近を映しているのに「取れませんでした」と
      //   出すと、正しく動いたのに失敗したように見える。
      //   （lastKnown も許可が要るので、quick があれば許可は下りている）
      if (quick) return

      // 何も起きないと壊れて見える。断られているなら、そう言う。
      //
      // ★ 断られていないのに取れなかった場合も、黙って戻らないこと。
      //   地下や屋内では実測が時間内に返らないことがあり、
      //   そのときここに来る。何も言わないと、押しても押しても
      //   反応しないボタンにしか見えない。
      if (permission === 'denied') {
        Alert.alert(
          '位置情報が使えません',
          '現在地を表示するには、設定で MeshiMap に位置情報の利用を許可してください。',
          [
            { text: '閉じる', style: 'cancel' },
            { text: '設定を開く', onPress: () => Linking.openSettings() },
          ]
        )
      } else {
        Alert.alert(
          '現在地を取れませんでした',
          '地下や建物の中では位置が取れないことがあります。'
            + '\n空の見える場所で、もう一度お試しください。',
          [{ text: '閉じる', style: 'cancel' }]
        )
      }
      return
    }

    // 覚えている位置から寄せ直すぶんには、遠くへ飛ぶわけではないので短く。
    flyTo({ ...c, latitudeDelta: 0.02, longitudeDelta: 0.02 }, quick ? 400 : 600)
  }, [locate, lastKnown, permission, flyTo])

  const visiblePosts = useMemo(
    () => posts.filter((p) => genre === 'すべて' || p.genre === genre),
    [posts, genre]
  )

  /**
   * いま出ているバブルと、それがどの階層・ジャンルの集計か（regionKeyOf）。
   *
   * onRegionChangeComplete から読む。依存配列に regions を入れると、
   * バブルが差し替わるたびに関数が作り直されて MapView に渡る prop が
   * 変わり、地図が余計に描き直される。読むだけなので ref で持つ。
   *
   * ★ 中身と印を別々の入れ物に分けないこと。
   *   分けると、片方だけ新しい一瞬ができる（取得処理のコメント参照）。
   *   取得が終わった時点で、この1つを丸ごと差し替える。
   */
  const regionsRef = useRef<{ key: string; list: RegionCount[] }>({ key: '', list: [] })

  /** 自分以外で地図に出ている人数。ボタンの文言に使う */
  const othersOnMap = useMemo(() => pins.filter((p) => !p.is_me).length, [pins])

  const totalCount = useMemo(
    () => regions.reduce((sum, r) => sum + Number(r.post_count), 0),
    [regions]
  )

  // 投稿ピンを出している間は地域バブルを隠す（画面を1階層だけに保つ）
  const showRegionBubbles = openArea === null

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <MapView
        ref={mapRef}
        provider={MAP_PROVIDER}
        style={StyleSheet.absoluteFill}
        initialRegion={JAPAN}
        showsUserLocation={permission === 'granted'}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
        customMapStyle={isDark ? DARK_MAP_STYLE : LIGHT_MAP_STYLE}
        onPress={onMapPress}
        onMapReady={onMapReady}
        onRegionChangeComplete={onRegionChangeComplete}
      >
        {showRegionBubbles &&
          regions.map((r) => (
            <TrackedMarker
              // ★ key は地域名だけにすること。
              //   階層やジャンルを混ぜると、ジャンルを変えただけで
              //   同じ地域のバブルまで作り直しになる（Marker の子の外し直し）。
              //   数字が変わるだけなら redraw で描き直せば足りる。
              key={r.name}
              redraw={`${r.name}-${r.post_count}`}
              coordinate={{ latitude: r.center_lat, longitude: r.center_lng }}
              onPress={() => { markMarkerPress(); onRegionPress(r) }}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <RegionBubble name={r.name} count={Number(r.post_count)} />
            </TrackedMarker>
          ))}

        {!showRegionBubbles &&
          visiblePosts.map((p) => (
            <TrackedMarker
              // 選択で見た目が変わるので、変わったら絵を取り直させる。
              // ★ ここで key を変えないこと。押した瞬間にそのピンを
              //   作り直すことになり、いちばん落ちやすい操作になる。
              key={p.id}
              redraw={selectedPost?.id === p.id ? 'on' : 'off'}
              coordinate={{ latitude: p.location_lat, longitude: p.location_lng }}
              onPress={() => { markMarkerPress(); setSelectedPost(p) }}
              anchor={{ x: 0.5, y: 1 }}
            >
              <PostPin genre={p.genre} selected={selectedPost?.id === p.id} />
            </TrackedMarker>
          ))}

        {/* 自分とフォロー中の人。地域バブルより手前に出したいので最後に置く */}
        {showPins &&
          pins.map((pin) => (
            <TrackedMarker
              // 写真が入れ替わったら絵を取り直させる（key ではなく redraw で）
              key={`pin-${pin.user_id}`}
              redraw={`${pin.photo_url ?? ''}-${pin.avatar_emoji ?? ''}-${pin.rank}`}
              coordinate={{ latitude: pin.location_lat, longitude: pin.location_lng }}
              onPress={() => {
                markMarkerPress()
                if (pin.is_me) router.push('/(tabs)/profile')
                else router.push(`/user/${pin.username}`)
              }}
              anchor={{ x: 0.5, y: 1 }}
              zIndex={10}
            >
              <FriendPin pin={pin} />
            </TrackedMarker>
          ))}
      </MapView>

      {/* 雲は地図の上・操作UIの下。pointerEvents は none なので操作は妨げない */}
      <CloudTransition ref={cloudRef} />

      {/* ── 上部: パンくず + 階層見出し ───────────────── */}
      <View style={[styles.top, { paddingTop: insets.top + space.sm }]} pointerEvents="box-none">
        <View style={[styles.card, shadow.card, { backgroundColor: colors.surface }]}>
          <View style={styles.breadcrumb}>
            <Crumb
              label="全国"
              active={drill.level === 'prefecture'}
              onPress={goToPrefectures}
            />
            {drill.level === 'area' && (
              <>
                <Ionicons name="chevron-forward" size={14} color={colors.textFaint} />
                <Crumb
                  label={drill.prefecture}
                  active={openArea === null}
                  onPress={goToAreas}
                />
              </>
            )}
            {openArea && (
              <>
                <Ionicons name="chevron-forward" size={14} color={colors.textFaint} />
                <Crumb label={openArea} active onPress={() => {}} />
              </>
            )}
          </View>

          <View style={styles.summary}>
            {loadingRegions && showRegionBubbles ? (
              <ActivityIndicator size="small" color={colors.textFaint} />
            ) : (
              <Txt variant="small" tone="muted">
                {openArea
                  ? `${visiblePosts.length}件の投稿`
                  : `${LEVEL_LABEL[drill.level]}別 · ${regions.length}地域 · 計${totalCount}件`}
              </Txt>
            )}
          </View>
        </View>

        {/* ── ジャンルの絞り込み ─────────────────────
          * どの階層でも出す。以前はいちばん下（投稿ピン）でしか
          * 出していなかったので、「この県のラーメンはどこに多いか」を
          * 見るには、いったんどこかのエリアまで降りるしかなかった。
          * 上の階層ではバブルの数字が、下では出るピンが絞られる。
          *
          * 地図の上に置くチップは onMap を立てて面を不透明にする。
          * 透明のままだと下の地形が透けて文字が読めない。 */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.genreRow}
        >
          <Chip label="すべて" onMap selected={genre === 'すべて'} onPress={() => setGenre('すべて')} />
          {GENRES.map((g) => (
            <Chip
              key={g}
              onMap
              label={`${GENRE_EMOJI[g]} ${g}`}
              selected={genre === g}
              onPress={() => setGenre(g)}
            />
          ))}
        </ScrollView>
      </View>

      {/* ── 右下: アイコンの表示切り替え ─────────────────
        * 人が増えると地域バブルが読めなくなるので、隠せるようにする。
        */}
      {pins.length > 0 && (
        <Pressable
          onPress={() => setShowPins((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={showPins ? 'みんなのアイコンを隠す' : 'みんなのアイコンを表示'}
          style={({ pressed }) => [
            styles.fab,
            shadow.float,
            {
              backgroundColor: showPins ? colors.accent : colors.surface,
              bottom: insets.bottom + space.xl + 56 + space.md,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Ionicons
            name="people"
            size={20}
            color={showPins ? colors.accentText : colors.textMuted}
          />
        </Pressable>
      )}

      {/* ── 右下: 現在地に戻るボタン ───────────────────── */}
      <Pressable
        onPress={recenter}
        accessibilityRole="button"
        accessibilityLabel="現在地に戻る"
        style={({ pressed }) => [
          styles.fab,
          shadow.float,
          {
            backgroundColor: colors.surface,
            bottom: insets.bottom + space.xl,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        {locating ? (
          <ActivityIndicator size="small" color={colors.geo} />
        ) : (
          <Ionicons
            name={permission === 'denied' ? 'locate-outline' : 'locate'}
            size={22}
            color={permission === 'denied' ? colors.textFaint : colors.geo}
          />
        )}
      </Pressable>

      {/* ── 左下: 誰の地図を見るか ───────────────────── */}
      <Pressable
        onPress={() => setDrawerOpen(true)}
        style={({ pressed }) => [
          styles.audienceBtn,
          shadow.float,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            bottom: insets.bottom + space.xl,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
        accessibilityLabel="誰の地図を出すかを選ぶ"
      >
        <Ionicons name="people-outline" size={17} color={colors.text} />
        <Txt variant="smallMed" style={{ letterSpacing: 0.6 }}>
          {othersOnMap > 0 ? `${othersOnMap}人の地図` : '他の人の地図'}
        </Txt>
      </Pressable>

      <MapAudienceDrawer
        visible={drawerOpen}
        myId={user?.id ?? null}
        onClose={() => setDrawerOpen(false)}
        onChanged={loadPins}
      />

      {/* ── 投稿プレビュー ─────────────────────────── */}
      {selectedPost && (
        <PostPreviewSheet
          post={selectedPost}
          onClose={() => setSelectedPost(null)}
          onOpenProfile={(username) => {
            setSelectedPost(null)
            router.push(`/user/${username}`)
          }}
          onOpenPost={(postId) => {
            setSelectedPost(null)
            router.push({ pathname: '/post/[id]', params: { id: postId } })
          }}
        />
      )}
    </View>
  )
}

/* ─────────────────────────  部品  ───────────────────────── */

/**
 * 地図に置く自前のマーカー。
 *
 * ★ tracksViewChanges を最初から false にしないこと。
 *
 *   false は「一度だけ絵を取って、あとは更新しない」という指定で、
 *   ピンが増えたときに地図が固まらないために要る。
 *   ただし絵を取るのは指定した瞬間なので、中身（絵文字や文字）の
 *   描画が間に合っていないと**空白のまま焼き付く**。
 *   「アイコンが出ないことがある」「別のものが出る」の正体はこれ。
 *
 *   最初だけ true にして、中身が描けたころに false へ落とす。
 *   これで正しい絵を取ったうえで、以後の負荷も抑えられる。
 */
/**
 * 中身を自前で描く Marker。
 *
 * tracksViewChanges を出しっぱなしにすると、地図が動くたびに
 * 全ピンの絵を取り直して重くなる。置いた直後だけ true にして止める。
 *
 * ★ 中身が変わったときは redraw を変えること。key ではなく。
 *
 *   以前は key に「選択中かどうか」や写真URLを混ぜていて、
 *   見た目が変わるたびに Marker ごと作り直していた。
 *   これは Marker の子ビューを外して付け直すのと同じで、
 *   react-native-maps がいちばん苦手な操作にあたる。
 *   このライブラリは新アーキテクチャ(Fabric)に対応しておらず、
 *   互換層越しに動いているため、地図が動いている最中に
 *   子ビューを外すと落ちる報告がある
 *   （AIRGoogleMapMarker removeReactSubview）。
 *
 *   redraw を変えるだけなら Marker は外れない。
 *   絵の取り直しは tracksViewChanges を一時的に戻すことで行う。
 */
function TrackedMarker({
  children, redraw, ...markerProps
}: React.ComponentProps<typeof Marker> & { redraw?: string }) {
  const [tracking, setTracking] = useState(true)
  const [seen, setSeen] = useState(redraw)

  // 中身が変わったら、もう一度だけ絵を取り直させる。
  // 効果の中で setState すると余分な描き直しが1回挟まるので、
  // レンダー中に直す（React の "Adjusting state when a prop changes"）。
  if (redraw !== seen) {
    setSeen(redraw)
    setTracking(true)
  }

  useEffect(() => {
    // 1フレームでは間に合わないことがあるので、少し置いてから止める
    const t = setTimeout(() => setTracking(false), 600)
    return () => clearTimeout(t)
  }, [redraw])

  return (
    <Marker {...markerProps} tracksViewChanges={tracking}>
      {children}
    </Marker>
  )
}

function Crumb({
  label, active, onPress,
}: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={active} hitSlop={6}>
      <Txt variant="smallMed" tone={active ? 'default' : 'accent'} numberOfLines={1}>
        {label}
      </Txt>
    </Pressable>
  )
}

/**
 * 自分・フォロー中の人のアイコン。
 *
 * Snap Map と違って現在地ではなく「最後に投稿したお店」に立つ。
 *
 * ★ 名前や店名を並べないこと。
 *   以前はアイコンの横に「アカウント名／◯日前 · 店名」を出していた。
 *   地図の上に人の名前の札が立つと、地図ではなく名簿に見えるうえ、
 *   ピンが2つ3つ近くにあるだけで札同士が重なり、
 *   下の地形も他のピンも読めなくなる。
 *   誰なのかは押せば分かる（プロフィールへ飛ぶ）。
 *
 *   「いつの位置か」の説明は、この札ではなく
 *   プライバシーポリシー（legal/content.ts）と
 *   「誰の地図を出す」の引き出しが受け持つ。
 */
function FriendPin({ pin }: { pin: MapPin }) {
  const { colors } = useTheme()
  const rank = RANKS.find((r) => r.level === pin.rank) ?? RANKS[0]

  return (
    <View style={{ alignItems: 'center' }}>
      <View
        style={[
          styles.friendCard,
          shadow.float,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <RankAvatar
          uri={pin.photo_url}
          emoji={pin.avatar_emoji}
          name={pin.display_name}
          rank={rank}
          size={40}
        />
      </View>
      <View style={[styles.friendTail, { borderTopColor: colors.surface }]} />
    </View>
  )
}

/** 地域ごとの投稿数バブル */
function RegionBubble({ name, count }: { name: string; count: number }) {
  const { colors } = useTheme()

  // 件数が多いほど少しだけ大きくする（対数で頭打ちにする）
  const size = Math.min(72, 44 + Math.log2(count + 1) * 6)

  return (
    <View style={{ alignItems: 'center' }}>
      {/* ベタ塗りの丸をやめ、白地に細い罫線。数字は明朝で置く。
          地図の上で色の面が動くと安っぽく見えるため。 */}
      <View
        style={[
          styles.bubble,
          shadow.card,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.borderStrong,
          },
        ]}
      >
        <Txt variant="title" style={{ fontSize: size * 0.34, lineHeight: size * 0.42 }}>
          {count}
        </Txt>
      </View>
      <View style={[styles.bubbleLabel, { backgroundColor: colors.text }]}>
        <Txt variant="caption" tone="inverse" numberOfLines={1}>{name}</Txt>
      </View>
    </View>
  )
}

/** 個々の投稿のピン */
function PostPin({ genre, selected }: { genre: string; selected: boolean }) {
  const { colors } = useTheme()
  const size = selected ? 48 : 40

  return (
    <View style={{ alignItems: 'center' }}>
      <View
        style={[
          styles.pin,
          shadow.card,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: colors.surface,
            borderColor: selected ? colors.accent : colors.borderStrong,
            borderWidth: selected ? 2 : 1,
          },
        ]}
      >
        <Txt style={{ fontSize: size * 0.45 }}>{GENRE_EMOJI[genre] ?? '🍴'}</Txt>
      </View>
      <View
        style={[
          styles.pinTail,
          { borderTopColor: selected ? colors.accent : colors.pinStroke },
        ]}
      />
    </View>
  )
}

/* ─────────────────────────  ダークマップ  ───────────────────────── */
/** 夜間は地図の彩度を落として、料理写真とピンを前に出す */
/**
 * 地図の配色。
 *
 * 標準の Google 地図は道路が黄色・施設が色付きで、写真と一緒に置くと
 * 画面が散らかる。彩度を落として紙面に近づけ、
 * 主役（写真とピン）が浮くようにする。
 *
 * ★ ただし消しすぎないこと。
 *   以前は poi と transit をまるごと off にしていたが、そうすると
 *   道路と水面しか残らず「高速道路の路線図」のようになる。
 *   地図は「どこか」が分かって初めて地図なので、
 *   場所の手掛かりになるものは残す:
 *
 *     - 駅名   … 日本の街は駅で位置を把握する。線路の線は消して名前だけ残す
 *     - 公園   … 面として残ると街の形が読める
 *     - 市区町村名・町名 … 最後に「どこか」を答えるのはこれ
 *
 *   消すのは、こちらのピンと役目がぶつかるものだけ:
 *
 *     - 店舗（poi.business）… 飲食店が大量に出るとこちらのピンが埋もれる
 *     - 施設のアイコン … 名前は残し、色付きの記号だけ落とす
 */
const LIGHT_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#F5F3EF' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6E6862' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#FAF9F7' }] },

  // 店舗だけ消す。こちらのピンと競合するのはここだけ
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  // 施設は名前を残してアイコンだけ落とす
  { featureType: 'poi', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#E4EADF' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#77856F' }] },

  // 線路の線は消すが、駅名は残す
  { featureType: 'transit.line', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit.station', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#5F7A78' }] },

  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#EFECE6' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#E7E3DB' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#A39C93' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#F0EBE2' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#D7E1E0' }] },

  // 地名。ここが読めないと地図として成立しない
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#DDD8CF' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#4A443E' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: '#6E6862' }] },
]

const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1F1B19' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#A79E97' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#141110' }] },

  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#232A22' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#7C8A76' }] },

  { featureType: 'transit.line', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit.station', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#8AA3A1' }] },

  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2B2523' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#7C736D' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0F1A1A' }] },

  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#D6CEC6' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: '#A79E97' }] },
]

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0, gap: space.sm },
  card: {
    marginHorizontal: space.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.lg,
    gap: space.xs,
  },
  breadcrumb: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  summary: { flexDirection: 'row', alignItems: 'center', minHeight: 18 },
  genreRow: { paddingHorizontal: space.lg, gap: space.sm, paddingVertical: space.xs },
  audienceBtn: {
    position: 'absolute',
    left: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 52,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  fab: {
    position: 'absolute',
    right: space.lg,
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubble: { alignItems: 'center', justifyContent: 'center' },
  bubbleLabel: {
    marginTop: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.sm,
    maxWidth: 104,
  },
  pin: { alignItems: 'center', justifyContent: 'center' },
  pinTail: {
    width: 0,
    height: 0,
    marginTop: -2,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  /** アイコンを白い縁で囲むだけ。文字は入れない（FriendPin のコメント参照） */
  friendCard: {
    padding: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  friendTail: {
    width: 0,
    height: 0,
    marginTop: -1,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
})
