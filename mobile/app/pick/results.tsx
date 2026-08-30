import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useTheme, space, radius, GENRE_EMOJI } from '../../src/theme'
import { Button, EmptyState, Loading, Txt } from '../../src/components/ui'
import { DemoNotice } from '../../src/components/DemoNotice'
import { openDirections, openInMaps } from '../../src/lib/maps'
import {
  fetchRecommendations, reasonsOf, formatDistance,
  type RecommendScope, type Spot,
} from '../../src/lib/recommend'

/**
 * 「今日どこ行く？」の結果。
 *
 * 出口は Google マップ。予約も決済も請け負わないので、
 * 「その店に行く」の一歩手前で手を離すのがいちばん短い道になる。
 * 地図は URL を開いているだけで、API の呼び出し料金はかからない（lib/maps.ts）。
 */
export default function PickResults() {
  const { colors } = useTheme()
  const router = useRouter()
  const params = useLocalSearchParams<{
    situations?: string
    prices?: string
    genres?: string
    scope?: string
    radiusKm?: string
    lat?: string
    lng?: string
    excludeVisited?: string
  }>()

  // 条件はルーターのパラメータ（文字列）で来る。
  // 依存配列に生の params を入れると毎描画で作り直されるので、
  // 一度だけ解いて持つ。
  const query = useMemo(() => {
    const arr = (v?: string): string[] => {
      if (!v) return []
      try {
        const parsed = JSON.parse(v)
        return Array.isArray(parsed) ? parsed.map(String) : []
      } catch {
        return []
      }
    }
    const lat = params.lat ? Number(params.lat) : NaN
    const lng = params.lng ? Number(params.lng) : NaN
    return {
      situations: arr(params.situations),
      prices: arr(params.prices),
      genres: arr(params.genres),
      scope: (params.scope === 'following' ? 'following' : 'all') as RecommendScope,
      radiusKm: params.radiusKm ? Number(params.radiusKm) : null,
      coords:
        Number.isFinite(lat) && Number.isFinite(lng)
          ? { latitude: lat, longitude: lng }
          : null,
      excludeVisited: params.excludeVisited === '1',
    }
  }, [
    params.situations, params.prices, params.genres, params.scope,
    params.radiusKm, params.lat, params.lng, params.excludeVisited,
  ])

  const [spots, setSpots] = useState<Spot[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      setSpots(await fetchRecommendations(query))
    } catch {
      setSpots([])
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => { load() }, [load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  /** 押した条件を、結果の上に並べて見せる。何で絞ったか忘れさせない */
  const summary = useMemo(() => {
    const parts = [
      ...query.situations,
      ...query.genres,
      ...query.prices,
      query.radiusKm !== null && query.coords ? `現在地から${query.radiusKm}km` : null,
      query.scope === 'following' ? 'フォロー中だけ' : null,
      query.excludeVisited ? '未訪問だけ' : null,
    ].filter(Boolean) as string[]
    return parts
  }, [query])

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ title: 'おすすめ' }} />
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <Loading label="お店を探しています" />
        </View>
      </>
    )
  }

  return (
    <>
      <Stack.Screen options={{ title: 'おすすめ' }} />
      <FlatList
        style={{ flex: 1, backgroundColor: colors.bg }}
        data={spots}
        keyExtractor={(s) => s.post_id}
        contentContainerStyle={spots.length === 0 ? { flexGrow: 1 } : { paddingBottom: space.xxl }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
        ListHeaderComponent={
          <View style={[styles.head, { borderBottomColor: colors.border }]}>
            <Txt variant="caption" tone="faint" style={{ letterSpacing: 2 }}>
              {spots.length > 0 ? `${spots.length}軒` : ''}
            </Txt>
            {summary.length > 0 ? (
              <Txt variant="small" tone="muted">{summary.join(' · ')}</Txt>
            ) : (
              <Txt variant="small" tone="muted">条件なし（評価と反響の順）</Txt>
            )}
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [styles.edit, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Ionicons name="options-outline" size={15} color={colors.accent} />
              <Txt variant="smallMed" tone="accent">条件を変える</Txt>
            </Pressable>
          </View>
        }
        ListEmptyComponent={
          failed ? (
            <EmptyState
              emoji="⚠️"
              title="うまく取得できませんでした"
              body="通信の状態を確かめて、もう一度お試しください。"
              action={<Button title="もう一度" onPress={load} />}
            />
          ) : (
            // 0件で終わらせない。条件を変えろと言われても、
            // 何に変えればいいのかは分からないので、押せるものを残す。
            <View style={{ flex: 1 }}>
              <EmptyState
                emoji="🍽️"
                title="条件に合う店がまだありません"
                body={
                  query.scope === 'following'
                    ? 'フォロー中の人の投稿だけを見ています。「みんな」に切り替えると広がります。'
                    : '場面や予算をひとつ外すか、範囲を広げると見つかりやすくなります。'
                }
                action={<Button title="条件を変える" onPress={() => router.back()} />}
              />
            </View>
          )
        }
        renderItem={({ item }) => <SpotCard spot={item} />}
      />
    </>
  )
}

function SpotCard({ spot }: { spot: Spot }) {
  const { colors } = useTheme()
  const router = useRouter()
  const reasons = reasonsOf(spot).slice(0, 3)

  return (
    <View style={[styles.card, { borderBottomColor: colors.border }]}>
      <Pressable
        onPress={() => router.push({ pathname: '/post/[id]', params: { id: spot.post_id } })}
        accessibilityRole="button"
        accessibilityLabel={`${spot.location_name} の投稿を開く`}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, flexDirection: 'row', gap: space.md })}
      >
        {spot.image_url ? (
          <Image
            source={{ uri: spot.image_url }}
            style={[styles.thumb, { backgroundColor: colors.surfaceAlt }]}
            contentFit="cover"
            transition={120}
          />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty, { backgroundColor: colors.surfaceAlt }]}>
            <Txt style={{ fontSize: 26 }}>{GENRE_EMOJI[spot.genre] ?? '🍴'}</Txt>
          </View>
        )}

        <View style={{ flex: 1, gap: 3 }}>
          <Txt variant="caption" tone="faint" numberOfLines={1}>
            {[spot.prefecture, spot.area].filter(Boolean).join(' · ')}
          </Txt>
          <Txt variant="bodyMed" numberOfLines={2}>{spot.location_name}</Txt>

          <View style={styles.meta}>
            <Ionicons name="star" size={12} color={colors.star} />
            <Txt variant="small" tone="muted">{Number(spot.avg_rating).toFixed(1)}</Txt>
            <Txt variant="small" tone="faint">·</Txt>
            <Txt variant="small" tone="muted">{spot.genre}</Txt>
            <Txt variant="small" tone="faint">·</Txt>
            <Txt variant="small" tone="muted">{spot.price_range}</Txt>
          </View>

          {/* 「なぜ出たか」。並びの理由を言えないおすすめは広告と区別がつかない */}
          {reasons.length > 0 && (
            <View style={styles.reasons}>
              {reasons.map((r) => (
                <View
                  key={r}
                  style={[styles.reason, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
                >
                  <Txt variant="caption" tone="muted">{r}</Txt>
                </View>
              ))}
            </View>
          )}
        </View>
      </Pressable>

      {/* 出口。ここまで来た人がいちばん押したいのは「で、どこ？」 */}
      <View style={styles.actions}>
        <Pressable
          onPress={() => openInMaps(spot.location_name, spot.area)}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.primary,
            { backgroundColor: colors.text, opacity: pressed ? 0.75 : 1 },
          ]}
        >
          <Ionicons name="location-outline" size={15} color={colors.bg} />
          {/* 面が colors.text なので、字は accentText ではなく地の色。
              accentText は真鍮の上に置く字のための色で、墨の上では合わない */}
          <Txt variant="smallMed" style={{ letterSpacing: 0.8, color: colors.bg }}>
            Google マップで見る
          </Txt>
        </Pressable>

        <Pressable
          onPress={() => openDirections(spot.location_lat, spot.location_lng, spot.location_name)}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.secondary,
            { borderColor: colors.borderStrong, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Ionicons name="navigate-outline" size={15} color={colors.text} />
          <Txt variant="smallMed">
            {spot.distance_km !== null ? formatDistance(spot.distance_km) : '行き方'}
          </Txt>
        </Pressable>
      </View>

      {spot.has_demo && <DemoNotice compact />}
    </View>
  )
}

const styles = StyleSheet.create({
  head: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.md,
    gap: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  edit: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xs },
  card: {
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    gap: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  thumb: { width: 88, height: 88, borderRadius: radius.sm },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexWrap: 'wrap' },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: 2 },
  reason: {
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actions: { flexDirection: 'row', gap: space.sm },
  primary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 44,
    borderRadius: radius.sm,
  },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    height: 44,
    paddingHorizontal: space.lg,
    borderWidth: 1,
    borderRadius: radius.sm,
  },
})
