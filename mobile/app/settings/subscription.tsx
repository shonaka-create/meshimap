import { useCallback, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Stack, useFocusEffect } from 'expo-router'
import { supabase } from '../../src/lib/supabase'
import { useTheme, space, radius } from '../../src/theme'
import { Button, Loading, Txt } from '../../src/components/ui'
import { FREE_FOLLOW_LIMIT, type FollowQuota } from '../../src/lib/limits'

/**
 * プラン画面。
 *
 * 決済そのものはまだ繋いでいない。
 * iOS アプリ内でアプリの機能を解放する課金は Apple の App内課金が
 * 必要になる可能性が高く、決済方式を決めてから実装する。
 * 契約状態の判定（subscriptions テーブル）は業者に依存しない作りにしてある。
 */
export default function Subscription() {
  const { colors } = useTheme()
  const [quota, setQuota] = useState<FollowQuota | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_follow_quota')
    if (error) {
      console.warn('[subscription] 取得に失敗', error.message)
      return
    }
    // RPC は1行のテーブルを返す
    setQuota((Array.isArray(data) ? data[0] : data) as FollowQuota)
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

  return (
    <>
      <Stack.Screen options={{ title: 'プラン' }} />
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={styles.body}
      >
        {!quota ? (
          <Loading />
        ) : (
          <>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Txt variant="caption" tone="muted">現在のプラン</Txt>
              <Txt variant="title">{quota.subscribed ? 'プレミアム' : '無料'}</Txt>
              <View style={styles.quotaRow}>
                <Ionicons name="people-outline" size={16} color={colors.textMuted} />
                <Txt variant="small" tone="muted">
                  {quota.subscribed
                    ? `フォロー ${quota.used}人（上限なし）`
                    : `フォロー ${quota.used} / ${quota.limit_count}人`}
                </Txt>
              </View>
              {!quota.subscribed && (
                <View style={[styles.track, { backgroundColor: colors.border }]}>
                  <View
                    style={[
                      styles.fill,
                      {
                        width: `${Math.min(quota.used / Math.max(quota.limit_count, 1), 1) * 100}%`,
                        backgroundColor: quota.used >= quota.limit_count ? colors.danger : colors.accent,
                      },
                    ]}
                  />
                </View>
              )}
            </View>

            <View style={styles.section}>
              <Txt variant="heading">プレミアムでできること</Txt>
              <Benefit icon="infinite-outline" text={`${FREE_FOLLOW_LIMIT}人を超えてフォローできる`} />
              <Benefit icon="map-outline" text="フォローした人の地図をすべて見られる" />
              <Benefit icon="notifications-outline" text="新しい掲載店のお知らせを受け取れる" />
            </View>

            <View style={[styles.note, { backgroundColor: colors.surfaceAlt }]}>
              <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
              <Txt variant="small" tone="muted" style={{ flex: 1 }}>
                運営アカウントはフォローの人数に含まれません。おすすめのお店は
                無料のままいつでもご覧いただけます。
              </Txt>
            </View>

            <Button title="準備中です" disabled onPress={() => {}} />
            <Txt variant="caption" tone="faint" style={{ textAlign: 'center' }}>
              お支払い方法は準備中です
            </Txt>
          </>
        )}
      </ScrollView>
    </>
  )
}

function Benefit({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const { colors } = useTheme()
  return (
    <View style={styles.benefit}>
      <Ionicons name={icon} size={18} color={colors.accent} />
      <Txt variant="body" style={{ flex: 1 }}>{text}</Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.xl },
  card: { padding: space.lg, borderRadius: radius.lg, borderWidth: 1, gap: space.xs },
  quotaRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xs },
  track: { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: space.sm },
  fill: { height: '100%', borderRadius: 3 },
  section: { gap: space.md },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  note: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space.sm,
    padding: space.md, borderRadius: radius.md,
  },
})
