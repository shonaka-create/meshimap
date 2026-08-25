import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Animated, Easing, Pressable, ScrollView, StyleSheet,
  useWindowDimensions, View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { useTheme, space, radius, shadow } from '../theme'
import { Avatar, Field, Loading, Txt } from './ui'
import { BILLING_READY } from '../lib/billing'
import { FREE_MAP_LIMIT, isMapLimitError, type MapQuota } from '../lib/limits'

export interface AudienceMember {
  id: string
  username: string
  display_name: string
  photo_url: string | null
  posts_count: number
  is_admin: boolean
  /** 地図に出しているか（follows.on_map） */
  on_map: boolean
  /** 自分の行。常に地図に出るので切り替えられない */
  is_me?: boolean
}

/**
 * 「誰の地図を見るか」を選ぶサイドバー。
 *
 * フォローは何人でもできるが、地図に同時に出せる人数には上限がある
 * （無料は運営を除いて2人／移行 0013）。フォローを外さずに
 * 「今は誰の地図を出すか」を入れ替えられるようにするのがこの画面で、
 * 3人目を出そうとしたときにプランの案内が出るのもここ。
 *
 * ★ 切り替えは即座にDBへ書く（set_map_visible）。
 *   下書きにして「適用」を押させると、上限に当たるのが
 *   最後にまとめてになり、どれを外せばいいのか分からなくなる。
 *
 * ★ 上限そのものはDBが持っている。ここの判定は案内を出すためのもので、
 *   すり抜けても set_map_visible が map_limit_reached で弾く。
 *
 * 面の色は地図上のフィルターチップと同じ colors.surface で揃える。
 * 地図の上に半透明の板を重ねると、下の地形と文字が干渉して読みにくくなる。
 */
export function MapAudienceDrawer({
  visible, myId, onClose, onChanged,
}: {
  visible: boolean
  myId: string | null
  onClose: () => void
  /** 地図に出す人が変わった。呼び出し側はピンを取り直す */
  onChanged: () => void
}) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { width } = useWindowDimensions()

  const panelWidth = Math.min(width * 0.86, 380)
  const slide = useRef(new Animated.Value(-panelWidth)).current
  const fade = useRef(new Animated.Value(0)).current

  const [members, setMembers] = useState<AudienceMember[]>([])
  const [quota, setQuota] = useState<MapQuota | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  /** 切り替え中の相手。連打で二重に走らせない */
  const [busyId, setBusyId] = useState<string | null>(null)

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

  /* ── フォロー中（承認済み）＋自分 ───────────────────
   *
   * ★ follows は列を並べずに * で取る。
   *   移行 0013 を流す前のDBには on_map が無く、列名を並べると
   *   「そんな列は無い」で一覧ごと空になる。無ければ
   *   「全員出ている」とみなす（0013 前の実際の挙動と同じ）。
   */
  const load = useCallback(async () => {
    if (!myId) return
    setLoading(true)

    const [me, follows, q] = await Promise.all([
      supabase.from('profiles')
        .select('id, username, display_name, photo_url, posts_count, is_admin')
        .eq('id', myId).single(),
      supabase.from('follows')
        .select('*, profiles!follows_following_id_fkey(id, username, display_name, photo_url, posts_count, is_admin)')
        .eq('follower_id', myId)
        .eq('status', 'accepted')
        .order('created_at', { ascending: true }),
      supabase.rpc('my_map_quota'),
    ])

    if (follows.error) console.warn('[audience] フォロー取得に失敗', follows.error.message)

    // 0013 を流す前は関数が無い。案内の数字は畳んで、切り替えはDBに任せる。
    setQuota(
      q.error ? null : ((Array.isArray(q.data) ? q.data[0] : q.data) as MapQuota | null)
    )

    const list: AudienceMember[] = []
    if (me.data) {
      list.push({ ...(me.data as Omit<AudienceMember, 'on_map'>), on_map: true, is_me: true })
    }
    for (const row of (follows.data ?? []) as any[]) {
      if (!row.profiles) continue
      list.push({ ...(row.profiles as AudienceMember), on_map: row.on_map ?? true })
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

  /** 枠を使っている人数。自分と運営は数えない（DB側の数え方と同じ） */
  const used = useMemo(
    () => members.filter((m) => !m.is_me && !m.is_admin && m.on_map).length,
    [members]
  )
  const limit = quota?.limit_count ?? FREE_MAP_LIMIT
  const unlimited = quota?.subscribed ?? false
  const full = !unlimited && used >= limit

  /* ── 課金の案内 ─────────────────────────────────
   *
   * ★ 決済が繋がるまでは、プランの存在に触れない。
   *   行き先が「準備中」では、上限を外す方法が無いのに
   *   あるかのように見せることになる（billing.ts の BILLING_READY）。
   */
  const offerPremium = useCallback(() => {
    Alert.alert(
      `地図に出せるのは${limit}人までです`,
      (BILLING_READY
        ? `フォローは何人でも増やせますが、同時に地図へ出せるのは無料で${limit}人までです。`
          + '\nプレミアムにすると、フォローしている人を全員そのまま地図に出せます。'
        : `フォローは何人でも増やせますが、同時に地図へ出せるのは${limit}人までです。`
          + '\n出したい人がいるときは、いま出ている人のチェックを外して入れ替えてください。')
        + '\n（運営アカウントはこの人数に含まれません）',
      BILLING_READY
        ? [
            { text: '閉じる', style: 'cancel' },
            {
              text: 'プランを見る',
              onPress: () => { onClose(); router.push('/settings/subscription') },
            },
          ]
        : [{ text: '閉じる', style: 'cancel' }]
    )
  }, [limit, onClose, router])

  /* ── 地図に出す / 出さない ─────────────────────── */
  const toggle = useCallback(async (m: AudienceMember) => {
    if (m.is_me || m.is_admin || busyId) return

    const next = !m.on_map
    // 出す方向のときだけ上限を見る。外すのはいつでも通る。
    if (next && full) {
      offerPremium()
      return
    }

    setBusyId(m.id)
    setMembers((prev) => prev.map((x) => (x.id === m.id ? { ...x, on_map: next } : x)))

    const { error } = await supabase.rpc('set_map_visible', { p_target: m.id, p_on: next })

    if (error) {
      setMembers((prev) => prev.map((x) => (x.id === m.id ? { ...x, on_map: !next } : x)))
      if (isMapLimitError(error)) offerPremium()
      else if (error.message?.includes('Could not find the function')) {
        // 0013 を流す前のDB。ここで無言で戻ると壊れて見える。
        Alert.alert(
          'まだ切り替えられません',
          'アプリの更新に対してデータベース側の準備が終わっていません。しばらくしてからお試しください。'
        )
      } else {
        Alert.alert('切り替えられませんでした', error.message)
      }
      setBusyId(null)
      return
    }

    setBusyId(null)
    onChanged()
  }, [busyId, full, offerPremium, onChanged])

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
            <Txt variant="heading">誰の地図を出す</Txt>
            <Txt variant="small" tone="muted">
              チェックした人のお店が地図に出ます
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

        {/* ── いま何人ぶん出しているか ─────────────────
          * 数字が先に見えていないと、チェックが入らない理由が
          * 「不具合」に見える。上限に達しているならその場で言う。
          */}
        <View style={[styles.quota, { borderColor: colors.border }]}>
          <Ionicons
            name={unlimited ? 'infinite' : full ? 'lock-closed' : 'map-outline'}
            size={17}
            color={full && !unlimited ? colors.accent : colors.textMuted}
          />
          <View style={{ flex: 1 }}>
            <Txt variant="smallMed">
              {unlimited ? `地図に出している ${used}人（上限なし）` : `地図に出している ${used} / ${limit}人`}
            </Txt>
            <Txt variant="caption" tone="faint" numberOfLines={2}>
              {unlimited
                ? '運営アカウントと自分は、この人数に含まれません。'
                : full
                  ? '入れ替えるときは、いま出ている人のチェックを外してください。'
                  : 'フォローは何人でもできます。地図に出す人だけ選んでください。'}
            </Txt>
          </View>
        </View>

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
              // 自分と運営は常に地図に出る。切り替えの対象にしない。
              const fixed = !!m.is_me || m.is_admin
              const on = fixed || m.on_map
              const locked = !fixed && !on && full

              return (
                <Pressable
                  key={m.id}
                  onPress={() => toggle(m)}
                  disabled={fixed || busyId !== null}
                  accessibilityRole={fixed ? undefined : 'checkbox'}
                  accessibilityState={{ checked: on, disabled: fixed }}
                  accessibilityLabel={
                    fixed
                      ? `${m.display_name} は常に地図に出ます`
                      : on
                        ? `${m.display_name} を地図から外す`
                        : `${m.display_name} を地図に出す`
                  }
                  style={({ pressed }) => [
                    styles.row,
                    {
                      borderBottomColor: colors.border,
                      opacity: pressed ? 0.6 : busyId === m.id ? 0.5 : 1,
                    },
                  ]}
                >
                  <Ionicons
                    name={fixed ? 'checkmark-circle' : locked ? 'lock-closed-outline' : on ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={
                      fixed ? colors.textFaint
                        : locked ? colors.accent
                          : on ? colors.accent : colors.textFaint
                    }
                  />
                  <Avatar uri={m.photo_url} name={m.display_name} size={36} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="smallMed" numberOfLines={1}>
                      {m.display_name}
                    </Txt>
                    <Txt variant="small" tone="faint" numberOfLines={1}>
                      @{m.username} · {m.posts_count}件
                      {m.is_me ? ' · 自分' : m.is_admin ? ' · 運営' : ''}
                    </Txt>
                  </View>
                  {fixed && (
                    <Txt variant="caption" tone="faint">常に表示</Txt>
                  )}
                </Pressable>
              )
            })}
          </ScrollView>
        )}

        {/* ── 上限に当たっている人にだけ、外し方と買い方を出す ── */}
        {full && (
          <View style={[styles.foot, { borderTopColor: colors.border }]}>
            <Txt variant="small" tone="muted" style={{ flex: 1 }}>
              {BILLING_READY ? '人数を増やしますか？' : `いまは${limit}人まで出せます`}
            </Txt>
            {BILLING_READY && (
              <Pressable
                onPress={() => { onClose(); router.push('/settings/subscription') }}
                style={({ pressed }) => [
                  styles.apply,
                  { backgroundColor: colors.text, opacity: pressed ? 0.75 : 1 },
                ]}
              >
                <Txt variant="smallMed" style={{ color: colors.bg, letterSpacing: 1.1 }}>
                  プランを見る
                </Txt>
              </Pressable>
            )}
          </View>
        )}
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
  quota: {
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
