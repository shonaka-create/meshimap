'use client'

import { useEffect, useState } from 'react'
import { useAuthContext } from '@/components/auth/AuthProvider'
import TopBar from '@/components/layout/TopBar'
import BottomNav from '@/components/layout/BottomNav'
import PostCard from '@/components/post/PostCard'
import LoginForm from '@/components/auth/LoginForm'
import { supabase } from '@/lib/supabase'
import type { Post } from '@/types'
import Link from 'next/link'

export default function HomePage() {
  const { user, loading } = useAuthContext()
  const [posts, setPosts] = useState<Post[]>([])
  const [postsLoading, setPostsLoading] = useState(true)

  // フェッチがハングしても5秒で強制解除
  useEffect(() => {
    if (!postsLoading) return
    const t = setTimeout(() => setPostsLoading(false), 5000)
    return () => clearTimeout(t)
  }, [postsLoading])

  useEffect(() => {
    if (!user) return
    const fetchPosts = async () => {
      setPostsLoading(true)
      try {
        // フォロー中のユーザーIDを取得
        const { data: follows } = await supabase
          .from('follows')
          .select('following_id')
          .eq('follower_id', user.id)

        const ids = [user.id, ...(follows?.map((f) => f.following_id) ?? [])]

        const { data } = await supabase
          .from('posts')
          .select(`
            *,
            profiles!posts_user_id_fkey(display_name, photo_url),
            post_images(url, position)
          `)
          .in('user_id', ids)
          .order('created_at', { ascending: false })
          .limit(30)

        if (data) {
          setPosts(data.map(toPost))
        }
      } catch (e) {
      } finally {
        setPostsLoading(false)
      }
    }
    fetchPosts()
  }, [user?.id])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-rose-50">
        <div className="text-center">
          <span className="text-5xl">🍜</span>
          <p className="text-gray-600 mt-3 text-sm">読み込み中...</p>
        </div>
      </div>
    )
  }

  if (!user) return <LoginForm />

  return (
    <div className="min-h-screen bg-gray-50">
      <TopBar showDM />
      <main className="pt-14 pb-24 max-w-lg mx-auto">
        {postsLoading ? (
          <div className="flex flex-col gap-0 divide-y divide-gray-100">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white animate-pulse">
                <div className="flex items-center gap-3 p-4">
                  <div className="w-9 h-9 rounded-full bg-gray-200" />
                  <div className="space-y-1.5">
                    <div className="h-3 w-24 bg-gray-200 rounded" />
                    <div className="h-2.5 w-16 bg-gray-200 rounded" />
                  </div>
                </div>
                <div className="aspect-square bg-gray-200" />
                <div className="p-4 space-y-2">
                  <div className="h-3 w-32 bg-gray-200 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-8">
            <span className="text-6xl mb-4">🗺️</span>
            <h2 className="text-xl font-bold text-gray-800 mb-2">まだ投稿がありません</h2>
            <p className="text-gray-600 text-sm leading-relaxed mb-6">
              他のユーザーをフォローするか、<br />初めての投稿を作成してみましょう！
            </p>
            <Link href="/search"
              className="px-5 py-2.5 bg-gradient-to-r from-orange-400 to-rose-500 text-white text-sm font-semibold rounded-xl shadow-md hover:opacity-90 transition-opacity">
              ユーザーを探す
            </Link>
          </div>
        ) : (
          <div className="bg-white divide-y divide-gray-100">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </main>
      <BottomNav />
    </div>
  )
}

// Supabaseのレコードを Post 型に変換
function toPost(d: Record<string, unknown>): Post {
  const images = ((d.post_images as { url: string; position: number }[]) ?? [])
    .sort((a, b) => a.position - b.position)
    .map((i) => i.url)
  const profile = d.profiles as { display_name: string; photo_url: string | null } | null
  return {
    id: d.id as string,
    userId: d.user_id as string,
    userDisplayName: profile?.display_name ?? '名無し',
    userPhotoURL: profile?.photo_url ?? null,
    imageURLs: images,
    caption: (d.caption as string) ?? '',
    rating: d.rating as number,
    genre: d.genre as Post['genre'],
    priceRange: d.price_range as Post['priceRange'],
    location: {
      name: d.location_name as string,
      lat: d.location_lat as number,
      lng: d.location_lng as number,
    },
    hashtags: (d.hashtags as string[]) ?? [],
    likesCount: (d.likes_count as number) ?? 0,
    commentsCount: (d.comments_count as number) ?? 0,
    createdAt: new Date(d.created_at as string),
  }
}
