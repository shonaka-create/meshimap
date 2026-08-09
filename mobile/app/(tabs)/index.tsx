import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../../src/lib/supabase'
import {
  useTheme, space, radius, shadow, GENRE_EMOJI, GENRES, SITUATIONS, SITUATION_EMOJI,
} from '../../src/theme'
import { Txt, Chip } from '../../src/components/ui'
import { useLocation } from '../../src/hooks/useLocation'
import type { Post, RegionCount, RegionLevel } from '../../src/lib/types'
import { POST_SELECT, toPost } from '../../src/lib/posts'
import { PostPreviewSheet } from '../../src/components/PostPreviewSheet'

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

export default function HomeMap() {
  const { colors, isDark } = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const mapRef = useRef<MapView>(null)
  const { coords, permission, locating, locate } = useLocation()

  const [drill, setDrill] = useState<Drill>({ level: 'prefecture' })
  const [regions, setRegions] = useState<RegionCount[]>([])
  const [posts, setPosts] = useState<Post[]>([])
  /** 投稿ピンを表示しているエリア。null なら地域バブル表示中。 */
  const [openArea, setOpenArea] = useState<string | null>(null)
  const [genre, setGenre] = useState<string>('すべて')
  const [situation, setSituation] = useState<string | null>(null)
  const [loadingRegions, setLoadingRegions] = useState(true)
  const [selectedPost, setSelectedPost] = useState<Post | null>(null)

  /* ── 起動時に一度だけ現在地を取りに行く ─────────────── */
  useEffect(() => {
    locate().then((c) => {
      if (c) {
        mapRef.current?.animateToRegion(
          { ...c, latitudeDelta: 0.15, longitudeDelta: 0.15 },
          800
        )
      }
    })
  }, [locate])

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

  /* ── エリアを選んだら、その中の投稿を取得 ───────────── */
  const loadPostsForArea = useCallback(
    async (prefecture: string, area: string) => {
      // area が NULL の投稿は RPC 側で city を代わりに使っているので、
      // 取得側も同じ条件（area = X または area が空で city = X）で拾う。
      const { data, error } = await supabase
        .from('posts')
        .select(POST_SELECT)
        .eq('prefecture', prefecture)
        .or(`area.eq.${area},and(area.is.null,city.eq.${area})`)
        .order('created_at', { ascending: false })
        .limit(200)

      if (error) {
        console.warn('[home] 投稿取得に失敗', error.message)
        return
      }
      setPosts((data ?? []).map(toPost))
      setOpenArea(area)
    },
    []
  )

  /* ── 地域バブルをタップ → 1階層下る ─────────────────── */
  const onRegionPress = useCallback(
    (r: RegionCount) => {
      // 選択した地域へ寄せる。下るほど拡大率を上げる。
      const delta = drill.level === 'prefecture' ? 0.45 : 0.06
      mapRef.current?.animateToRegion(
        { latitude: r.center_lat, longitude: r.center_lng, latitudeDelta: delta, longitudeDelta: delta },
        600
      )

      if (drill.level === 'prefecture') {
        setDrill({ level: 'area', prefecture: r.name })
      } else {
        // 最下層。エリアを選んだので個々の投稿ピンに切り替える
        loadPostsForArea(drill.prefecture, r.name)
      }
    },
    [drill, loadPostsForArea]
  )

  /* ── パンくずで上の階層へ戻る ───────────────────── */
  const goToPrefectures = useCallback(() => {
    setPosts([])
    setOpenArea(null)
    setSelectedPost(null)
    setDrill({ level: 'prefecture' })
    mapRef.current?.animateToRegion(JAPAN, 600)
  }, [])

  const goToAreas = useCallback(() => {
    setPosts([])
    setOpenArea(null)
    setSelectedPost(null)
  }, [])

  /* ── 現在地に戻る ─────────────────────────────── */
  const recenter = useCallback(async () => {
    const c = coords ?? (await locate())
    if (!c) return
    mapRef.current?.animateToRegion(
      { ...c, latitudeDelta: 0.05, longitudeDelta: 0.05 },
      600
    )
  }, [coords, locate])

  const visiblePosts = useMemo(
    () =>
      posts
        .filter((p) => genre === 'すべて' || p.genre === genre)
        .filter((p) => !situation || (p.situations ?? []).includes(situation)),
    [posts, genre, situation]
  )

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
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={JAPAN}
        showsUserLocation={permission === 'granted'}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
        customMapStyle={isDark ? DARK_MAP_STYLE : undefined}
        onPress={() => setSelectedPost(null)}
      >
        {showRegionBubbles &&
          regions.map((r) => (
            <Marker
              key={`${drill.level}-${r.name}`}
              coordinate={{ latitude: r.center_lat, longitude: r.center_lng }}
              onPress={() => onRegionPress(r)}
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
              onPress={() => setSelectedPost(p)}
              tracksViewChanges={false}
              anchor={{ x: 0.5, y: 1 }}
            >
              <PostPin genre={p.genre} selected={selectedPost?.id === p.id} />
            </Marker>
          ))}
      </MapView>

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

        {/* 投稿ピン表示中のみ絞り込みを出す */}
        {openArea && (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.genreRow}
            >
              <Chip label="すべて" selected={genre === 'すべて'} onPress={() => setGenre('すべて')} />
              {GENRES.map((g) => (
                <Chip
                  key={g}
                  label={`${GENRE_EMOJI[g]} ${g}`}
                  selected={genre === g}
                  onPress={() => setGenre(g)}
                />
              ))}
            </ScrollView>

            {/* シチュエーション: ジャンルでは拾えない「どんな場面で使うか」の軸 */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.genreRow}
            >
              {SITUATIONS.map((s) => (
                <Chip
                  key={s}
                  label={`${SITUATION_EMOJI[s]} ${s}`}
                  selected={situation === s}
                  onPress={() => setSituation(situation === s ? null : s)}
                />
              ))}
            </ScrollView>
          </>
        )}
      </View>

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

      {/* ── 投稿プレビュー ─────────────────────────── */}
      {selectedPost && (
        <PostPreviewSheet
          post={selectedPost}
          onClose={() => setSelectedPost(null)}
          onOpenProfile={(username) => {
            setSelectedPost(null)
            router.push(`/user/${username}`)
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

/** 地域ごとの投稿数バブル */
function RegionBubble({ name, count }: { name: string; count: number }) {
  const { colors } = useTheme()

  // 件数が多いほど少しだけ大きくする（対数で頭打ちにする）
  const size = Math.min(76, 46 + Math.log2(count + 1) * 7)

  return (
    <View style={{ alignItems: 'center' }}>
      <View
        style={[
          styles.bubble,
          shadow.card,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.accent },
        ]}
      >
        <Txt variant="heading" tone="inverse">{count}</Txt>
      </View>
      <View style={[styles.bubbleLabel, { backgroundColor: colors.surface }]}>
        <Txt variant="caption" numberOfLines={1}>{name}</Txt>
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
            borderColor: selected ? colors.accent : colors.pinStroke,
            borderWidth: selected ? 3 : 2,
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
const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1F1B19' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#A79E97' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#141110' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2B2523' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#7C736D' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0F1A1A' }] },
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
    marginTop: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    maxWidth: 96,
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
})
