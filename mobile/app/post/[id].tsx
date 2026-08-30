import { useCallback, useRef, useState } from 'react'
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet,
  useWindowDimensions, View,
} from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { supabase } from '../../src/lib/supabase'
import { useAuth } from '../../src/hooks/useAuth'
import { useTheme, space, radius, GENRE_EMOJI, SITUATION_EMOJI } from '../../src/theme'
import { Avatar, EmptyState, Loading, Txt } from '../../src/components/ui'
import { DemoNotice } from '../../src/components/DemoNotice'
import { ReportDialog } from '../../src/components/ReportDialog'
import { HeaderButton } from '../../src/components/HeaderBack'
import { POST_SELECT, toPost } from '../../src/lib/posts'
import { openDirections, openInMaps } from '../../src/lib/maps'
import { formatImpressions, recordImpression } from '../../src/lib/impressions'
import type { Post } from '../../src/lib/types'

/**
 * 投稿の詳細。
 *
 * 地図のプレビューシートは「これは何の店か」を1秒で判断させるためのもので、
 * キャプションは3行で切れ、写真もサムネイルしか出ない。
 * 店を決めた後に読みたい情報（全文・大きな写真・誰が何と言っているか）は
 * 行き場がなかったので、この画面を置いた。
 */
export default function PostDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { user } = useAuth()
  const { colors } = useTheme()
  const { width } = useWindowDimensions()
  const router = useRouter()

  const [post, setPost] = useState<Post | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [imageIndex, setImageIndex] = useState(0)

  const [liked, setLiked] = useState(false)
  const [likes, setLikes] = useState(0)
  const [liking, setLiking] = useState(false)

  const [impressions, setImpressions] = useState(0)

  /**
   * 通報ダイアログ。
   *
   * ★ 通報は投稿単位でも受けられないといけない（Guideline 1.2）。
   *   以前はプロフィールにしか導線が無く、「この写真が不適切」という
   *   報告先が存在しなかった。アカウントごと通報するしかないのは、
   *   報告する側にとっても重すぎる。
   */
  const [reporting, setReporting] = useState(false)

  /**
   * 削除中。
   *
   * ★ 投稿を消す手段は必ず要る。
   *   これまでは、一度出したものを取り下げる方法がどこにも無かった。
   *   間違えて公開した人にできるのは非公開に戻すことだけで、
   *   写真そのものはサーバーに残り続けていた。
   */
  const [deleting, setDeleting] = useState(false)

  /**
   * 表示回数を記録した投稿。
   *
   * この画面は useFocusEffect で読み直すので、他の画面から戻るたびに
   * 走ってしまう。DB側でも1人1日1回に丸めているが、
   * 意味のない往復は減らしておく。
   */
  const counted = useRef<string | null>(null)

  /**
   * いま中身を出している投稿のID。
   *
   * ★ 真偽値ではなくIDで持つこと。
   *   「一度でも出したか」だけだと、別の投稿へ移ったときにも
   *   前の投稿を出したままになり、取得が終わるまで
   *   違う店の写真と本文が見えてしまう。
   */
  const shownId = useRef<string | null>(null)

  /**
   * 取得の世代。あとから始めた取得だけを採用する。
   *
   * この画面は useFocusEffect で読み直すうえ、プレビューから
   * 続けて別の投稿を開ける。前の取得が遅れて返ると、
   * 新しく開いた投稿を古い投稿で上書きしてしまう。
   */
  const seq = useRef(0)

  const load = useCallback(async () => {
    if (!id) return

    const mine = ++seq.current

    // ★ 同じ投稿を読み直すときは、出しているものを消さないこと。
    //   この画面は useFocusEffect で読み直すので、
    //   他の画面から戻るたびに全画面ローディングへ切り替わり、
    //   写真も本文も一度消えてから描き直されていた。
    //   別の投稿に移ったときは、逆に必ずローディングにする。
    const samePost = shownId.current === id
    if (!samePost) {
      setPost(null)
      setNotFound(false)
      setLoading(true)
    }

    // RLS が非公開投稿を弾くので、見えなければ 0 行で返る。
    const { data, error } = await supabase
      .from('posts')
      .select(POST_SELECT)
      .eq('id', id)
      .maybeSingle()

    // 追い越された取得の結果は捨てる
    if (mine !== seq.current) return

    if (error) {
      console.warn('[post] 取得に失敗', error.message)
      setNotFound(true)
      setLoading(false)
      return
    }
    if (!data) {
      setNotFound(true)
      setLoading(false)
      return
    }

    const p = toPost(data)
    shownId.current = p.id
    setPost(p)
    setLikes(p.likes_count ?? 0)
    setImpressions(p.impressions_count ?? 0)

    // 表示回数を数える。
    // 数える条件（公開投稿・投稿者以外・1人1日1回）はDB側で見ているので、
    // ここでは「同じ画面で何度も呼ばない」ことだけ気にする。
    if (counted.current !== p.id) {
      counted.current = p.id
      recordImpression(p.id).then((n) => {
        if (n !== null) setImpressions(n)
      })
    }

    if (user) {
      const { data: liked } = await supabase
        .from('likes')
        .select('post_id')
        .eq('post_id', p.id)
        .eq('user_id', user.id)
        .maybeSingle()
      if (mine !== seq.current) return
      setLiked(!!liked)
    }
    setLoading(false)
  }, [id, user])

  useFocusEffect(useCallback(() => { load() }, [load]))

  /**
   * いいね。
   * posts.likes_count は DB トリガー trg_like_counts が likes 行の
   * INSERT / DELETE で増減させる。ここで足すと1回で2動くので触らない。
   */
  const toggleLike = useCallback(async () => {
    if (!user || !post || liking) return
    setLiking(true)

    const next = !liked
    setLiked(next)
    setLikes((n) => Math.max(0, n + (next ? 1 : -1)))

    try {
      if (next) {
        const { error } = await supabase
          .from('likes')
          .upsert({ post_id: post.id, user_id: user.id },
            { onConflict: 'post_id,user_id', ignoreDuplicates: true })
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('likes').delete().eq('post_id', post.id).eq('user_id', user.id)
        if (error) throw error
      }
      // 他の人のいいねも反映したいので確定値を取り直す
      const { data: fresh } = await supabase
        .from('posts').select('likes_count').eq('id', post.id).single()
      if (fresh) setLikes((fresh.likes_count as number) ?? 0)
    } catch {
      setLiked(!next)
      setLikes((n) => Math.max(0, n + (next ? -1 : 1)))
    } finally {
      setLiking(false)
    }
  }, [user, post, liked, liking])

  /**
   * 削除。
   *
   * 消す順番は「投稿の行 → 写真の実体」。
   *   post_images・いいね・コメントは ON DELETE CASCADE で一緒に消え、
   *   投稿数とエリア数はトリガーが数え直す。
   *   逆にすると、写真だけ消えた投稿が地図に残る時間ができる。
   *   Storage の後片付けに失敗しても、見えないゴミが残るだけで済ませる。
   */
  const confirmDelete = useCallback(() => {
    if (!user || !post || deleting) return

    Alert.alert(
      'この投稿を削除しますか？',
      '写真・いいね・コメントも一緒に消えます。元に戻すことはできません。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除する',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true)

            const { error } = await supabase.from('posts').delete().eq('id', post.id)
            if (error) {
              setDeleting(false)
              Alert.alert('削除できませんでした', error.message)
              return
            }

            try {
              // アップロード時のパスは `${uid}/${postId}/${i}.jpg`（post/new.tsx）
              const dir = `${user.id}/${post.id}`
              const { data: files } = await supabase.storage.from('post-images').list(dir)
              if (files && files.length > 0) {
                await supabase.storage
                  .from('post-images')
                  .remove(files.map((f) => `${dir}/${f.name}`))
              }
            } catch (e) {
              console.warn('[post] 写真の後片付けに失敗', e)
            }

            // 戻り先（プロフィールや地図）は画面に戻った時点で読み直すので、
            // ここで一覧を触る必要はない。
            // 通知などから直接開かれていて戻り先が無い場合もあるため、
            // そのときはプロフィールへ送る（消えた投稿の画面に留まらせない）。
            if (router.canGoBack()) router.back()
            else router.replace('/(tabs)/profile')
          },
        },
      ]
    )
  }, [user, post, deleting, router])

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Stack.Screen options={{ title: '' }} />
        <Loading />
      </View>
    )
  }

  if (notFound || !post) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Stack.Screen options={{ title: '' }} />
        <EmptyState
          emoji="🔒"
          title="この投稿は表示できません"
          body="削除されたか、公開されていない投稿です。"
        />
      </View>
    )
  }

  const area = post.area ?? post.city ?? post.prefecture ?? ''

  /**
   * 自分の投稿は通報できない。
   * 自分で自分を通報できる画面は、通報一覧をただ汚す。
   */
  const canReport = !!user && post.user_id !== user.id

  /** 自分の投稿。消せるのは本人だけ（posts の削除ポリシーも同じ条件） */
  const isMine = !!user && post.user_id === user.id

  return (
    <>
      <Stack.Screen
        options={{
          title: '',
          // ヘッダーにも出す。本文が長いとき、下まで
          // スクロールしないと通報できないのでは導線として弱い。
          //
          // ★ 枠は HeaderButton に任せること。
          //   ここで独自に組むと、左の戻るボタンと寄せ方が食い違って
          //   左右で違う量だけ外へずれる（実際そうなっていた）。
          //
          //   自分の投稿には通報の代わりに削除を出す。
          //   同じ場所で役割が入れ替わるだけなので、
          //   どちらの立場でも右上を見れば用が足りる。
          headerRight:
            canReport || isMine
              ? () => (
                  <HeaderButton
                    onPress={isMine ? confirmDelete : () => setReporting(true)}
                    disabled={deleting}
                    accessibilityLabel={isMine ? 'この投稿を削除する' : 'この投稿を通報する'}
                  >
                    {deleting ? (
                      <ActivityIndicator size="small" color={colors.textFaint} />
                    ) : (
                      <Ionicons
                        // 左の戻る矢印(26)と見た目の重さを揃える
                        name={isMine ? 'trash-outline' : 'flag-outline'}
                        size={22}
                        color={isMine ? colors.danger : colors.text}
                      />
                    )}
                  </HeaderButton>
                )
              : undefined,
        }}
      />
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ paddingBottom: space.xxxl }}
      >
        {/* ── 写真。角丸なしの全幅で、雑誌の見開きのように置く ───── */}
        {post.images.length > 0 && (
          <View>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) =>
                setImageIndex(Math.round(e.nativeEvent.contentOffset.x / width))
              }
            >
              {post.images.map((uri) => (
                <Image
                  key={uri}
                  source={{ uri }}
                  style={{ width, height: width, backgroundColor: colors.surfaceAlt }}
                  contentFit="cover"
                  transition={180}
                />
              ))}
            </ScrollView>

            {post.images.length > 1 && (
              <View style={styles.dots}>
                {post.images.map((uri, i) => (
                  <View
                    key={uri}
                    style={[
                      styles.dot,
                      {
                        backgroundColor: i === imageIndex ? colors.surface : 'rgba(255,255,255,0.45)',
                      },
                    ]}
                  />
                ))}
              </View>
            )}
          </View>
        )}

        <View style={{ padding: space.lg, gap: space.lg }}>
          {/* ── 店名と基本情報 ───────────────────────── */}
          <View style={{ gap: space.xs }}>
            {!!area && (
              <Txt variant="caption" tone="faint">
                {[post.prefecture, area].filter(Boolean).join(' · ').toUpperCase()}
              </Txt>
            )}

            <Txt variant="title">{post.location_name}</Txt>

            {/* 実在の店の評価を読ませる画面なので、
                本文より先にデモであることを出す。 */}
            {post.author?.is_demo && (
              <View style={{ marginTop: space.sm }}>
                <DemoNotice compact />
              </View>
            )}
            <View style={styles.meta}>
              <View style={styles.rating}>
                {[1, 2, 3, 4, 5].map((s) => (
                  <Ionicons
                    key={s}
                    name={s <= post.rating ? 'star' : 'star-outline'}
                    size={14}
                    color={s <= post.rating ? colors.star : colors.borderStrong}
                  />
                ))}
              </View>
              <Txt variant="small" tone="faint">·</Txt>
              <Txt variant="small" tone="muted">
                {GENRE_EMOJI[post.genre] ?? '🍴'} {post.genre}
              </Txt>
              <Txt variant="small" tone="faint">·</Txt>
              <Txt variant="small" tone="muted">{post.price_range}</Txt>
            </View>
          </View>

          {/* ── 投稿者 ───────────────────────────── */}
          {post.author && (
            <Pressable
              onPress={() => router.push(`/user/${post.author!.username}`)}
              style={({ pressed }) => [
                styles.author,
                { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Avatar uri={post.author.photo_url} name={post.author.display_name} size={38} />
              <View style={{ flex: 1 }}>
                <Txt variant="smallMed" numberOfLines={1}>{post.author.display_name}</Txt>
                <Txt variant="small" tone="faint" numberOfLines={1}>@{post.author.username}</Txt>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
            </Pressable>
          )}

          {/* ── 本文（ここが今まで3行で切れていた） ───────── */}
          {!!post.caption && (
            <Txt variant="body" style={{ lineHeight: 27 }}>{post.caption}</Txt>
          )}

          {/* ── シチュエーション ─────────────────────
           *
           * ★ ハッシュタグと同じ行に流さないこと。
           *   囲みのあるチップと、囲みのない #文字列 を混ぜると、
           *   どこまでが1つのかたまりなのか分からなくなる。
           *   別のものは別の行に置く。
           *
           * こちらは決められた選択肢（デート・ひとり飯…）なので、
           * 数が知れている。チップのまま並べる。 */}
          {post.situations?.length > 0 && (
            <View style={styles.tags}>
              {post.situations.map((s) => (
                <View
                  key={s}
                  style={[styles.tag, { borderColor: colors.border, backgroundColor: colors.surface }]}
                >
                  <Txt variant="small" tone="muted">{SITUATION_EMOJI[s] ?? ''} {s}</Txt>
                </View>
              ))}
            </View>
          )}

          {/* ── ハッシュタグ ─────────────────────────
           *
           * 自由入力なので数も長さも読めない。1つずつ囲むと
           * 画面が四角だらけになるので、文字のまま続けて流す。 */}
          {post.hashtags?.length > 0 && (
            <Txt variant="small" tone="accent" style={styles.hashtags}>
              {post.hashtags.map((h) => `#${h}`).join('   ')}
            </Txt>
          )}

          {/* ── いいね・コメント数 ─────────────────── */}
          <View style={[styles.counts, { borderColor: colors.border }]}>
            <Pressable
              onPress={toggleLike}
              disabled={!user || liking}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={liked ? 'いいねを取り消す' : 'いいね'}
              style={({ pressed }) => [styles.count, { opacity: pressed ? 0.6 : 1 }]}
            >
              {liking
                ? <ActivityIndicator size="small" color={colors.textFaint} />
                : <Ionicons
                    name={liked ? 'heart' : 'heart-outline'}
                    size={20}
                    color={liked ? colors.danger : colors.textMuted}
                  />}
              <Txt variant="smallMed" tone="muted">{likes}</Txt>
            </Pressable>

            <View style={styles.count}>
              <Ionicons name="chatbubble-outline" size={18} color={colors.textMuted} />
              <Txt variant="smallMed" tone="muted">{post.comments_count ?? 0}</Txt>
            </View>

            {/* 表示回数。同じ人が何度開いても1日1回しか増えないので、
                「何回開かれたか」ではなく「何人に届いたか」に近い。 */}
            <View style={styles.count}>
              <Ionicons name="eye-outline" size={18} color={colors.textMuted} />
              <Txt variant="smallMed" tone="muted">{formatImpressions(impressions)}</Txt>
            </View>
          </View>

          {/* ── 店へ向かう導線。
                外部の地図アプリを URL で開くだけなので API 費用はかからない ── */}
          <View style={styles.actions}>
            <Pressable
              onPress={() => openInMaps(post.location_name, post.area)}
              style={({ pressed }) => [
                styles.action,
                { borderColor: colors.borderStrong, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Ionicons name="storefront-outline" size={16} color={colors.text} />
              <Txt variant="smallMed">この店を調べる</Txt>
            </Pressable>

            <Pressable
              onPress={() => openDirections(post.location_lat, post.location_lng, post.location_name)}
              style={({ pressed }) => [
                styles.action,
                { borderColor: colors.borderStrong, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Ionicons name="navigate-outline" size={16} color={colors.text} />
              <Txt variant="smallMed">行き方</Txt>
            </Pressable>
          </View>

          {/* ── 通報（Guideline 1.2）──────────────────
                本文と写真を読み終わった位置に置く。
                不適切だと判断できるのは中身を見たあとなので、
                その場ですぐ報告できるところに無いと使われない。 */}
          {canReport && (
            <Pressable
              onPress={() => setReporting(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="この投稿を通報する"
              style={({ pressed }) => [styles.report, { opacity: pressed ? 0.55 : 1 }]}
            >
              <Ionicons name="flag-outline" size={15} color={colors.textFaint} />
              <Txt variant="small" tone="faint">この投稿を通報する</Txt>
            </Pressable>
          )}

          {/* ── 削除（本人のみ）──────────────────────
                通報と同じ位置に置く。写真と本文を確かめてから
                消すかどうかを決める流れは、通報と同じ。
                取り消せない操作なので、色で destructive だと分かるようにする。 */}
          {isMine && (
            <Pressable
              onPress={confirmDelete}
              disabled={deleting}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="この投稿を削除する"
              style={({ pressed }) => [
                styles.report,
                { opacity: pressed || deleting ? 0.55 : 1 },
              ]}
            >
              <Ionicons name="trash-outline" size={15} color={colors.danger} />
              <Txt variant="small" tone="danger">
                {deleting ? '削除しています…' : 'この投稿を削除する'}
              </Txt>
            </Pressable>
          )}
        </View>
      </ScrollView>

      {reporting && (
        <ReportDialog
          // 投稿を指す。target_user_id は入れない。
          // admin_open_reports が投稿から作者を引く（COALESCE）ので、
          // 両方入れると「アカウントへの通報」と見分けが付かなくなる。
          targetPostId={post.id}
          targetLabel={`「${post.location_name}」の投稿`}
          onClose={() => setReporting(false)}
        />
      )}
    </>
  )
}

const styles = StyleSheet.create({
  dots: {
    position: 'absolute', bottom: space.md, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', gap: 5,
  },
  dot: { width: 5, height: 5, borderRadius: 3 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 2 },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  author: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingVertical: space.md, borderTopWidth: 1, borderBottomWidth: 1,
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  hashtags: { lineHeight: 22 },
  tag: {
    paddingHorizontal: space.md, paddingVertical: 5,
    borderRadius: radius.sm, borderWidth: 1,
  },
  counts: {
    flexDirection: 'row', gap: space.xl,
    paddingVertical: space.md, borderTopWidth: 1, borderBottomWidth: 1,
  },
  count: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minWidth: 44 },
  actions: { flexDirection: 'row', gap: space.sm },
  report: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: space.xs, paddingVertical: space.sm,
  },
  action: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: space.xs, paddingVertical: space.md,
    borderWidth: 1, borderRadius: radius.sm,
  },
})
