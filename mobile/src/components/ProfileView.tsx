import { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, View,
  useWindowDimensions,
} from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useTheme, space, radius, GENRE_EMOJI } from '../theme'
import { Button, Chip, EmptyState, Loading, Stat, Txt } from './ui'
import { ReportDialog } from './ReportDialog'
import { RankAvatar, RankBadge } from './RankAvatar'
import { AvatarEmojiPicker } from './AvatarEmojiPicker'
import { rankOf } from '../lib/rank'
import { BILLING_READY } from '../lib/billing'
import { DemoNotice } from './DemoNotice'
import { FREE_MAP_LIMIT, isFollowLimitError } from '../lib/limits'
import type { FollowStatus, Post, Profile } from '../lib/types'
import { POST_SELECT, toPost } from '../lib/posts'
import {
  deleteAvatarByUrl, isPhotoPermissionError, pickAvatarImage, pickHeaderImage,
  uploadAvatar, uploadHeader,
} from '../lib/avatar'

interface Props {
  /** username で引く（他人のページ）か、自分のIDで引くか */
  username?: string
  selfId?: string
}

/** 投稿の写真を1列に並べる数 */
const COLUMNS = 4
const GRID_GAP = 6
/** 好きなジャンルとして出す数 */
const TOP_GENRES = 4

/** 投稿の多いジャンルから順に */
function topGenresOf(posts: Post[]): string[] {
  const counts = new Map<string, number>()
  for (const p of posts) {
    if (!p.genre || p.genre === 'その他') continue
    counts.set(p.genre, (counts.get(p.genre) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_GENRES)
    .map(([g]) => g)
}

export function ProfileView({ username, selfId }: Props) {
  const { user, refreshProfile } = useAuth()
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
  /** 取得そのものが失敗した。「見つからない」とは別に持つ */
  const [loadError, setLoadError] = useState(false)
  const [pickingEmoji, setPickingEmoji] = useState(false)
  /** アイコン写真の入れ替え中。押しっぱなしにさせないために持つ */
  const [savingPhoto, setSavingPhoto] = useState(false)
  /** ヘッダー写真の入れ替え中 */
  const [savingHeader, setSavingHeader] = useState(false)
  /**
   * ジャンルの絞り込み。プロフィールのチップを押すと、その種類だけを出す。
   *
   * ★ 飾りにしないこと。以前は押せないチップが並んでいるだけで、
   *   「押せそうなのに何も起きない」といちばん惜しい形だった。
   */
  const [genreFilter, setGenreFilter] = useState<string | null>(null)

  const isOwn = !!selfId || (!!profile && profile.id === user?.id)
  const cell = (width - space.lg * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS

  const load = useCallback(async () => {
    // プロフィール本体
    const q = supabase.from('profiles').select('*')
    const { data: p, error } = selfId
      ? await q.eq('id', selfId).maybeSingle()
      : await q.eq('username', username!).maybeSingle()

    if (error) {
      // ★ 通信の失敗を「見つからない」と混ぜないこと。
      //   混ぜると、圏外で開いただけで「このアカウントは表示できません」と
      //   出る。相手が消えたのか電波が無いのかは、見ている人には大違いで、
      //   前者だと思えばもう二度と開きに来ない。
      console.warn('[profile] 取得に失敗', error.message)
      setLoadError(true)
      setLoading(false)
      return
    }
    if (!p) {
      // ブロックされている場合も RLS で 0 件になるため、区別せず「見つからない」扱い
      setNotFound(true)
      setLoadError(false)
      setLoading(false)
      return
    }

    const prof = p as Profile
    setProfile(prof)
    // ★ 取れたら必ず戻すこと。戻さないと、一度でも
    //   見つからなかった画面は、引っ張って更新して成功しても
    //   「表示できません」のままになる。
    setNotFound(false)
    setLoadError(false)

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
        // status も on_map もサーバー側のトリガーが決める。
        // 入れた行を読み返すのは、地図に出たかどうかをその場で伝えるため
        // （移行 0013。地図の枠が埋まっていると on_map は false で入る）。
        const { data: row, error } = await supabase.from('follows')
          .insert({ follower_id: user.id, following_id: profile.id })
          .select('*')
          .single()
        if (error) throw error

        const next: FollowStatus = profile.is_public ? 'accepted' : 'pending'
        setFollowStatus(next)
        if (next === 'accepted') {
          setProfile((p) => (p ? { ...p, followers_count: p.followers_count + 1 } : p))
          await load() // 公開アカウントなら投稿が見えるようになるので再取得

          // フォローは通ったが、地図には出ていない。
          // ★ 黙って通さないこと。あとで地図を見に行って
          //   「フォローしたのに出てこない」と気づくのでは不具合に見える。
          //   0013 前のDBには on_map が無いので、そのときは何も言わない。
          if (row && row.on_map === false) {
            Alert.alert(
              'フォローしました',
              `地図に同時に出せるのは${FREE_MAP_LIMIT}人までなので、この人はまだ地図に出ていません。`
                + '\n地図の左下「みんなの地図」から、出す人を入れ替えられます。'
                + (BILLING_READY
                  ? '\nプレミアムにすると、フォローした人を全員そのまま地図に出せます。'
                  : ''),
              BILLING_READY
                ? [
                    { text: '閉じる', style: 'cancel' },
                    { text: 'プランを見る', onPress: () => router.push('/settings/subscription') },
                  ]
                : [{ text: '閉じる', style: 'cancel' }]
            )
          }
        }
      }
    } catch (e) {
      // ★ 移行 0013 を流す前のDBだけがここに来る。
      //   そちらはフォローそのものを2人で止めているので、
      //   アプリだけ先に更新された端末のために案内を残しておく。
      //   0013 以降、フォローは何人でもできる（止まるのは地図に出す側）。
      if (isFollowLimitError(e)) {
        Alert.alert(
          'フォローできる人数の上限です',
          `いまはフォローできるのは${FREE_MAP_LIMIT}人までです。`
            + '\n（運営アカウントはこの人数に含まれません）',
          [{ text: '閉じる', style: 'cancel' }]
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

  /* ── フォロー / フォロワーの一覧を開く ───────────────
   * 数字は長らく飾りで、そこから相手へ行く道が無かった。
   */
  const openFollows = useCallback((tab: 'followers' | 'following') => {
    if (!profile) return
    router.push({
      pathname: '/follows',
      params: { userId: profile.id, displayName: profile.display_name, tab },
    })
  }, [profile, router])

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

  /* ── アイコンの入れ替え ─────────────────────────
   * ★ ここは早期リターン（loading / notFound）より前に置くこと。
   *   後ろに置くと、読み込み中はこの useCallback が呼ばれず、
   *   読み込みが終わった回だけフックが3つ増える。React は
   *   フックを呼ばれた順番で数えているので、数が変わった時点で
   *   「Rendered more hooks than during the previous render」で落ちる。
   *   プロフィールを開くたびに必ずクラッシュしていた原因がこれ。
   *
   *   profile が null の間も評価されるので、中では profile?. で触ること。
   *   下のヘッダー写真・一覧の集計（useMemo）も同じ理由でここより前に置く。
   */
  /** 写真を選び直す。保存が通ってから前の画像を消す */
  const replacePhoto = useCallback(async () => {
    if (!user || savingPhoto) return

    let uri: string | null = null
    try {
      uri = await pickAvatarImage()
    } catch (e) {
      if (isPhotoPermissionError(e)) {
        Alert.alert('写真へのアクセスが必要です', '設定アプリから写真の許可を有効にしてください。')
        return
      }
      Alert.alert('写真を選べませんでした', (e as Error).message)
      return
    }
    if (!uri) return

    setSavingPhoto(true)
    const previous = profile?.photo_url ?? null

    let uploaded: string | null = null
    try {
      uploaded = await uploadAvatar(user.id, uri)

      const { error } = await supabase
        .from('profiles').update({ photo_url: uploaded }).eq('id', user.id)
      if (error) throw error

      setProfile((p) => (p ? { ...p, photo_url: uploaded } : p))
      await refreshProfile()

      // ★ 保存が通ってから消すこと。先に消すと、
      //   保存に失敗したときにアイコンだけ無くなる。
      if (previous && previous !== uploaded) await deleteAvatarByUrl(user.id, previous)
      uploaded = null
    } catch (e) {
      // ★ 上げたのに使わなかった画像は片付ける。
      //   置いたままにすると、public バケットに誰からも参照されない
      //   写真が溜まっていく（退会時の後片付けからも漏れやすい）。
      if (uploaded) await deleteAvatarByUrl(user.id, uploaded)
      Alert.alert('アイコンを変更できませんでした', (e as Error).message)
    } finally {
      setSavingPhoto(false)
    }
  }, [user, savingPhoto, profile?.photo_url, refreshProfile])

  /** 写真を外す。絵柄と頭文字での表示に戻る */
  const removePhoto = useCallback(async () => {
    if (!user || savingPhoto) return
    const previous = profile?.photo_url ?? null

    setSavingPhoto(true)
    try {
      const { error } = await supabase
        .from('profiles').update({ photo_url: null }).eq('id', user.id)
      if (error) throw error

      setProfile((p) => (p ? { ...p, photo_url: null } : p))
      await refreshProfile()
      if (previous) await deleteAvatarByUrl(user.id, previous)
    } catch (e) {
      Alert.alert('写真を外せませんでした', (e as Error).message)
    } finally {
      setSavingPhoto(false)
    }
  }, [user, savingPhoto, profile?.photo_url, refreshProfile])

  /**
   * アイコンを押したときの選択肢。
   *
   * これまでは絵柄の選択だけが開き、写真を変えるには
   * 設定 → プロフィールを編集 → 写真を変更、と3階層潜る必要があった。
   * アイコンを押したら、そこで写真も絵柄も変えられるのが素直。
   *
   * ★ 名前・自己紹介の編集はここに入れない。
   *   アイコンの横に「プロフィールを編集」ボタンを置いたので、
   *   同じ行き先を2箇所に置くと、どちらが何を変えるのか分からなくなる。
   *   アイコン = 顔（写真・絵柄）、ボタン = 名前と自己紹介、と分ける。
   */
  const chooseAvatarAction = useCallback(() => {
    if (!user) return

    const options: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [
      { text: '写真を選ぶ', onPress: () => void replacePhoto() },
      { text: '絵柄から選ぶ', onPress: () => setPickingEmoji(true) },
    ]

    // 写真が入っているときだけ「外す」を出す。
    // 何も無いのに削除が並んでいると、何が消えるのか分からない。
    if (profile?.photo_url) {
      options.push({ text: '写真を外す', style: 'destructive', onPress: () => void removePhoto() })
    }
    options.push({ text: 'キャンセル', style: 'cancel' })

    Alert.alert('アイコン', undefined, options)
  }, [user, profile?.photo_url, replacePhoto, removePhoto])

  /* ── ヘッダー写真の入れ替え ───────────────────────
   * 流れはアイコンと同じ（保存が通ってから前の画像を消す・失敗したら上げた画像を片付ける）。
   */
  const replaceHeader = useCallback(async () => {
    if (!user || savingHeader) return

    let uri: string | null = null
    try {
      uri = await pickHeaderImage()
    } catch (e) {
      if (isPhotoPermissionError(e)) {
        Alert.alert('写真へのアクセスが必要です', '設定アプリから写真の許可を有効にしてください。')
        return
      }
      Alert.alert('写真を選べませんでした', (e as Error).message)
      return
    }
    if (!uri) return

    setSavingHeader(true)
    const previous = profile?.header_url ?? null

    let uploaded: string | null = null
    try {
      uploaded = await uploadHeader(user.id, uri)

      const { error } = await supabase
        .from('profiles').update({ header_url: uploaded }).eq('id', user.id)
      if (error) throw error

      setProfile((p) => (p ? { ...p, header_url: uploaded } : p))
      if (previous && previous !== uploaded) await deleteAvatarByUrl(user.id, previous)
      uploaded = null
    } catch (e) {
      if (uploaded) await deleteAvatarByUrl(user.id, uploaded)
      const msg = (e as Error).message ?? ''
      // ★ 移行 0020 を流す前のDBには列が無い。素のエラー文を出すと壊れて見える。
      if (msg.includes('header_url')) {
        Alert.alert(
          'まだ使えません',
          'アプリの更新に対してデータベース側の準備が終わっていません。しばらくしてからお試しください。'
        )
      } else {
        Alert.alert('ヘッダー写真を変更できませんでした', msg)
      }
    } finally {
      setSavingHeader(false)
    }
  }, [user, savingHeader, profile?.header_url])

  const removeHeader = useCallback(async () => {
    if (!user || savingHeader) return
    const previous = profile?.header_url ?? null

    setSavingHeader(true)
    try {
      const { error } = await supabase
        .from('profiles').update({ header_url: null }).eq('id', user.id)
      if (error) throw error

      setProfile((p) => (p ? { ...p, header_url: null } : p))
      if (previous) await deleteAvatarByUrl(user.id, previous)
    } catch (e) {
      Alert.alert('ヘッダー写真を外せませんでした', (e as Error).message)
    } finally {
      setSavingHeader(false)
    }
  }, [user, savingHeader, profile?.header_url])

  const chooseHeaderAction = useCallback(() => {
    const options: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [
      { text: '写真を選ぶ', onPress: () => void replaceHeader() },
    ]
    if (profile?.header_url) {
      options.push({ text: '写真を外す', style: 'destructive', onPress: () => void removeHeader() })
    }
    options.push({ text: 'キャンセル', style: 'cancel' })
    Alert.alert('ヘッダー写真', undefined, options)
  }, [profile?.header_url, replaceHeader, removeHeader])

  const genres = useMemo(() => topGenresOf(posts), [posts])

  /* ─────────────────────────  描画  ───────────────────────── */

  if (loading) return <Loading />

  // 取得に失敗しただけ。相手が消えたわけではないので、そう言ってやり直させる。
  //
  // ★ 既に中身を出しているとき（loadError && profile）は、この画面に
  //   切り替えない。引っ張って更新しただけで前の内容が消えるほうが困る。
  //   その場合は更新のくるくるが止まって、前の内容がそのまま残る。
  if (loadError && !profile) {
    return (
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
    )
  }

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

  // 投稿は畳まない。Instagram と同じく、そのままスクロールで全部見られる。
  const shownPosts = locked
    ? []
    : genreFilter
      ? posts.filter((p) => p.genre === genreFilter)
      : posts

  const header = (
    <View style={{ paddingBottom: space.md }}>
      {/* ── ヘッダー写真 ─────────────────────────────
        * 写真が無いときは面の色だけにする。
        * 何か絵を置くと、写真を設定した人との差が「未設定」ではなく
        * 「別のデザイン」に見えてしまう。 */}
      <View style={[styles.cover, { backgroundColor: colors.surfaceAlt }]}>
        {!!profile.header_url && (
          <Image
            source={{ uri: profile.header_url }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={150}
          />
        )}

        {/* ── 自分のページの右上 ─────────────────────
          * このタブにはナビゲーションのヘッダーが無いので、
          * 設定へ行く入口をここに置く。ヘッダー写真の変更も並べる。 */}
        {isOwn && (
          <View style={styles.ownerBar}>
            <Pressable
              onPress={chooseHeaderAction}
              disabled={savingHeader}
              accessibilityRole="button"
              accessibilityLabel="ヘッダー写真を変える"
              hitSlop={6}
              style={({ pressed }) => [
                styles.coverBtn,
                { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              {savingHeader
                ? <ActivityIndicator size="small" color={colors.textMuted} />
                : <Ionicons name="image-outline" size={18} color={colors.text} />}
            </Pressable>
            <Pressable
              onPress={() => router.push('/settings')}
              accessibilityRole="button"
              accessibilityLabel="設定"
              hitSlop={6}
              style={({ pressed }) => [
                styles.coverBtn,
                { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Ionicons name="settings-outline" size={18} color={colors.text} />
            </Pressable>
          </View>
        )}
      </View>

      {/* ── アイコンと数字 ──────────────────────────
        * Instagram と同じく、アイコンの右に数字を並べる。
        * 数字から相手へ行けるようにする。
        * ★ 非公開アカウントで中を見られない相手（locked）のときは
        *   フォロー・フォロワーを押せなくすること。交友関係は投稿と同じ扱いで、
        *   承認されたフォロワーにだけ見せる。
        * エリアは写真のカードを並べず、数字だけにする。 */}
      <View style={styles.avatarRow}>
        <Pressable
          onPress={isOwn ? chooseAvatarAction : undefined}
          disabled={!isOwn || savingPhoto}
          accessibilityRole={isOwn ? 'button' : undefined}
          accessibilityLabel={isOwn ? 'アイコンを変える' : undefined}
          style={[styles.avatarRing, { backgroundColor: colors.bg }]}
        >
          <RankAvatar
            uri={profile.photo_url}
            emoji={profile.avatar_emoji}
            name={profile.display_name}
            rank={rank}
            size={88}
          />
          {isOwn && (
            <View style={[styles.editIcon, { backgroundColor: colors.accent, borderColor: colors.bg }]}>
              {savingPhoto
                ? <ActivityIndicator size="small" color={colors.accentText} />
                : <Ionicons name="camera" size={11} color={colors.accentText} />}
            </View>
          )}
        </Pressable>

        <View style={styles.stats}>
          <View style={styles.statCell}>
            <Stat value={profile.posts_count} label="投稿" />
          </View>
          <View style={styles.statCell}>
            <Stat
              value={profile.followers_count}
              label="フォロワー"
              onPress={locked ? undefined : () => openFollows('followers')}
            />
          </View>
          <View style={styles.statCell}>
            <Stat
              value={profile.following_count}
              label="フォロー"
              onPress={locked ? undefined : () => openFollows('following')}
            />
          </View>
          <View style={styles.statCell}>
            <Stat value={profile.areas_count} label="エリア" />
          </View>
        </View>
      </View>

      {/* デモアカウントであることは、本文より先に出す。
          読んだ後で「実はデモでした」と分かるのでは意味がない。 */}
      {profile.is_demo && (
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
          <DemoNotice />
        </View>
      )}

      <View style={styles.identity}>
        <View style={styles.nameRow}>
          <Txt variant="title" style={{ flexShrink: 1 }} numberOfLines={1}>{profile.display_name}</Txt>
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

      {/* ── 自分のページなら「プロフィールを編集」（Instagram と同じく自己紹介の下） ── */}
      {isOwn && (
        <View style={styles.actions}>
          <Pressable
            onPress={() => router.push('/settings/edit-profile')}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.editBtn,
              { borderColor: colors.borderStrong, backgroundColor: colors.surface, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Ionicons name="create-outline" size={15} color={colors.text} />
            <Txt variant="smallMed" style={{ letterSpacing: 0.6 }}>プロフィールを編集</Txt>
          </Pressable>
        </View>
      )}

      {/* ── 相手のプロフィールにだけ出す操作 ──────────────── */}
      {!isOwn && (
        <View style={styles.actions}>
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
        </View>
      )}

      {/* ── 好きなジャンル（押すと絞り込み） ─────────────────
        * 本人に選ばせる欄ではなく、投稿の多いジャンルから出す。
        * 設定させる項目を増やすより、投稿すれば勝手に育つほうが続く。
        * 押すとその種類だけに絞り、もう一度押すと戻る。 */}
      {!locked && genres.length > 0 && (
        <View style={styles.genres}>
          {genres.map((g) => (
            <Chip
              key={g}
              label={`${GENRE_EMOJI[g] ?? ''} ${g}`.trim()}
              selected={genreFilter === g}
              onPress={() => setGenreFilter((cur) => (cur === g ? null : g))}
            />
          ))}
        </View>
      )}

      {/* ── 投稿（見出し。写真そのものは下の一覧） ───────────
        * ★ 「もっと見る / 閉じる」を戻さないこと。
        *   写真の一覧は畳まず全部出して、スクロールで見てもらう。 */}
      {!locked && posts.length > 0 && (
        <View style={[styles.section, { paddingBottom: space.sm }]}>
          <View style={styles.sectionHead}>
            <Txt variant="heading">投稿</Txt>
            {!!genreFilter && (
              <Pressable
                onPress={() => setGenreFilter(null)}
                hitSlop={10}
                accessibilityRole="button"
                style={({ pressed }) => [styles.more, { opacity: pressed ? 0.5 : 1 }]}
              >
                <Txt variant="small" tone="faint">{genreFilter} だけ表示中 · 解除</Txt>
                <Ionicons name="close-circle" size={13} color={colors.textFaint} />
              </Pressable>
            )}
          </View>
          {isOwn && (
            <View style={[styles.tip, { backgroundColor: colors.surfaceAlt }]}>
              <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
              <Txt variant="small" tone="muted" style={{ flex: 1 }}>
                投稿は初期状態では非公開です。写真の鍵アイコンを押すと公開/非公開を切り替えられます。
                写真を開くと、その投稿を削除できます。
              </Txt>
            </View>
          )}
        </View>
      )}
    </View>
  )

  // ★ ここに「みんなの地図」への入口やランクの進み具合（RankLadder）を戻さないこと。
  //   プロフィールは Instagram と同じく「顔・数字・自己紹介・投稿」だけにする。
  //   みんなの地図は地図タブのストーリーの列が受け持つ。

  return (
    <>
      <FlatList
        // ★ 列数を変えるときは key も変えること。FlatList は numColumns を
        //   途中で変えられず、変えると赤画面になる。ここでは固定なので不要。
        data={shownPosts}
        keyExtractor={(p) => p.id}
        numColumns={COLUMNS}
        columnWrapperStyle={styles.gridRow}
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
          ) : genreFilter ? (
            // 絞り込みで0件。「まだ投稿がありません」と出すと、
            // 投稿そのものが無いのだと誤解する。
            <EmptyState
              emoji="🍽️"
              title={`${genreFilter} の投稿はありません`}
              body="ジャンルをもう一度押すと、すべての投稿に戻ります。"
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
          // プロフィールの写真からも投稿を開けるようにする。
          // 中の鍵バッジは自分の投稿だけに出る別の Pressable で、
          // そちらを押したときは公開切り替えが優先される。
          <Pressable
            onPress={() => router.push({ pathname: '/post/[id]', params: { id: item.id } })}
            style={({ pressed }) => [
              { width: cell, height: cell, opacity: pressed ? 0.75 : 1 },
            ]}
          >
            {item.images[0] ? (
              <Image
                source={{ uri: item.images[0] }}
                style={[styles.cell, { backgroundColor: colors.surfaceAlt }]}
                contentFit="cover"
                transition={120}
              />
            ) : (
              <View style={[styles.cell, styles.center, { backgroundColor: colors.surfaceAlt }]}>
                <Txt style={{ fontSize: 22 }}>{GENRE_EMOJI[item.genre] ?? '🍴'}</Txt>
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
                  size={11}
                  color="#fff"
                />
              </Pressable>
            )}
          </Pressable>
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
  cover: { height: 150, overflow: 'hidden' },
  ownerBar: {
    position: 'absolute', top: space.sm, right: space.md,
    flexDirection: 'row', gap: space.sm,
  },
  /** 押せる大きさは hitSlop と合わせて 44pt を確保する */
  coverBtn: {
    width: 36, height: 36, borderRadius: radius.pill, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.md,
    paddingHorizontal: space.lg,
    marginTop: -46,
  },
  /** ヘッダー写真に重ねるので、地の色で縁取って写真から切り離す */
  avatarRing: { padding: 3, borderRadius: 999 },
  editBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs,
    height: 36, paddingHorizontal: space.md,
    borderRadius: radius.sm, borderWidth: 1,
  },
  identity: { paddingHorizontal: space.lg, paddingTop: space.md, gap: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  privateTag: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.sm,
  },
  /** アイコンの右。ヘッダー写真にかからない高さ（アイコンの下半分）に収める */
  stats: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  /** 中身を中央寄せにしない（Stat が自分で中央に置く）。幅を渡さないと文字の縮小が効かない */
  statCell: { flex: 1 },
  actions: {
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
  genres: {
    flexDirection: 'row', flexWrap: 'wrap', gap: space.sm,
    paddingHorizontal: space.lg, paddingTop: space.lg,
  },
  section: { paddingHorizontal: space.lg, paddingTop: space.xl, gap: space.md },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  more: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  gridRow: { gap: GRID_GAP, paddingHorizontal: space.lg, marginBottom: GRID_GAP },
  center: { alignItems: 'center', justifyContent: 'center' },
  tip: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    padding: space.md, borderRadius: radius.md,
  },
  editIcon: {
    position: 'absolute', right: 2, bottom: 2,
    width: 24, height: 24, borderRadius: 12, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  cell: { width: '100%', height: '100%', borderRadius: radius.sm },
  lockBadge: {
    position: 'absolute', top: 4, right: 4,
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
})
