import { useCallback, useEffect, useRef, useState } from 'react'
import { Animated, Easing, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useAuth } from '../../src/hooks/useAuth'
import { useTheme, space, radius } from '../../src/theme'
import { Button, Loading, Txt } from '../../src/components/ui'
import { RankBadge } from '../../src/components/RankAvatar'
import {
  nextRank, progressToNext, rankOf, remainingToNext, type Rank,
} from '../../src/lib/rank'

/**
 * 投稿完了画面。
 *
 * 「投稿しました」だけで閉じると、続けて投稿する理由が何も残らない。
 * ここで見せるのは3つ:
 *   1. 今回何が積み上がったか（通算・新しい街）
 *   2. 次のランクまであとどれくらいか
 *   3. 次に何をすればいいか
 *
 * 数字は投稿前の値を params で受け取り、最新のプロフィールと突き合わせて
 * 差分を出す。カウンタはDBのトリガーが更新するので、
 * こちら側で足し算しない（ズレると信用を失う）。
 */
export default function PostDone() {
  const { colors } = useTheme()
  const router = useRouter()
  const { profile, refreshProfile } = useAuth()
  const params = useLocalSearchParams<{
    postsBefore?: string
    areasBefore?: string
    area?: string
    prefecture?: string
    locationName?: string
    isPublic?: string
  }>()

  const [ready, setReady] = useState(false)
  /**
   * 最新のプロフィールを取れなかった。
   *
   * ★ 取れなかったことを黙って隠さない。
   *   この画面の中身は「今回いくつ積み上がったか」なので、
   *   投稿前の古い値で描くと、増分 0・ランクアップ無しという
   *   嘘の結果になる。投稿自体は成功しているので、
   *   失敗したのは取得だけだと伝えて、やり直せるようにする。
   */
  const [loadFailed, setLoadFailed] = useState(false)
  const before = {
    posts: Number(params.postsBefore ?? 0),
    areas: Number(params.areasBefore ?? 0),
  }

  const reload = useCallback(async () => {
    setReady(false)
    setLoadFailed(false)
    // トリガーが走ったあとの値が要るので、必ず取り直す
    const ok = await refreshProfile()
    setLoadFailed(!ok)
    setReady(true)
  }, [refreshProfile])

  useEffect(() => { reload() }, [reload])

  const fade = useRef(new Animated.Value(0)).current
  const rise = useRef(new Animated.Value(16)).current
  useEffect(() => {
    if (!ready) return
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.timing(rise, {
        toValue: 0, duration: 480, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
    ]).start()
  }, [ready, fade, rise])

  const close = useCallback(() => router.replace('/(tabs)'), [router])

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Stack.Screen options={{ headerShown: false }} />
        <Loading label="記録しています…" />
      </View>
    )
  }

  /**
   * 数字を出せない状態。
   *
   * ★ 投稿は成功している。ここで失敗したのは集計の取得だけ。
   *   それを言わずにローディングのまま止めると、
   *   投稿そのものが失敗したように見えてもう一度投稿されてしまう。
   */
  if (loadFailed || !profile) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.retry}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.textFaint} />
          <Txt variant="title" style={{ textAlign: 'center' }}>投稿は保存できました</Txt>
          <Txt variant="body" tone="muted" style={{ textAlign: 'center' }}>
            集計の読み込みだけができませんでした。
            もう一度投稿する必要はありません。
          </Txt>
          <View style={{ alignSelf: 'stretch', gap: space.md, marginTop: space.lg }}>
            <Button title="もう一度読み込む" onPress={reload} />
            <Button title="地図を見る" variant="secondary" onPress={close} />
          </View>
        </View>
      </View>
    )
  }

  const rank = rankOf(profile.posts_count, profile.areas_count)
  const rankBefore = rankOf(before.posts, before.areas)
  const rankedUp = rank.level > rankBefore.level
  const newArea = profile.areas_count > before.areas
  const next = nextRank(rank)
  const progress = progressToNext(profile.posts_count, profile.areas_count, rank, next)
  const remaining = remainingToNext(profile.posts_count, profile.areas_count, next)
  const isPublic = params.isPublic === '1'

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView contentContainerStyle={styles.body}>
        <Animated.View style={{ opacity: fade, transform: [{ translateY: rise }], gap: space.xl }}>
          {/* ── 見出し ─────────────────────────────── */}
          <View style={{ gap: space.sm }}>
            <Txt variant="caption" tone="faint">
              {params.prefecture} {params.area ? `· ${params.area}` : ''}
            </Txt>
            <Txt variant="display">
              {rankedUp ? `${rank.name}になりました` : '地図に刻みました'}
            </Txt>
            <Txt variant="small" tone="muted">
              {params.locationName}
            </Txt>
          </View>

          <View style={[styles.rule, { backgroundColor: colors.border }]} />

          {/* ── 今回積み上がったもの ─────────────────── */}
          <View style={styles.figures}>
            <Figure value={profile.posts_count} label="通算の記録" delta={profile.posts_count - before.posts} />
            <View style={[styles.vRule, { backgroundColor: colors.border }]} />
            <Figure value={profile.areas_count} label="制覇したエリア" delta={profile.areas_count - before.areas} />
          </View>

          {newArea && params.area ? (
            <View style={[styles.badgeRow, { borderColor: colors.accent }]}>
              <Ionicons name="flag-outline" size={16} color={colors.accent} />
              <Txt variant="smallMed" tone="accent">
                「{params.area}」は初めての街です
              </Txt>
            </View>
          ) : null}

          {/* ── ランク ─────────────────────────────── */}
          <View style={{ gap: space.md }}>
            <View style={styles.rankRow}>
              <RankBadge rank={rank} />
              {rankedUp && (
                <Txt variant="caption" tone="accent">
                  {rankBefore.name} から昇格
                </Txt>
              )}
            </View>

            {rankedUp && <UnlockNote rank={rank} />}

            {next && (
              <>
                <View style={[styles.track, { backgroundColor: colors.border }]}>
                  <View
                    style={[
                      styles.fill,
                      { width: `${Math.max(progress * 100, 2)}%`, backgroundColor: next.frame },
                    ]}
                  />
                </View>
                <Txt variant="small" tone="muted">{remaining}</Txt>
              </>
            )}
          </View>

          <View style={[styles.rule, { backgroundColor: colors.border }]} />

          {/* ── 次の一手 ───────────────────────────── */}
          {!isPublic && (
            <View style={[styles.note, { backgroundColor: colors.surfaceAlt }]}>
              <Ionicons name="lock-closed-outline" size={16} color={colors.textMuted} />
              <Txt variant="small" tone="muted" style={{ flex: 1 }}>
                この記録は非公開です。プロフィールの写真にある鍵を押すと公開でき、
                地図であなたのアイコンが立つ場所になります。
              </Txt>
            </View>
          )}

          <View style={{ gap: space.md }}>
            <Button title="続けて記録する" onPress={() => router.replace('/post/new')} />
            <Button title="地図を見る" variant="secondary" onPress={close} />
          </View>
        </Animated.View>
      </ScrollView>

      <Pressable onPress={close} hitSlop={12} style={styles.close} accessibilityLabel="閉じる">
        <Ionicons name="close" size={24} color={colors.textMuted} />
      </Pressable>
    </View>
  )
}

/** 大きな数字と、今回の増分 */
function Figure({ value, label, delta }: { value: number; label: string; delta: number }) {
  const { colors } = useTheme()
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.xs }}>
        <Txt variant="display">{value.toLocaleString('ja-JP')}</Txt>
        {delta > 0 && (
          <Txt variant="smallMed" tone="accent">+{delta}</Txt>
        )}
      </View>
      <Txt variant="caption" tone="faint">{label}</Txt>
      <View style={[styles.figRule, { backgroundColor: colors.borderStrong }]} />
    </View>
  )
}

/** 昇格したときに「何が増えたか」を具体的に示す */
function UnlockNote({ rank }: { rank: Rank }) {
  const { colors } = useTheme()
  return (
    <View style={[styles.note, { backgroundColor: colors.accentSoft }]}>
      <Ionicons name="sparkles-outline" size={16} color={colors.accent} />
      <Txt variant="small" style={{ flex: 1 }}>
        アイコンの枠が{rank.note}に変わり、選べる絵柄が増えました。
        プロフィールのアイコンから変更できます。
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  body: { padding: space.xl, paddingTop: space.xxxl, paddingBottom: space.xxl },
  rule: { height: 1 },
  vRule: { width: 1, alignSelf: 'stretch', marginHorizontal: space.lg },
  figures: { flexDirection: 'row', alignItems: 'flex-start' },
  figRule: { height: 1, marginTop: space.sm, width: 28 },
  badgeRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    borderWidth: 1, borderRadius: radius.sm,
    paddingVertical: space.sm, paddingHorizontal: space.md,
    alignSelf: 'flex-start',
  },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  track: { height: 4, overflow: 'hidden' },
  fill: { height: '100%' },
  note: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space.sm,
    padding: space.md, borderRadius: radius.sm,
  },
  close: { position: 'absolute', top: 56, right: space.lg },
  retry: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: space.xl, gap: space.sm,
  },
})
