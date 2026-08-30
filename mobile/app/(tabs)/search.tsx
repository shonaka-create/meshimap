import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions,
} from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../../src/lib/supabase'
import {
  useTheme, space, radius, GENRE_EMOJI,
} from '../../src/theme'
import { Chip, EmptyState, Field, Loading, Txt } from '../../src/components/ui'
import { RankAvatar } from '../../src/components/RankAvatar'
import type { Post, Profile } from '../../src/lib/types'
import { POST_SELECT, toPost } from '../../src/lib/posts'
import { formatImpressions } from '../../src/lib/impressions'
import { pgContains } from '../../src/lib/filters'
import { rankOf } from '../../src/lib/rank'

type Tab = 'posts' | 'accounts'

export default function Search() {
  const { colors } = useTheme()
  const router = useRouter()
  const { width } = useWindowDimensions()

  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Tab>('posts')

  const [discover, setDiscover] = useState<Post[]>([])
  const [postResults, setPostResults] = useState<Post[]>([])
  const [accounts, setAccounts] = useState<Profile[]>([])

  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const cell = (width - 4) / 3

  /* ── 発見タブ: 公開アカウントの公開投稿だけが RLS で返ってくる ── */
  const loadDiscover = useCallback(async () => {
    const { data, error } = await supabase
      .from('posts')
      .select(POST_SELECT)
      .order('created_at', { ascending: false })
      .limit(60)

    if (error) console.warn('[search] おすすめ取得に失敗', error.message)
    else setDiscover((data ?? []).map(toPost))
    setLoading(false)
  }, [])

  useEffect(() => { loadDiscover() }, [loadDiscover])

  /* ── 検索（入力が止まってから走らせる） ─────────────── */
  const seq = useRef(0)
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setPostResults([])
      setAccounts([])
      setSearching(false)
      return
    }

    setSearching(true)
    const mine = ++seq.current

    const timer = setTimeout(async () => {
      // アカウント検索: アカウント名（重複OK）と ユーザーID の両方に部分一致
      const accountsReq = supabase
        .from('profiles')
        .select('*')
        .or(`display_name.ilike.${pgContains(q)},username.ilike.${pgContains(q)}`)
        .order('followers_count', { ascending: false })
        .limit(40)

      // 投稿検索: 店名・キャプション・ハッシュタグ
      const tag = q.startsWith('#') ? q.slice(1) : null
      const postsReq = tag
        ? supabase.from('posts').select(POST_SELECT).contains('hashtags', [tag])
            .order('created_at', { ascending: false }).limit(60)
        : supabase.from('posts').select(POST_SELECT)
            .or(`location_name.ilike.${pgContains(q)},caption.ilike.${pgContains(q)}`)
            .order('created_at', { ascending: false }).limit(60)

      const [acc, pst] = await Promise.all([accountsReq, postsReq])
      if (mine !== seq.current) return // 古い結果は破棄

      // ★ 失敗したら前の語の結果を残さないこと。
      //   残すと、打ち替えたのに前の結果が並んだままになり、
      //   新しい語で本当にそれが出たように見える。
      if (acc.error) {
        console.warn('[search] アカウント検索に失敗', acc.error.message)
        setAccounts([])
      } else setAccounts((acc.data ?? []) as Profile[])

      if (pst.error) {
        console.warn('[search] 投稿検索に失敗', pst.error.message)
        setPostResults([])
      } else setPostResults((pst.data ?? []).map(toPost))

      setSearching(false)
    }, 350)

    return () => clearTimeout(timer)
  }, [query])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await loadDiscover()
    setRefreshing(false)
  }, [loadDiscover])

  const isSearching = query.trim().length > 0
  const posts = isSearching ? postResults : discover

  /* ─────────────────────────  描画  ───────────────────────── */

  const renderGrid = () => (
    <FlatList
      key="grid"
      data={posts}
      keyExtractor={(p) => p.id}
      numColumns={3}
      contentContainerStyle={posts.length === 0 ? { flexGrow: 1 } : undefined}
      refreshControl={
        !isSearching ? (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        ) : undefined
      }
      ListEmptyComponent={
        searching ? (
          <Loading />
        ) : (
          <EmptyState
            emoji={isSearching ? '🔍' : '🍽️'}
            title={isSearching ? '見つかりませんでした' : 'まだ公開投稿がありません'}
            body={
              isSearching
                ? '別のキーワードで試してみてください。'
                : 'アカウントを公開設定にしている人の公開投稿がここに並びます。'
            }
          />
        )
      }
      renderItem={({ item }) => (
        <Pressable
          // 投稿を押したら投稿を開く。以前は投稿者のプロフィールに飛んでいて、
          // 見たかった一枚に辿り着けなかった。
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
          {item.images.length > 1 && (
            <View style={styles.multi}>
              <Ionicons name="copy" size={12} color="#fff" />
            </View>
          )}
          {/* 投稿者のランク。左上に置く。
              枠の色は RankAvatar と同じ配色なので、
              アイコンの縁の色とここが結びつく。
              色だけだと覚えないと読めないので、名前も出す。 */}
          {item.author && (() => {
            const r = rankOf(item.author.posts_count, item.author.areas_count)
            return (
              <View style={[styles.badge, styles.rank, { borderColor: r.frame }]}>
                <Txt style={[styles.badgeText, { color: r.frame }]}>{r.name}</Txt>
              </View>
            )
          })()}

          {/* 表示回数。0 のときは出さない。
              「0」が並ぶと、見られていないことを強調するだけで
              誰の役にも立たない。 */}
          {item.impressions_count > 0 && (
            <View style={[styles.badge, styles.impressions]}>
              <Ionicons name="eye" size={10} color="#fff" />
              <Txt style={styles.featuredText}>
                {formatImpressions(item.impressions_count)}
              </Txt>
            </View>
          )}
        </Pressable>
      )}
    />
  )

  const renderAccounts = () => (
    <FlatList
      key="accounts"
      data={accounts}
      keyExtractor={(p) => p.id}
      contentContainerStyle={accounts.length === 0 ? { flexGrow: 1 } : undefined}
      ListEmptyComponent={
        searching ? (
          <Loading />
        ) : (
          <EmptyState
            emoji="👤"
            title={isSearching ? 'アカウントが見つかりません' : 'アカウントを検索'}
            body="アカウント名（表示名）でも ユーザーID でも探せます。"
          />
        )
      }
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.push(`/user/${item.username}`)}
          style={({ pressed }) => [
            styles.accountRow,
            { borderBottomColor: colors.border, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <RankAvatar
            uri={item.photo_url}
            emoji={item.avatar_emoji}
            name={item.display_name}
            postsCount={item.posts_count}
            areasCount={item.areas_count}
            size={48}
          />
          <View style={{ flex: 1, gap: 1 }}>
            <View style={styles.nameRow}>
              <Txt variant="bodyMed" numberOfLines={1}>{item.display_name}</Txt>
              {!item.is_public && (
                <Ionicons name="lock-closed" size={12} color={colors.textFaint} />
              )}
            </View>
            <Txt variant="small" tone="faint" numberOfLines={1}>@{item.username}</Txt>
            <Txt variant="small" tone="muted">
              フォロワー {item.followers_count} · 投稿 {item.posts_count}
            </Txt>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        </Pressable>
      )}
    />
  )

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <Loading />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.searchBar}>
        <Field
          value={query}
          onChangeText={setQuery}
          placeholder="アカウント名 · ユーザーID · お店 · #タグ"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          prefix="🔍"
          right={
            query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="クリア">
                <Ionicons name="close-circle" size={18} color={colors.textFaint} />
              </Pressable>
            ) : undefined
          }
        />
      </View>

      {/* 検索中だけタブを出す。未検索時は発見グリッドのみ。 */}
      {isSearching && (
        <View style={[styles.tabs, { borderBottomColor: colors.border }]}>
          {(['posts', 'accounts'] as Tab[]).map((t) => (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              style={[
                styles.tab,
                tab === t && { borderBottomColor: colors.accent, borderBottomWidth: 2 },
              ]}
            >
              <Txt variant="smallMed" tone={tab === t ? 'default' : 'muted'}>
                {t === 'posts' ? `投稿 ${postResults.length}` : `アカウント ${accounts.length}`}
              </Txt>
            </Pressable>
          ))}
        </View>
      )}

      {isSearching && tab === 'accounts' ? renderAccounts() : renderGrid()}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  searchBar: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md },
  featuredEntry: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    marginHorizontal: space.lg, marginBottom: space.md,
    paddingHorizontal: space.md, paddingVertical: space.md,
    borderWidth: 1, borderRadius: radius.md,
  },
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, alignItems: 'center', paddingVertical: space.md },
  cell: { width: '100%', height: '100%', borderRadius: radius.sm },
  multi: { position: 'absolute', top: 6, right: 6, opacity: 0.9 },

  /* 写真の上に載る小さな札。写真の明るさが読めないので、
     どれも暗い面に白抜きで置く。四隅に1つずつ、重ならないように配置する。 */
  badge: {
    position: 'absolute',
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 5, paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(20,17,15,0.72)',
  },
  /** 左上: 投稿者のランク。枠線だけランクの色にする */
  rank: { top: 5, left: 5, borderWidth: 1 },
  /** 右下: 表示回数 */
  impressions: { right: 5, bottom: 5 },

  featured: {
    position: 'absolute', left: 5, bottom: 5,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 5, paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(20,17,15,0.72)',
  },
  featuredText: { color: '#fff', fontSize: 9, letterSpacing: 0.8 },
  badgeText: { fontSize: 9, letterSpacing: 0.4, fontWeight: '600' },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
})
