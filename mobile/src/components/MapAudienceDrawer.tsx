import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated, Easing, Pressable, ScrollView, StyleSheet,
  useWindowDimensions, View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { useTheme, space, radius, shadow } from '../theme'
import { Avatar, Field, Loading, Txt } from './ui'

export interface AudienceMember {
  id: string
  username: string
  display_name: string
  photo_url: string | null
  posts_count: number
}

/**
 * 「誰の地図を見るか」を選ぶサイドバー。
 *
 * フォローが増えると、全員分のピンが同時に出て地図が読めなくなる。
 * かといってフォローを外すのは関係を切ることになるので、
 * 「見る相手」と「フォロー」を分けて、ここで一時的に絞れるようにする。
 *
 * 面の色は地図上のフィルターチップと同じ colors.surface で揃える。
 * 地図の上に半透明の板を重ねると、下の地形と文字が干渉して読みにくくなる。
 */
export function MapAudienceDrawer({
  visible, myId, selectedIds, onClose, onApply,
}: {
  visible: boolean
  myId: string | null
  /** null = 全員表示。配列 = その user_id だけ表示 */
  selectedIds: string[] | null
  onClose: () => void
  onApply: (ids: string[] | null) => void
}) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()

  const panelWidth = Math.min(width * 0.86, 380)
  const slide = useRef(new Animated.Value(-panelWidth)).current
  const fade = useRef(new Animated.Value(0)).current

  const [members, setMembers] = useState<AudienceMember[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<Set<string>>(new Set())

  /* ── 開閉のアニメーション ───────────────────────── */
  useEffect(() => {
    Animated.parallel([
      Animated.timing(slide, {
        toValue: visible ? 0 : -panelWidth,
        duration: visible ? 260 : 200,
        easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(fade, {
        toValue: visible ? 1 : 0,
        duration: visible ? 220 : 180,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ]).start()
  }, [visible, panelWidth, slide, fade])

  /* ── 開いたときに、いまの選択状態を下書きへ写す ───────── */
  useEffect(() => {
    if (!visible) return
    setDraft(new Set(selectedIds ?? []))
  }, [visible, selectedIds])

  /* ── フォロー中（承認済み）＋自分 ─────────────────── */
  const load = useCallback(async () => {
    if (!myId) return
    setLoading(true)

    const [me, follows] = await Promise.all([
      supabase.from('profiles')
        .select('id, username, display_name, photo_url, posts_count')
        .eq('id', myId).single(),
      supabase.from('follows')
        .select('profiles!follows_following_id_fkey(id, username, display_name, photo_url, posts_count)')
        .eq('follower_id', myId)
        .eq('status', 'accepted')
        .order('created_at', { ascending: false }),
    ])

    if (follows.error) console.warn('[audience] フォロー取得に失敗', follows.error.message)

    const list: AudienceMember[] = []
    if (me.data) list.push(me.data as AudienceMember)
    for (const row of (follows.data ?? []) as any[]) {
      if (row.profiles) list.push(row.profiles as AudienceMember)
    }
    setMembers(list)
    setLoading(false)
  }, [myId])

  useEffect(() => { if (visible) load() }, [visible, load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return members
    return members.filter(
      (m) =>
        m.display_name.toLowerCase().includes(q) ||
        m.username.toLowerCase().includes(q)
    )
  }, [members, query])

  const allSelected = draft.size === members.length && members.length > 0

  const toggle = (id: string) =>
    setDraft((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const apply = () => {
    // 全員選択 = 絞り込みなし。ピンを1件も選んでいない場合も全員に戻す。
    if (draft.size === 0 || draft.size === members.length) onApply(null)
    else onApply([...draft])
    onClose()
  }

  if (!visible) return null

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* 幕。ここを押しても閉じる */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
          onPress={onClose}
          accessibilityLabel="閉じる"
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.panel,
          shadow.float,
          {
            width: panelWidth,
            paddingTop: insets.top + space.md,
            paddingBottom: insets.bottom + space.md,
            backgroundColor: colors.surface,
            borderRightColor: colors.border,
            transform: [{ translateX: slide }],
          },
        ]}
      >
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Txt variant="heading">誰の地図を見る</Txt>
            <Txt variant="small" tone="muted">
              選んだ人のお店だけが地図に出ます
            </Txt>
          </View>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="閉じる">
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: space.lg }}>
          <Field
            value={query}
            onChangeText={setQuery}
            placeholder="名前 · ユーザーID"
            autoCapitalize="none"
            autoCorrect={false}
            prefix="🔍"
          />
        </View>

        <Pressable
          onPress={() =>
            setDraft(allSelected ? new Set() : new Set(members.map((m) => m.id)))
          }
          style={({ pressed }) => [
            styles.selectAll,
            { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Ionicons
            name={allSelected ? 'checkbox' : 'square-outline'}
            size={20}
            color={allSelected ? colors.accent : colors.textFaint}
          />
          <Txt variant="smallMed" style={{ flex: 1 }}>すべて選択</Txt>
          <Txt variant="small" tone="faint">{draft.size} / {members.length}</Txt>
        </Pressable>

        {loading ? (
          <Loading />
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: space.lg }}>
            {filtered.length === 0 && (
              <Txt variant="small" tone="muted" style={styles.empty}>
                {query ? '見つかりませんでした' : 'まだ誰もフォローしていません'}
              </Txt>
            )}

            {filtered.map((m) => {
              const on = draft.has(m.id)
              return (
                <Pressable
                  key={m.id}
                  onPress={() => toggle(m.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={({ pressed }) => [
                    styles.row,
                    { borderBottomColor: colors.border, opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Ionicons
                    name={on ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={on ? colors.accent : colors.textFaint}
                  />
                  <Avatar uri={m.photo_url} name={m.display_name} size={36} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="smallMed" numberOfLines={1}>
                      {m.id === myId ? `${m.display_name}（じぶん）` : m.display_name}
                    </Txt>
                    <Txt variant="small" tone="faint" numberOfLines={1}>
                      @{m.username} · {m.posts_count}件
                    </Txt>
                  </View>
                </Pressable>
              )
            })}
          </ScrollView>
        )}

        <View style={[styles.foot, { borderTopColor: colors.border }]}>
          <Pressable
            onPress={() => { onApply(null); onClose() }}
            hitSlop={8}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Txt variant="smallMed" tone="muted">絞り込みを解除</Txt>
          </Pressable>
          <Pressable
            onPress={apply}
            style={({ pressed }) => [
              styles.apply,
              { backgroundColor: colors.text, opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <Txt variant="smallMed" style={{ color: colors.bg, letterSpacing: 1.1 }}>
              この人たちで見る
            </Txt>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    borderRightWidth: 1,
  },
  head: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space.md,
    paddingHorizontal: space.lg, paddingBottom: space.md,
  },
  selectAll: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.lg, paddingVertical: space.md,
    borderTopWidth: 1, borderBottomWidth: 1, marginTop: space.md,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.lg, paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  empty: { textAlign: 'center', paddingVertical: space.xxl },
  foot: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: space.md, paddingHorizontal: space.lg, paddingTop: space.md,
    borderTopWidth: 1,
  },
  apply: {
    paddingHorizontal: space.lg, paddingVertical: space.md,
    borderRadius: radius.sm,
  },
})
