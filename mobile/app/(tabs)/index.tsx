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
import { POST_SELECT, toPost } from '../../src/lib/posts'
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
   * 地図に出す相手の絞り込み。
   * null なら絞り込みなし（自分＋フォロー中の全員）。
   * フォローが増えるほどピンが重なって読めなくなるので、
   * フォローを外さずに「今は誰の地図を見るか」だけ切り替えられるようにする。
   */
  const { user } = useAuth()
  const [audience, setAudience] = useState<string[] | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  /**
   * こちらから動かしたカメラを、ユーザーのズーム操作と取り違えないための猶予。
   * animateToRegion も onRegionChangeComplete を呼ぶため、これが無いと
   * 「階層を降りた直後に、その移動自体が引く操作と判定されて戻る」ことが起きる。
   */
  const suppressUntil = useRef(0)
  const flyTo = useCallback((region: Region, ms = 600) => {
    suppressUntil.current = Date.now() + ms + 400
    mapRef.current?.animateToRegion(region, ms)
  }, [])

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

    const load = async () => {
      setLoadingRegions(true)
      const { data, error } = await supabase.rpc('post_counts_by_region', {
        p_level: drill.level,
        p_prefecture: drill.level === 'area' ? drill.prefecture : null,
      })
      if (cancelled) return

      if (error) {
        console.warn('[home] 地域集計に失敗', error.message)
        setRegions([])
      } else {
        setRegions((data ?? []) as RegionCount[])
      }
      setLoadingRegions(false)
    }

    load()
    return () => { cancelled = true }
  }, [drill])

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
      // area が NULL の投稿は RPC 側で city を代わりに使っているので、
      // 取得側も同じ条件（area = X または area が空で city = X）で拾う。
      let q = supabase
        .from('posts')
        .select(POST_SELECT)
        .eq('prefecture', prefecture)
        .or(`area.eq.${area},and(area.is.null,city.eq.${area})`)

      // 絞り込みは取得段階で効かせる。取ってから捨てると通信が無駄になる。
      if (audience) q = q.in('user_id', audience)

      const { data, error } = await q
        .order('created_at', { ascending: false })
        .limit(200)

      if (error) {
        console.warn('[home] 投稿取得に失敗', error.message)
        return
      }
      setPosts((data ?? []).map(toPost))
      setOpenArea(area)
    },
    [audience]
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
      }
    },
    [openArea, drill]
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
    // ★ 前に取った座標を使い回さないこと。
    //   使い回すと、押すたびに「起動したときの場所」へ飛ぶ。
    //   移動したあとに押した人には、ボタンが壊れているようにしか見えない。
    const c = await locate()

    if (!c) {
      // 何も起きないと壊れて見える。断られているなら、そう言う。
      if (permission === 'denied') {
        Alert.alert(
          '位置情報が使えません',
          '現在地を表示するには、設定で MeshiMap に位置情報の利用を許可してください。',
          [
            { text: '閉じる', style: 'cancel' },
            { text: '設定を開く', onPress: () => Linking.openSettings() },
          ]
        )
      }
      return
    }

    flyTo({ ...c, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 600)
  }, [locate, permission, flyTo])

  const visiblePosts = useMemo(
    () => posts.filter((p) => genre === 'すべて' || p.genre === genre),
    [posts, genre]
  )

  /** 絞り込み中は、選ばれた人のアイコンだけ残す */
  const visiblePins = useMemo(
    () => (audience ? pins.filter((p) => audience.includes(p.user_id)) : pins),
    [pins, audience]
  )

  /** 絞り込みを変えたら、開いているエリアの投稿を取り直す */
  useEffect(() => {
    if (openArea && drill.level === 'area') {
      loadPostsForArea(drill.prefecture, openArea)
    }
    // openArea を依存に入れると読み込みのたびに再実行されるので入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience])

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
        onRegionChangeComplete={onRegionChangeComplete}
      >
        {showRegionBubbles &&
          regions.map((r) => (
            <Marker
              key={`${drill.level}-${r.name}`}
              coordinate={{ latitude: r.center_lat, longitude: r.center_lng }}
              onPress={() => { markMarkerPress(); onRegionPress(r) }}
              tracksViewChanges={false}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <RegionBubble name={r.name} count={Number(r.post_count)} />
            </Marker>
          ))}

        {!showRegionBubbles &&
          visiblePosts.map((p) => (
            <Marker
              key={p.id}
              coordinate={{ latitude: p.location_lat, longitude: p.location_lng }}
              onPress={() => { markMarkerPress(); setSelectedPost(p) }}
              tracksViewChanges={false}
              anchor={{ x: 0.5, y: 1 }}
            >
              <PostPin genre={p.genre} selected={selectedPost?.id === p.id} />
            </Marker>
          ))}

        {/* 自分とフォロー中の人。地域バブルより手前に出したいので最後に置く */}
        {showPins &&
          visiblePins.map((pin) => (
            <Marker
              key={`pin-${pin.user_id}`}
              coordinate={{ latitude: pin.location_lat, longitude: pin.location_lng }}
              onPress={() => {
                markMarkerPress()
                if (pin.is_me) router.push('/(tabs)/profile')
                else router.push(`/user/${pin.username}`)
              }}
              tracksViewChanges={false}
              anchor={{ x: 0.5, y: 1 }}
              zIndex={10}
            >
              <FriendPin pin={pin} />
            </Marker>
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

        {/* 投稿ピン表示中のみ絞り込みを出す。
            地図の上に置くチップは onMap を立てて面を不透明にする。
            透明のままだと下の地形が透けて文字が読めない。 */}
        {openArea && (
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
        )}
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
            backgroundColor: audience ? colors.text : colors.surface,
            borderColor: audience ? colors.text : colors.border,
            bottom: insets.bottom + space.xl,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
        accessibilityLabel="誰の地図を見るかを選ぶ"
      >
        <Ionicons
          name="people-outline"
          size={17}
          color={audience ? colors.bg : colors.text}
        />
        <Txt
          variant="smallMed"
          style={{ color: audience ? colors.bg : colors.text, letterSpacing: 0.6 }}
        >
          {audience ? `${audience.length}人の地図` : '他の人の地図'}
        </Txt>
      </Pressable>

      <MapAudienceDrawer
        visible={drawerOpen}
        myId={user?.id ?? null}
        selectedIds={audience}
        onClose={() => setDrawerOpen(false)}
        onApply={setAudience}
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
 * 位置を追跡しないぶん、いつの情報なのかが分かりにくいので、
 * 経過時間を添えて誤解を防ぐ。
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
          size={44}
        />
        <View style={{ maxWidth: 108 }}>
          <Txt variant="smallMed" numberOfLines={1}>
            {pin.is_me ? 'じぶん' : pin.display_name}
          </Txt>
          <Txt variant="caption" tone="muted" numberOfLines={1}>
            {timeAgo(pin.posted_at)} · {pin.location_name}
          </Txt>
        </View>
      </View>
      <View style={[styles.friendTail, { borderTopColor: colors.surface }]} />
    </View>
  )
}

/** 「3時間前」程度のざっくり表示。分単位まで出すと位置追跡だと誤解されるので出さない。 */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 1) return 'さっき'
  if (hours < 24) return `${hours}時間前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}日前`
  const months = Math.floor(days / 30)
  return months < 12 ? `${months}か月前` : `${Math.floor(months / 12)}年前`
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
  friendCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: 6,
    paddingHorizontal: 6,
    paddingRight: space.md,
    borderRadius: radius.sm,
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
