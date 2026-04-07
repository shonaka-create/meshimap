'use client'

import { useState, Suspense, useEffect } from 'react'
import TopBar from '@/components/layout/TopBar'
import BottomNav from '@/components/layout/BottomNav'
import { Search, Star, Hash } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Post } from '@/types'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

const POPULAR_TAGS = ['ランチ', '夜ごはん', 'カフェ活', 'ラーメン', '寿司', '焼肉', 'スイーツ', 'グルメ', '東京', '和食']

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

function PostGrid({ posts }: { posts: Post[] }) {
  return (
    <div className="grid grid-cols-3 gap-0.5 mt-0.5">
      {posts.map((post) => (
        <Link key={post.id} href={`/profile/${post.userId}`} className="relative aspect-square bg-gray-100 group">
          {post.imageURLs[0] && <img src={post.imageURLs[0]} alt="" className="w-full h-full object-cover" />}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
              <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
              <span className="text-white text-sm font-bold">{post.rating}.0</span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  )
}

function SearchContent() {
  const searchParams = useSearchParams()
  const initialTag = searchParams.get('tag') ?? ''
  const [searchText, setSearchText] = useState(initialTag ? `#${initialTag}` : '')
  const [results, setResults] = useState<Post[]>([])
  const [discoverPosts, setDiscoverPosts] = useState<Post[]>([])
  const [searched, setSearched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [discoverLoading, setDiscoverLoading] = useState(true)

  // おすすめ投稿を全ユーザーから取得
  useEffect(() => {
    const fetchDiscover = async () => {
      setDiscoverLoading(true)
      try {
        const { data } = await supabase
          .from('posts')
          .select('*, profiles!posts_user_id_fkey(display_name, photo_url), post_images(url, position)')
          .order('created_at', { ascending: false })
          .limit(60)
        if (data) setDiscoverPosts(data.map(toPost))
      } catch (e) {
        console.error('おすすめ投稿の取得に失敗しました', e)
      } finally {
        setDiscoverLoading(false)
      }
    }
    fetchDiscover()
  }, [])

  useEffect(() => {
    if (initialTag) handleSearch(`#${initialTag}`)
  }, [initialTag])

  const handleSearch = async (text?: string) => {
    const q = (text ?? searchText).trim()
    if (!q) { setSearched(false); return }
    setSearched(true)
    setLoading(true)
    try {
      let query = supabase.from('posts')
        .select('*, profiles!posts_user_id_fkey(display_name, photo_url), post_images(url, position)')
        .order('created_at', { ascending: false })
        .limit(30)

      if (q.startsWith('#')) {
        query = query.contains('hashtags', [q.slice(1)])
      } else {
        // ユーザー名 or お店名 で検索
        const { data: profileMatches } = await supabase
          .from('profiles')
          .select('id')
          .ilike('display_name', `%${q}%`)
        const profileIds = profileMatches?.map((p) => p.id) ?? []

        const { data: byLocation } = await supabase.from('posts')
          .select('*, profiles!posts_user_id_fkey(display_name, photo_url), post_images(url, position)')
          .ilike('location_name', `%${q}%`)
          .order('created_at', { ascending: false })
          .limit(30)

        const { data: byUser } = profileIds.length > 0
          ? await supabase.from('posts')
            .select('*, profiles!posts_user_id_fkey(display_name, photo_url), post_images(url, position)')
            .in('user_id', profileIds)
            .order('created_at', { ascending: false })
            .limit(30)
          : { data: [] }

        const merged = [...(byLocation ?? []), ...(byUser ?? [])]
        const unique = merged.filter((v, i, a) => a.findIndex((t) => t.id === v.id) === i)
        setResults(unique.map(toPost))
        setLoading(false)
        return
      }
      const { data } = await query
      setResults(data ? data.map(toPost) : [])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <TopBar title="検索" />
      <main className="pt-14 pb-24 max-w-lg mx-auto">
        <div className="bg-white px-4 py-3 border-b border-gray-100">
          <form onSubmit={(e) => { e.preventDefault(); handleSearch() }} className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
            <input type="text" value={searchText} onChange={(e) => { setSearchText(e.target.value); if (!e.target.value) setSearched(false) }}
              placeholder="#ハッシュタグ・ユーザー名・お店の名前"
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-300" />
          </form>
        </div>

        {/* 未検索 → おすすめ投稿 */}
        {!searched && (
          <>
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
              <h2 className="font-semibold text-sm text-gray-700">おすすめ</h2>
              <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                {POPULAR_TAGS.slice(0, 5).map((tag) => (
                  <button key={tag} onClick={() => { setSearchText(`#${tag}`); handleSearch(`#${tag}`) }}
                    className="flex items-center gap-0.5 px-2.5 py-1 bg-white border border-gray-200 rounded-full text-xs text-gray-600 whitespace-nowrap hover:border-orange-300 hover:text-orange-600 transition-colors shrink-0">
                    <Hash className="w-3 h-3" />{tag}
                  </button>
                ))}
              </div>
            </div>
            {discoverLoading ? (
              <div className="grid grid-cols-3 gap-0.5 mt-0.5">
                {[...Array(9)].map((_, i) => <div key={i} className="aspect-square bg-gray-200 animate-pulse" />)}
              </div>
            ) : discoverPosts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center px-8">
                <span className="text-5xl mb-3">🍽️</span>
                <p className="text-gray-600 text-sm">まだ投稿がありません</p>
              </div>
            ) : (
              <PostGrid posts={discoverPosts} />
            )}
          </>
        )}

        {loading && (
          <div className="grid grid-cols-3 gap-0.5 mt-0.5">
            {[...Array(9)].map((_, i) => <div key={i} className="aspect-square bg-gray-200 animate-pulse" />)}
          </div>
        )}

        {searched && !loading && (
          <>
            <div className="px-4 py-2.5 bg-white border-b border-gray-100">
              <p className="text-sm text-gray-600"><span className="font-semibold text-gray-800">{results.length}件</span>の結果</p>
            </div>
            {results.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center px-8">
                <span className="text-5xl mb-3">🔍</span>
                <p className="text-gray-600 text-sm">投稿が見つかりませんでした</p>
                <button onClick={() => { setSearched(false); setSearchText('') }} className="mt-4 text-orange-500 text-sm">おすすめを見る</button>
              </div>
            ) : (
              <PostGrid posts={results} />
            )}
          </>
        )}
      </main>
      <BottomNav />
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50">
        <TopBar title="検索" />
        <main className="pt-14 pb-24 max-w-lg mx-auto">
          <div className="grid grid-cols-3 gap-0.5 mt-0.5">
            {[...Array(9)].map((_, i) => <div key={i} className="aspect-square bg-gray-200 animate-pulse" />)}
          </div>
        </main>
        <BottomNav />
      </div>
    }>
      <SearchContent />
    </Suspense>
  )
}
