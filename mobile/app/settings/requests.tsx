import { useCallback, useEffect, useState } from 'react'
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { supabase } from '../../src/lib/supabase'
import { useAuth } from '../../src/hooks/useAuth'
import { useTheme, space } from '../../src/theme'
import { Avatar, Button, EmptyState, Loading, Txt } from '../../src/components/ui'
import type { Profile } from '../../src/lib/types'

/** 非公開アカウント宛の承認待ちフォロー申請 */
export default function FollowRequests() {
  const { user } = useAuth()
  const { colors } = useTheme()
  const router = useRouter()

  const [rows, setRows] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    const { data, error } = await supabase
      .from('follows')
      .select('follower_id, profiles!follows_follower_id_fkey(*)')
      .eq('following_id', user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (error) console.warn('[requests] 取得に失敗', error.message)
    else setRows((data ?? []).map((r: any) => r.profiles).filter(Boolean) as Profile[])
    setLoading(false)
  }, [user])

  useEffect(() => { load() }, [load])

  const respond = useCallback(async (followerId: string, accept: boolean) => {
    if (!user) return
    setBusyId(followerId)

    const { error } = accept
      ? await supabase.from('follows').update({ status: 'accepted' })
          .eq('follower_id', followerId).eq('following_id', user.id)
      : await supabase.from('follows').delete()
          .eq('follower_id', followerId).eq('following_id', user.id)

    if (error) Alert.alert('操作に失敗しました', error.message)
    else setRows((prev) => prev.filter((p) => p.id !== followerId))

    setBusyId(null)
  }, [user])

  if (loading) return <Loading />

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.bg }}
      data={rows}
      keyExtractor={(p) => p.id}
      contentContainerStyle={rows.length === 0 ? { flexGrow: 1 } : { paddingVertical: space.sm }}
      ListEmptyComponent={
        <EmptyState
          emoji="✅"
          title="承認待ちはありません"
          body="非公開アカウントの場合、フォロー申請がここに届きます。"
        />
      }
      renderItem={({ item }) => (
        <View style={[styles.row, { borderBottomColor: colors.border }]}>
          <Pressable
            onPress={() => router.push(`/user/${item.username}`)}
            style={styles.who}
          >
            <Avatar uri={item.photo_url} name={item.display_name} size={48} />
            <View style={{ flex: 1 }}>
              <Txt variant="bodyMed" numberOfLines={1}>{item.display_name}</Txt>
              <Txt variant="small" tone="faint" numberOfLines={1}>@{item.username}</Txt>
            </View>
          </Pressable>

          <Button
            title="承認"
            style={{ height: 38, paddingHorizontal: space.md }}
            loading={busyId === item.id}
            onPress={() => respond(item.id, true)}
          />
          <Button
            title="削除"
            variant="secondary"
            style={{ height: 38, paddingHorizontal: space.md }}
            onPress={() => respond(item.id, false)}
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
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
})
