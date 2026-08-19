import { useCallback, useState } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { supabase } from '../src/lib/supabase'
import { useAuth } from '../src/hooks/useAuth'
import { useTheme, space, radius } from '../src/theme'
import { EmptyState, Loading, Txt } from '../src/components/ui'
import { RankAvatar } from '../src/components/RankAvatar'
import { formatImpressions, monthlyTierOf } from '../src/lib/impressions'
import { BILLING_READY, FREE_RANKING_ROWS } from '../src/lib/billing'

interface Row {
  user_id: string
  username: string
  display_name: string
  photo_url: string | null
  avatar_emoji: string | null
  impressions: number
  tier: number
  rank_position: number
  total_entrants: number
  is_me: boolean
}

/**
 * 今月のランキング。
 *
 * 無料では上位数人までしか返ってこない（DB側で絞っている）。
 * ただし自分の行は順位に関わらず必ず返る。
 * 自分の位置が見えないまま「続きは有料」と言われても、
 * 何を買うのか分からないまま課金を迫られることになる。
 */
export default function Ranking() {
  const { colors } = useTheme()
  const router = useRouter()
  const { user } = useAuth()

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('monthly_ranking', { p_limit: 100 })
    if (error) {
      console.warn('[ranking] 取得に失敗', error.message)
      setRows([])
    } else {
      setRows((data ?? []) as Row[])
    }
    setLoading(false)
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  const total = rows[0]?.total_entrants ?? 0
  // DBが絞ったかどうかは「返ってきた数 < 全体」で判る。
  // 契約状態を端末側で判定しないのは、そちらが真実ではないため。
  const truncated = total > rows.length

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ title: '今月のランキング' }} />
        <View style={{ flex: 1, backgroundColor: colors.bg }}><Loading /></View>
      </>
    )
  }

  return (
    <>
      <Stack.Screen options={{ title: '今月のランキング' }} />
      <FlatList
        style={{ flex: 1, backgroundColor: colors.bg }}
        data={rows}
        keyExtractor={(r) => r.user_id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
        ListHeaderComponent={
          <View style={styles.head}>
            <Txt variant="caption" tone="faint" style={{ letterSpacing: 2 }}>THIS MONTH</Txt>
            <Txt variant="small" tone="muted">
              公開した投稿が、自分以外に何回開かれたかの順位です。
              同じ人は1日1回まで数えます。毎月1日にゼロへ戻ります。
            </Txt>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            emoji="🏅"
            title="今月はまだ集計がありません"
            body="公開した投稿が誰かに開かれると、ここに並びはじめます。"
          />
        }
        ListFooterComponent={
          !truncated ? null : !BILLING_READY ? (
            /* ★ 決済が繋がるまでは「プレミアムで見られます」と書かない。
                 押した先が「準備中」しか無いので、外す方法があるように
                 見せて空振りさせることになる（Guideline 2.1）。
                 かといって黙って3人で切ると、集計が壊れているように見える。
                 売り込まずに、いま何が出ているかだけを述べる。 */
            <View
              style={[
                styles.lock,
                { borderColor: colors.border, backgroundColor: colors.surfaceAlt },
              ]}
            >
              <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
              <Txt variant="small" tone="muted" style={{ flex: 1 }}>
                いまは上位{FREE_RANKING_ROWS}人と、自分の順位を表示しています。
              </Txt>
            </View>
          ) : (
            <Pressable
              onPress={() => router.push('/settings/subscription')}
              style={({ pressed }) => [
                styles.lock,
                { borderColor: colors.border, backgroundColor: colors.surfaceAlt, opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <Ionicons name="lock-closed" size={18} color={colors.textMuted} />
              <View style={{ flex: 1 }}>
                <Txt variant="smallMed">
                  残り{total - rows.length}人ぶんは、プレミアムで見られます
                </Txt>
                <Txt variant="small" tone="muted">
                  無料で見えるのは上位{FREE_RANKING_ROWS}人と自分の順位です
                </Txt>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
            </Pressable>
          )
        }
        renderItem={({ item }) => {
          const tier = monthlyTierOf(item.impressions)
          const mine = item.is_me || item.user_id === user?.id
          return (
            <Pressable
              onPress={() =>
                mine ? router.push('/(tabs)/profile') : router.push(`/user/${item.username}`)
              }
              style={({ pressed }) => [
                styles.row,
                {
                  borderBottomColor: colors.border,
                  backgroundColor: mine ? colors.surfaceAlt : 'transparent',
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              {/* 順位は明朝で。数字が主役の行なので、本文と同じ字面だと沈む */}
              <Txt variant="title" style={styles.pos}>{item.rank_position}</Txt>

              <RankAvatar
                uri={item.photo_url}
                emoji={item.avatar_emoji}
                name={item.display_name}
                size={44}
                plain
              />

              <View style={{ flex: 1, gap: 1 }}>
                <Txt variant="bodyMed" numberOfLines={1}>
                  {mine ? `${item.display_name}（じぶん）` : item.display_name}
                </Txt>
                <View style={styles.tierRow}>
                  <View style={[styles.dot, { backgroundColor: tier.color }]} />
                  <Txt variant="small" tone="muted">{tier.name}</Txt>
                </View>
              </View>

              <Txt variant="smallMed" tone="muted">
                {formatImpressions(item.impressions)}
              </Txt>
            </Pressable>
          )
        }}
      />
    </>
  )
}

const styles = StyleSheet.create({
  head: { padding: space.lg, gap: space.xs },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.lg, paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pos: { minWidth: 34, textAlign: 'right' },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  dot: { width: 7, height: 7, borderRadius: 4 },
  lock: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    margin: space.lg, padding: space.md,
    borderWidth: 1, borderRadius: radius.md,
  },
})
