import { useCallback, useState } from 'react'
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
import { Button, EmptyState, Loading, Stat, Txt } from './ui'
import { ReportDialog } from './ReportDialog'
import { RankAvatar, RankBadge } from './RankAvatar'
import { AvatarEmojiPicker } from './AvatarEmojiPicker'
import { rankOf } from '../lib/rank'
import { RankLadder } from './RankLadder'
import { BILLING_READY } from '../lib/billing'
import { DemoNotice } from './DemoNotice'
import { FREE_MAP_LIMIT, isFollowLimitError } from '../lib/limits'
import type { FollowStatus, Post, Profile } from '../lib/types'
import { POST_SELECT, toPost } from '../lib/posts'
import {
  deleteAvatarByUrl, isPhotoPermissionError, pickAvatarImage, uploadAvatar,
} from '../lib/avatar'

interface Props {
  /** username で引く（他人のページ）か、自分のIDで引くか */
  username?: string
  selfId?: string
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

  const isOwn = !!selfId || (!!profile && profile.id === user?.id)
  const cell = (width - 4) / 3

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
                + '\n地図の左下「他の人の地図」から、出す人を入れ替えられます。'
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
   * ★ 「プロフィールを編集」もここに入れてある。
   *   以前は写真の下に同じ名前のボタンを1つ並べていたが、
   *   自分のプロフィールで押す場所が「アイコン」と「そのすぐ下のボタン」の
   *   2箇所に割れていて、どちらが何を変えるのか見て分からなかった。
   *   自分に関する変更の入口はアイコン1箇所に寄せて、ボタンは外した。
   *   （名前・ユーザーID・自己紹介は settings/edit-profile が持つ）
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

    // 名前と自己紹介。アイコンの変更とは別の画面へ行くので、
    // 写真まわりの選択肢と混ざらないよう最後に置く。
    options.push({
      text: 'プロフィールを編集（名前・自己紹介）',
      onPress: () => router.push('/settings/edit-profile'),
    })
    options.push({ text: 'キャンセル', style: 'cancel' })

    Alert.alert('プロフィール', undefined, options)
  }, [user, profile?.photo_url, replacePhoto, removePhoto, router])


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

  const header = (
    <View style={{ paddingBottom: space.md }}>
      {/* ── 自分のページの右上 ─────────────────────
        * このタブにはナビゲーションのヘッダーが無いので、
        * 設定へ行く入口をここに置く。以前はプロフィールの下に
        * 「設定」ボタンを並べていたが、写真より下にあるうえ
        * 「プロフィールを編集」と役割が紛らわしかった。
        */}
      {isOwn && (
        <View style={styles.ownerBar}>
          <Pressable
            onPress={() => router.push('/settings')}
            accessibilityRole="button"
            accessibilityLabel="設定"
            hitSlop={8}
            style={({ pressed }) => [styles.menuBtn, { opacity: pressed ? 0.45 : 1 }]}
          >
            <Ionicons name="menu" size={26} color={colors.text} />
          </Pressable>
        </View>
      )}

      <View style={styles.top}>
        <Pressable
          onPress={isOwn ? chooseAvatarAction : undefined}
          disabled={!isOwn || savingPhoto}
          accessibilityRole={isOwn ? 'button' : undefined}
          accessibilityLabel={isOwn ? 'プロフィールを変える' : undefined}
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
              {savingPhoto
                ? <ActivityIndicator size="small" color={colors.accentText} />
                : <Ionicons name="camera" size={11} color={colors.accentText} />}
            </View>
          )}
        </Pressable>

        <View style={styles.stats}>
          <Stat value={profile.posts_count} label="投稿" />
          <Stat value={profile.areas_count} label="エリア" />
          {/* 数字から相手へ行けるようにする。
              ★ 非公開アカウントで中を見られない相手（locked）のときは
                押せなくすること。交友関係は投稿と同じ扱いで、
                承認されたフォロワーにだけ見せる。 */}
          <Stat
            value={profile.followers_count}
            label="フォロワー"
            onPress={locked ? undefined : () => openFollows('followers')}
          />
          <Stat
            value={profile.following_count}
            label="フォロー中"
            onPress={locked ? undefined : () => openFollows('following')}
          />
        </View>
      </View>

      {/* デモアカウントであることは、本文より先に出す。
          読んだ後で「実はデモでした」と分かるのでは意味がない。 */}
      {profile.is_demo && (
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg }}>
          <DemoNotice />
        </View>
      )}

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

      {/* ── ランク（自分のページだけ） ─────────────────
        * 5段のうちのどこに居て、次の段に何が足りないかを
        * この枠の中だけで分かるようにしてある（RankLadder）。
        * 押すと投稿画面へ。進捗を見せても、そこから動けなければ意味がない。
        */}
      {isOwn && (
        <Pressable
          onPress={() => router.push('/post/new')}
          style={({ pressed }) => [
            styles.rankBox,
            { backgroundColor: colors.surfaceAlt, opacity: pressed ? 0.75 : 1 },
          ]}
        >
          <RankLadder
            rank={rank}
            postsCount={profile.posts_count}
            areasCount={profile.areas_count}
          />
        </Pressable>
      )}

      {/* ── 相手のプロフィールにだけ出す操作 ────────────────
        * ★ 自分のページにはボタンを置かない。
        *   設定は右上のメニュー、写真・絵柄・名前・自己紹介は
        *   アイコンを押したときの選択肢に全て集めてある。
        *   ここに「プロフィールを編集」を1つだけ残しておくと、
        *   アイコンと役割が重なるうえ、自分のページだけ
        *   意味の薄い横一列の余白ができる。
        */}
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

      {isOwn && posts.length > 0 && (
        <View style={[styles.tip, { backgroundColor: colors.surfaceAlt }]}>
          <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
          <Txt variant="small" tone="muted" style={{ flex: 1 }}>
            投稿は初期状態では非公開です。写真の鍵アイコンを押すと公開/非公開を切り替えられます。
            写真を開くと、その投稿を削除できます。
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
          // プロフィールの写真からも投稿を開けるようにする。
          // 中の鍵バッジは自分の投稿だけに出る別の Pressable で、
          // そちらを押したときは公開切り替えが優先される。
          <Pressable
            onPress={() => router.push({ pathname: '/post/[id]', params: { id: item.id } })}
            style={({ pressed }) => [
              { width: cell, height: cell, margin: 1, opacity: pressed ? 0.75 : 1 },
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
  ownerBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: space.sm,
  },
  /** 44x44 は Apple のヒットターゲットの下限（HeaderBack と同じ） */
  menuBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
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
  featured: {
    position: 'absolute', left: 5, bottom: 5,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 5, paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(20,17,15,0.72)',
  },
  featuredText: { color: '#fff', fontSize: 9, letterSpacing: 0.8 },
  cell: { width: '100%', height: '100%', borderRadius: radius.sm },
  lockBadge: {
    position: 'absolute', top: 5, right: 5,
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
})
