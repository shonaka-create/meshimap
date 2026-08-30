import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { supabase } from '../src/lib/supabase'
import { useAuth } from '../src/hooks/useAuth'
import { useTheme, space } from '../src/theme'
import { Button, EmptyState, Field, Loading, Txt } from '../src/components/ui'
import { RankAvatar } from '../src/components/RankAvatar'
import { rankOf } from '../src/lib/rank'

/** followers_of / following_of が返す1行（移行 0015） */
interface FollowRow {
  id: string
  username: string
  display_name: string
  photo_url: string | null
  avatar_emoji: string | null
  posts_count: number
  areas_count: number
  is_public: boolean
  is_admin: boolean
  followed_at: string
}

/**
 * フォロー中 / フォロワーの一覧。
 *
 * プロフィールの「フォロワー」「フォロー中」の数字を押すと開く。
 * これまで数字は飾りで、そこから相手へ行く道が無かった。
 *
 * ★ 見てよいかの判断は DB でやる。
 *   非公開アカウントの交友関係は、本人と承認済みフォロワーにしか
 *   見せない。端末側で判定を書いても、anon キーで PostgREST を
 *   直接叩けば素通りするので、止める力にならない。
 *   移行 0015 で follows の閲覧を「自分が関わる行」に絞り、
 *   一覧は followers_of / following_of（定義者権限）だけが返す。
 *   関数が空を返したときが「見せてよい相手ではない」ということ。
 */

type Tab = 'followers' | 'following'

const LABEL: Record<Tab, string> = {
  followers: 'フォロワー',
  following: 'フォロー中',
}

export default function Follows() {
  const params = useLocalSearchParams<{
    userId?: string
    displayName?: string
    tab?: string
  }>()
  const { user } = useAuth()
  const { colors } = useTheme()
  const router = useRouter()

  const targetId = params.userId ?? ''
  const [tab, setTab] = useState<Tab>(params.tab === 'following' ? 'following' : 'followers')

  const [rows, setRows] = useState<FollowRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [denied, setDenied] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [query, setQuery] = useState('')

  /**
   * 取得の世代。
   * タブを切り替えたり引っ張って更新したりすると取得が重なる。
   * 見張りが無いと、先に始めた古い取得が後から新しい結果を上書きする。
   */
  const seq = useRef(0)

  const load = useCallback(async () => {
    if (!targetId) { setDenied(true); setLoading(false); return }

    const mine = ++seq.current
    setLoadError(false)

    // 見てよい相手かどうかは関数の中で判定される（移行 0015）。
    // 見せられない相手には、エラーではなく 0 行が返る。
    const { data, error } = await supabase.rpc(
      tab === 'followers' ? 'followers_of' : 'following_of',
      { p_user: targetId }
    )

    if (mine !== seq.current) return   // 追い越された取得は捨てる

    if (error) {
      console.warn('[follows] 取得に失敗', error.message)
      setLoadError(true)
      setLoading(false)
      return
    }

    const list = (data ?? []) as FollowRow[]

    // 0 行のときだけ、見せられないのか本当に居ないのかを確かめる。
    // 毎回聞くと往復が1つ増えるので、必要になったときだけにする。
    if (list.length === 0) {
      const { data: allowed } = await supabase.rpc('can_view_follows', { p_user: targetId })
      if (mine !== seq.current) return
      setDenied(allowed === false)
    } else {
      setDenied(false)
    }

    setRows(list)
    setLoading(false)
  }, [tab, targetId])

  useEffect(() => { setLoading(true); load() }, [load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  /** 数が増えると探せなくなるので、手元で絞れるようにする */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (p) =>
        p.display_name.toLowerCase().includes(q) ||
        p.username.toLowerCase().includes(q)
    )
  }, [rows, query])

  const open = useCallback((p: FollowRow) => {
    // 自分の行から自分のプロフィールを開くと、同じ画面が積み重なる
    if (p.id === user?.id) router.push('/(tabs)/profile')
    else router.push(`/user/${p.username}`)
  }, [router, user?.id])

  const title = params.displayName
    ? `${params.displayName} の${LABEL[tab]}`
    : LABEL[tab]

  /* ── 上部のタブ。開いたあとに切り替えられるようにする ── */
  const header = (
    <View>
      <View style={[styles.tabs, { borderBottomColor: colors.border }]}>
        {(['followers', 'following'] as Tab[]).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t }}
            style={[
              styles.tab,
              { borderBottomColor: tab === t ? colors.text : 'transparent' },
            ]}
          >
            <Txt variant="smallMed" tone={tab === t ? 'default' : 'faint'}>
              {LABEL[t]}
            </Txt>
          </Pressable>
        ))}
      </View>

      {rows.length > 8 && (
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
          <Field
            value={query}
            onChangeText={setQuery}
            placeholder="名前・ユーザーIDで絞り込む"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      )}
    </View>
  )

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Stack.Screen options={{ title }} />
        <Loading />
      </View>
    )
  }

  if (denied) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Stack.Screen options={{ title: LABEL[tab] }} />
        <EmptyState
          emoji="🔒"
          title="この一覧は見られません"
          body="非公開アカウントのフォロー関係は、承認されたフォロワーだけが見られます。"
        />
      </View>
    )
  }

  if (loadError) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Stack.Screen options={{ title }} />
        <EmptyState
          emoji="📡"
          title="読み込めませんでした"
          body="通信の状態を確かめて、もう一度お試しください。"
          action={
            <Button
              title="もう一度読み込む"
              variant="secondary"
              loading={refreshing}
              onPress={onRefresh}
            />
          }
        />
      </View>
    )
  }

  return (
    <>
      <Stack.Screen options={{ title }} />
      <FlatList
        style={{ flex: 1, backgroundColor: colors.bg }}
        data={visible}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={header}
        contentContainerStyle={visible.length === 0 ? { flexGrow: 1 } : undefined}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
        ListEmptyComponent={
          <EmptyState
            emoji={query ? '🔍' : '🙂'}
            title={
              query
                ? '見つかりませんでした'
                : tab === 'followers'
                  ? 'まだフォロワーがいません'
                  : 'まだ誰もフォローしていません'
            }
            body={query ? '別のキーワードで試してみてください。' : undefined}
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => open(item)}
            style={({ pressed }) => [
              styles.row,
              { borderBottomColor: colors.border, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <RankAvatar
              uri={item.photo_url}
              emoji={item.avatar_emoji}
              name={item.display_name}
              rank={rankOf(item.posts_count, item.areas_count)}
              size={48}
            />
            <View style={{ flex: 1 }}>
              <Txt variant="bodyMed" numberOfLines={1}>{item.display_name}</Txt>
              <Txt variant="small" tone="faint" numberOfLines={1}>@{item.username}</Txt>
            </View>
            <Txt variant="caption" tone="faint">{item.posts_count}投稿</Txt>
          </Pressable>
        )}
      />
    </>
  )
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.md,
    borderBottomWidth: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
})
