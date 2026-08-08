import { useCallback, useEffect, useState } from 'react'
import { Alert, FlatList, StyleSheet, View } from 'react-native'
import { supabase } from '../../src/lib/supabase'
import { useAuth } from '../../src/hooks/useAuth'
import { useTheme, space } from '../../src/theme'
import { Avatar, Button, EmptyState, Loading, Txt } from '../../src/components/ui'

interface BlockedRow {
  id: string
  username: string
  display_name: string
  photo_url: string | null
}

export default function BlockedAccounts() {
  const { user } = useAuth()
  const { colors } = useTheme()

  const [rows, setRows] = useState<BlockedRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) return

    // profiles の RLS はブロック相手を隠すため、ここは blocks から辿る。
    // blocked_id は自分がブロックした相手なので has_block_with が真になり、
    // 素直に join すると 0 件になってしまう。
    // そのため専用の RPC を使う。
    const { data, error } = await supabase.rpc('my_blocked_accounts')

    if (error) console.warn('[blocked] 取得に失敗', error.message)
    else setRows((data ?? []) as BlockedRow[])
    setLoading(false)
  }, [user])

  useEffect(() => { load() }, [load])

  const unblock = useCallback(async (blockedId: string) => {
    if (!user) return
    setBusyId(blockedId)
    const { error } = await supabase.from('blocks').delete()
      .eq('blocker_id', user.id).eq('blocked_id', blockedId)

    if (error) Alert.alert('解除に失敗しました', error.message)
    else setRows((prev) => prev.filter((r) => r.id !== blockedId))
    setBusyId(null)
  }, [user])

  if (loading) return <Loading />

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.bg }}
      data={rows}
      keyExtractor={(r) => r.id}
      contentContainerStyle={rows.length === 0 ? { flexGrow: 1 } : { paddingVertical: space.sm }}
      ListEmptyComponent={
        <EmptyState
          emoji="🙂"
          title="ブロックしたアカウントはありません"
          body="ブロックすると、お互いの投稿とプロフィールが見えなくなります。"
        />
      }
      renderItem={({ item }) => (
        <View style={[styles.row, { borderBottomColor: colors.border }]}>
          <Avatar uri={item.photo_url} name={item.display_name} size={48} />
          <View style={{ flex: 1 }}>
            <Txt variant="bodyMed" numberOfLines={1}>{item.display_name}</Txt>
            <Txt variant="small" tone="faint" numberOfLines={1}>@{item.username}</Txt>
          </View>
          <Button
            title="解除"
            variant="secondary"
            style={{ height: 38, paddingHorizontal: space.lg }}
            loading={busyId === item.id}
            onPress={() => unblock(item.id)}
          />
        </View>
      )}
    />
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
})
