'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useAuthContext } from '@/components/auth/AuthProvider'
import TopBar from '@/components/layout/TopBar'
import BottomNav from '@/components/layout/BottomNav'
import nextDynamic from 'next/dynamic'
import { supabase } from '@/lib/supabase'
import { GENRE_META } from '@/lib/genreMeta'
import type { Post } from '@/types'
import { Search, Sparkles, X } from 'lucide-react'
import RecommendSheet from '@/components/map/RecommendSheet'

const MapView = nextDynamic(() => import('@/components/map/MapView'), { ssr: false })

const GENRES = ['すべて', '和食', '洋食', 'イタリアン', 'フレンチ', '中華', '韓国料理', 'アジア料理', 'カフェ', 'ラーメン', '寿司', '焼肉', 'スイーツ', 'その他']
type ViewMode = 'all' | 'mine'

export default function MapPage() {
  const { user } = useAuthContext()
  const [posts, setPosts] = useState<Post[]>([])
  const [viewMode, setViewMode] = useState<ViewMode>('all')
  const [selectedGenre, setSelectedGenre] = useState('すべて')
  const [userSearch, setUserSearch] = useState('')
  const [showRecommend, setShowRecommend] = useState(false)
  const [likedPostIds, setLikedPostIds] = useState<string[]>([])
  const [flyTo, setFlyTo] = useState<{ pos: [number, number]; key: number } | undefined>()

  // ログインユーザーのいいね済み投稿IDを取得
  useEffect(() => {
    if (!user) return
    supabase
      .from('likes')
      .select('post_id')
      .eq('user_id', user.id)
      .then(({ data, error }) => {
        if (error) { console.error('いいね情報の取得に失敗しました', error); return }
        if (data) setLikedPostIds(data.map((r) => r.post_id as string))
      })
  }, [user?.id])

  useEffect(() => {
    if (!user) return
    const fetchPosts = async () => {
      try {
        let ids: string[]
        if (viewMode === 'mine') {
          ids = [user.id]
        } else {
          const { data: follows } = await supabase.from('follows').select('following_id').eq('follower_id', user.id)
          ids = [user.id, ...(follows?.map((f) => f.following_id) ?? [])]
        }
        const { data } = await supabase
          .from('posts')
          .select('*, profiles!posts_user_id_fkey(display_name, photo_url), post_images(url, position)')
          .in('user_id', ids)
          .order('created_at', { ascending: false })
          .limit(200)
        if (data) setPosts(data.map(toPost))
      } catch (e) {
        console.error('地図データの取得に失敗しました', e)
      }
    }
    fetchPosts()
  }, [user?.id, viewMode])

  const filtered = posts
    .filter((p) => selectedGenre === 'すべて' || p.genre === selectedGenre)
    .filter((p) => !userSearch.trim() || p.userDisplayName.includes(userSearch.trim()))

  return (
    <div className="h-[100dvh] flex flex-col bg-gray-50">
      <TopBar title="地図" />
      <main className="flex-1 overflow-hidden flex flex-col pt-14 pb-16">
        <div className="bg-white border-b border-gray-100 px-4 py-2 space-y-2 shrink-0">

          {/* モード切替 + おすすめボタン */}
          <div className="flex items-center gap-2">
            <div className="flex rounded-xl bg-gray-100 p-1 flex-1">
              {(['all', 'mine'] as ViewMode[]).map((m) => (
                <button key={m} onClick={() => setViewMode(m)}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${viewMode === m ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
                  {m === 'all' ? 'フォロー中' : '自分だけ'}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowRecommend(true)}
              className="flex items-center gap-1 px-3 py-2 rounded-xl bg-gradient-to-r from-orange-400 to-rose-500 text-white text-xs font-semibold shadow-sm shrink-0">
              <Sparkles className="w-3.5 h-3.5" />
              おすすめ
            </button>
          </div>

          {/* ユーザー検索入力（常時表示） */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="ユーザー名で絞り込む"
              className="w-full pl-9 pr-8 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all"
            />
            {userSearch && (
              <button onClick={() => setUserSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            )}
          </div>

          {/* ジャンルフィルター */}
          <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            <button onClick={() => setSelectedGenre('すべて')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs whitespace-nowrap font-medium border transition-all shrink-0 ${selectedGenre === 'すべて' ? 'bg-gray-800 text-white border-gray-800' : 'bg-gray-100 text-gray-600 border-gray-200'}`}>
              🗺️ すべて
            </button>
            {GENRES.slice(1).map((g) => {
              const meta = GENRE_META[g]
              const isSelected = selectedGenre === g
              return (
                <button key={g} onClick={() => setSelectedGenre(g)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs whitespace-nowrap font-medium transition-all shrink-0 border"
                  style={isSelected ? { background: meta.border, color: '#fff', borderColor: meta.border } : { background: meta.bg, color: meta.border, borderColor: meta.border }}>
                  {meta.emoji} {g}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex-1 min-h-0">
          <MapView posts={filtered} flyTo={flyTo} />
        </div>

        <div className="bg-white px-4 py-2.5 border-t border-gray-100 flex items-center gap-2 shrink-0">
          {userSearch && <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">{userSearch}</span>}
          {selectedGenre !== 'すべて' && <span className="text-base">{GENRE_META[selectedGenre]?.emoji}</span>}
          <p className="text-xs text-gray-500"><span className="font-semibold text-gray-700">{filtered.length}件</span>のスポットを表示中</p>
        </div>
      </main>
      <BottomNav />

      {showRecommend && user && (
        <RecommendSheet
          posts={posts}
          myUserId={user.id}
          likedPostIds={likedPostIds}
          onClose={() => setShowRecommend(false)}
          onSelectSpot={(post) => {
            setShowRecommend(false)
            setFlyTo({ pos: [post.location.lat, post.location.lng], key: Date.now() })
          }}
        />
      )}
    </div>
  )
}

function toPost(d: Record<string, unknown>): Post {
  const images = ((d.post_images as { url: string; position: number }[]) ?? []).sort((a, b) => a.position - b.position).map((i) => i.url)
  const profile = d.profiles as { display_name: string; photo_url: string | null } | null
  return {
    id: d.id as string, userId: d.user_id as string,
    userDisplayName: profile?.display_name ?? '名無し', userPhotoURL: profile?.photo_url ?? null,
    imageURLs: images, caption: (d.caption as string) ?? '',
    rating: d.rating as number, genre: d.genre as Post['genre'], priceRange: d.price_range as Post['priceRange'],
    location: { name: d.location_name as string, lat: d.location_lat as number, lng: d.location_lng as number },
    hashtags: (d.hashtags as string[]) ?? [], likesCount: (d.likes_count as number) ?? 0,
    commentsCount: (d.comments_count as number) ?? 0, createdAt: new Date(d.created_at as string),
  }
}
