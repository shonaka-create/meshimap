import { useCallback, useState } from 'react'
import {
  Alert, FlatList, Pressable, RefreshControl, StyleSheet, View, useWindowDimensions,
} from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useTheme, space, radius, GENRE_EMOJI } from '../theme'
import { Button, EmptyState, Loading, Stat, Txt } from './ui'
import { ReportDialog } from './ReportDialog'
import { RankAvatar, RankBadge } from './RankAvatar'
import { AvatarEmojiPicker } from './AvatarEmojiPicker'
import { nextRank, progressToNext, rankOf, remainingToNext } from '../lib/rank'
import { FREE_FOLLOW_LIMIT, isFollowLimitError } from '../lib/limits'
import type { FollowStatus, Post, Profile } from '../lib/types'
import { POST_SELECT, toPost } from '../lib/posts'

interface Props {
  /** username で引く（他人のページ）か、自分のIDで引くか */
  username?: string
  selfId?: string
}

export function ProfileView({ username, selfId }: Props) {
  const { user, profile: myProfile, refreshProfile } = useAuth()
  const { colors } = useTheme()
  const router = useRouter()
  const { width } = useWindowDimensions()

  const [profile, setProfile] = useState<Profile | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [followStatus, setFollowStatus] = useState<FollowStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [busyFollow, setBusyFollow] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [pickingEmoji, setPickingEmoji] = useState(false)

  const isOwn = !!selfId || (!!profile && profile.id === user?.id)
  const cell = (width - 4) / 3

  const load = useCallback(async () => {
    // プロフィール本体
    const q = supabase.from('profiles').select('*')
    const { data: p, error } = selfId
      ? await q.eq('id', selfId).maybeSingle()
      : await q.eq('username', username!).maybeSingle()

    if (error) {
      console.warn('[profile] 取得に失敗', error.message)
      setLoading(false)
      return
    }
    if (!p) {
      // ブロックされている場合も RLS で 0 件になるため、区別せず「見つからない」扱い
      setNotFound(true)
      setLoading(false)
      return
    }

    const prof = p as Profile
    setProfile(prof)

    // フォロー状態（他人のページのみ）
    if (user && prof.id !== user.id) {
      const { data: f } = await supabase
        .from('follows')
        .select('status')
        .eq('follower_id', user.id)
        .eq('following_id', prof.id)
        .maybeSingle()
      setFollowStatus((f?.status as FollowStatus) ?? null)
    }

    // 投稿。非公開アカウントかつ未フォローなら RLS で 0 件になる。
    const { data: rows } = await supabase
      .from('posts')
      .select(POST_SELECT)
      .eq('user_id', prof.id)
      .order('created_at', { ascending: false })

    setPosts((rows ?? []).map(toPost))
    setLoading(false)
  }, [username, selfId, user])

  useFocusEffect(useCallback(() => { load() }, [load]))

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    if (isOwn) await refreshProfile()
    setRefreshing(false)
  }, [load, isOwn, refreshProfile])

  /* ── フォロー / 解除 ─────────────────────────────── */
  const toggleFollow = useCallback(async () => {
    if (!user || !profile) return
    setBusyFollow(true)
    try {
      if (followStatus) {
        await supabase.from('follows').delete()
          .eq('follower_id', user.id).eq('following_id', profile.id)
        setFollowStatus(null)
        // カウンタはDBトリガーが更新するので、表示だけ即座に合わせる
        if (followStatus === 'accepted') {
          setProfile((p) =>
            p ? { ...p, followers_count: Math.max(p.followers_count - 1, 0) } : p
          )
        }
      } else {
        // status はサーバー側トリガーが公開/非公開に応じて決める
        const { error } = await supabase.from('follows')
          .insert({ follower_id: user.id, following_id: profile.id })
        if (error) throw error

        const next: FollowStatus = profile.is_public ? 'accepted' : 'pending'
        setFollowStatus(next)
        if (next === 'accepted') {
          setProfile((p) => (p ? { ...p, followers_count: p.followers_count + 1 } : p))
          await load() // 公開アカウントなら投稿が見えるようになるので再取得
        }
      }
    } catch (e) {
      // 上限はDBのトリガーが止めている。端末側のチェックだけだと
      // API を直接叩けば回避できるため、エラーを受けて案内する。
      if (isFollowLimitError(e)) {
        Alert.alert(
          'フォローできる人数の上限です',
          `無料でフォローできるのは${FREE_FOLLOW_LIMIT}人までです。`
            + '\n（運営アカウントはこの人数に含まれません）',
          [
            { text: '閉じる', style: 'cancel' },
            { text: 'プランを見る', onPress: () => router.push('/settings/subscription') },
          ]
        )
      } else {
        Alert.alert('エラー', (e as Error).message)
      }
    } finally {
      setBusyFollow(false)
    }
  }, [user, profile, followStatus, load, router])

  /* ── 投稿ごとの公開/非公開切り替え（自分のみ） ────────── */
  const togglePostVisibility = useCallback(async (post: Post) => {
    const next = !post.is_public
    // 楽観更新
    setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, is_public: next } : p)))

    const { error } = await supabase.from('posts').update({ is_public: next }).eq('id', post.id)
    if (error) {
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, is_public: !next } : p)))
      Alert.alert('切り替えに失敗しました', error.message)
    }
  }, [])

  /* ── ブロック（App Store Guideline 1.2 必須） ───────── */
  const blockUser = useCallback(() => {
    if (!user || !profile) return
    Alert.alert(
      `@${profile.username} をブロックしますか？`,
      'お互いの投稿とプロフィールが見えなくなります。フォロー関係も解除されます。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: 'ブロック',
          style: 'destructive',
          onPress: async () => {
            // 相互のフォローを解除してからブロックする
            await supabase.from('follows').delete()
              .eq('follower_id', user.id).eq('following_id', profile.id)
            await supabase.from('follows').delete()
              .eq('follower_id', profile.id).eq('following_id', user.id)

            const { error } = await supabase.from('blocks')
              .insert({ blocker_id: user.id, blocked_id: profile.id })
            if (error) {
              Alert.alert('ブロックに失敗しました', error.message)
              return
            }
            router.back()
          },
        },
      ]
    )
  }, [user, profile, router])

  /* ─────────────────────────  描画  ───────────────────────── */

  if (loading) return <Loading />

  if (notFound || !profile) {
    return (
      <EmptyState
        emoji="🤔"
        title="このアカウントは表示できません"
        body="削除されたか、非公開設定またはブロックにより閲覧できません。"
      />
    )
  }

  // 非公開アカウントで、自分でもフォロワーでもない場合は中身を隠す
  const locked = !profile.is_public && !isOwn && followStatus !== 'accepted'

  const rank = rankOf(profile.posts_count, profile.areas_count)
  const next = nextRank(rank)
  const progress = progressToNext(profile.posts_count, profile.areas_count, rank, next)
  const remaining = remainingToNext(profile.posts_count, profile.areas_count, next)

  /** 絵柄の保存。未解放のものはDBのトリガーが NULL に戻すので、結果を読み直す。 */
  const saveEmoji = async (emoji: string | null) => {
    if (!user) return
    const { data, error } = await supabase
      .from('profiles')
      .update({ avatar_emoji: emoji })
      .eq('id', user.id)
      .select('avatar_emoji')
      .single()

    setPickingEmoji(false)
    if (error) {
      Alert.alert('保存できませんでした', error.message)
      return
    }
    // トリガーに弾かれた場合はここで null が返る
    if (emoji && data?.avatar_emoji !== emoji) {
      Alert.alert('まだ使えません', 'この絵柄は、もう少しランクが上がると選べるようになります。')
    }
    setProfile((p) => (p ? { ...p, avatar_emoji: data?.avatar_emoji ?? null } : p))
    await refreshProfile()
  }

  const header = (
    <View style={{ paddingBottom: space.md }}>
      <View style={styles.top}>
        <Pressable
          onPress={isOwn ? () => setPickingEmoji(true) : undefined}
          disabled={!isOwn}
          accessibilityRole={isOwn ? 'button' : undefined}
          accessibilityLabel={isOwn ? 'アイコンの絵柄を変える' : undefined}
        >
          <RankAvatar
            uri={profile.photo_url}
            emoji={profile.avatar_emoji}
            name={profile.display_name}
            rank={rank}
            size={80}
          />
          {isOwn && (
            <View style={[styles.editIcon, { backgroundColor: colors.accent, borderColor: colors.bg }]}>
              <Ionicons name="brush" size={11} color={colors.accentText} />
            </View>
          )}
        </Pressable>

        <View style={styles.stats}>
          <Stat value={profile.posts_count} label="投稿" />
          <Stat value={profile.areas_count} label="エリア" />
          <Stat value={profile.followers_count} label="フォロワー" />
          <Stat value={profile.following_count} label="フォロー中" />
        </View>
      </View>

      <View style={styles.identity}>
        <View style={styles.nameRow}>
          <Txt variant="title">{profile.display_name}</Txt>
          <RankBadge rank={rank} compact />
          {!profile.is_public && (
            <View style={[styles.privateTag, { backgroundColor: colors.surfaceAlt }]}>
              <Ionicons name="lock-closed" size={11} color={colors.textMuted} />
              <Txt variant="caption" tone="muted">非公開</Txt>
            </View>
          )}
        </View>
        <Txt variant="small" tone="faint">@{profile.username}</Txt>
        {!!profile.bio && (
          <Txt variant="body" tone="muted" style={{ marginTop: space.sm }}>{profile.bio}</Txt>
        )}
      </View>

      {/* ── 次のランクまで（自分のページだけ） ─────────────
        * 進捗だけ見せても動けないので、
        * 「あと何をすればいいか」を1行の導線にして添える。
        */}
      {isOwn && next && (
        <Pressable
          onPress={() => router.push('/post/new')}
          style={({ pressed }) => [
            styles.rankBox,
            { backgroundColor: colors.surfaceAlt, opacity: pressed ? 0.75 : 1 },
          ]}
        >
          <View style={styles.rankBoxTop}>
            <Txt variant="smallMed">{remaining}</Txt>
            <Txt variant="caption" tone="faint">{Math.round(progress * 100)}%</Txt>
          </View>
          <View style={[styles.track, { backgroundColor: colors.border }]}>
            <View
              style={[
                styles.fill,
                { width: `${Math.max(progress * 100, 2)}%`, backgroundColor: next.frame },
              ]}
            />
          </View>
          <View style={styles.rankBoxTop}>
            <Txt variant="caption" tone="faint">
              {profile.areas_count < next.areas
                ? '行ったことのない街で記録すると早く上がります'
                : 'エリアは投稿した街の数です'}
            </Txt>
            <View style={styles.cta}>
              <Txt variant="caption" tone="accent">記録する</Txt>
              <Ionicons name="chevron-forward" size={12} color={colors.accent} />
            </View>
          </View>
        </Pressable>
      )}

      <View style={styles.actions}>
        {isOwn ? (
          <>
            <Button
              title="プロフィールを編集"
              variant="secondary"
              style={{ flex: 1 }}
              onPress={() => router.push('/settings/edit-profile')}
            />
            <Button
              title="設定"
              variant="secondary"
              style={{ width: 96 }}
              onPress={() => router.push('/settings')}
            />
          </>
        ) : (
          <>
            <Button
              title={
                followStatus === 'accepted' ? 'フォロー中'
                : followStatus === 'pending' ? 'リクエスト済み'
                : 'フォローする'
              }
              variant={followStatus ? 'secondary' : 'primary'}
              loading={busyFollow}
              style={{ flex: 1 }}
              onPress={toggleFollow}
            />
            <Button
              title="通報"
              variant="secondary"
              style={{ width: 80 }}
              onPress={() => setReporting(true)}
            />
            <Button
              title="ブロック"
              variant="danger"
              style={{ width: 96 }}
              onPress={blockUser}
            />
          </>
        )}
      </View>

      {isOwn && posts.length > 0 && (
        <View style={[styles.tip, { backgroundColor: colors.surfaceAlt }]}>
          <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
          <Txt variant="small" tone="muted" style={{ flex: 1 }}>
            投稿は初期状態では非公開です。写真の鍵アイコンを押すと公開/非公開を切り替えられます。
          </Txt>
        </View>
      )}
    </View>
  )

  return (
    <>
      <FlatList
        data={locked ? [] : posts}
        keyExtractor={(p) => p.id}
        numColumns={3}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingBottom: space.xxxl }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
        ListEmptyComponent={
          locked ? (
            <EmptyState
              emoji="🔒"
              title="非公開アカウントです"
              body="フォローが承認されると投稿を見られるようになります。"
            />
          ) : (
            <EmptyState
              emoji="📷"
              title={isOwn ? '最初の投稿をしてみましょう' : 'まだ投稿がありません'}
              body={isOwn ? '下の＋ボタンから、食べたお店を地図に残せます。' : undefined}
            />
          )
        }
        renderItem={({ item }) => (
          <View style={{ width: cell, height: cell, margin: 1 }}>
            {item.images[0] ? (
              <Image
                source={{ uri: item.images[0] }}
                style={[styles.cell, { backgroundColor: colors.surfaceAlt }]}
                contentFit="cover"
                transition={120}
              />
            ) : (
              <View
                style={[
                  styles.cell,
                  { backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
                ]}
              >
                <Txt style={{ fontSize: 24 }}>{GENRE_EMOJI[item.genre] ?? '🍴'}</Txt>
              </View>
            )}

            {/* 自分の投稿だけ、公開/非公開をその場で切り替えられる */}
            {isOwn && (
              <Pressable
                onPress={() => togglePostVisibility(item)}
                hitSlop={6}
                accessibilityRole="switch"
                accessibilityState={{ checked: item.is_public }}
                accessibilityLabel={item.is_public ? 'この投稿を非公開にする' : 'この投稿を公開する'}
                style={[
                  styles.lockBadge,
                  { backgroundColor: item.is_public ? colors.geo : 'rgba(0,0,0,0.55)' },
                ]}
              >
                <Ionicons
                  name={item.is_public ? 'earth' : 'lock-closed'}
                  size={12}
                  color="#fff"
                />
              </Pressable>
            )}
          </View>
        )}
      />

      {reporting && profile && (
        <ReportDialog
          targetUserId={profile.id}
          targetLabel={`@${profile.username}`}
          onClose={() => setReporting(false)}
        />
      )}

      {isOwn && (
        <AvatarEmojiPicker
          visible={pickingEmoji}
          rank={rank}
          current={profile.avatar_emoji}
          onClose={() => setPickingEmoji(false)}
          onSelect={saveEmoji}
        />
      )}
    </>
  )
}

const styles = StyleSheet.create({
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xl,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
  stats: { flex: 1, flexDirection: 'row', justifyContent: 'space-around' },
  identity: { paddingHorizontal: space.lg, paddingTop: space.lg, gap: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  privateTag: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
  tip: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    marginHorizontal: space.lg, marginTop: space.lg,
    padding: space.md, borderRadius: radius.md,
  },
  editIcon: {
    position: 'absolute', right: -2, bottom: -2,
    width: 24, height: 24, borderRadius: 12, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  rankBox: {
    marginHorizontal: space.lg, marginTop: space.lg,
    padding: space.md, borderRadius: radius.md, gap: space.sm,
  },
  rankBoxTop: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  track: { height: 4, overflow: 'hidden' },
  fill: { height: '100%' },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  cell: { width: '100%', height: '100%', borderRadius: radius.sm },
  lockBadge: {
    position: 'absolute', top: 5, right: 5,
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
})
