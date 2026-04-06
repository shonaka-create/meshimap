'use client'

import { useState, useEffect } from 'react'
import { Heart, MessageCircle, MapPin, Star, ChevronLeft, ChevronRight, Send } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ja } from 'date-fns/locale'
import type { Post, Comment } from '@/types'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useAuthContext } from '@/components/auth/AuthProvider'

interface PostCardProps {
  post: Post
}

export default function PostCard({ post }: PostCardProps) {
  const { user } = useAuthContext()
  const [liked, setLiked] = useState(false)
  const [likesCount, setLikesCount] = useState(post.likesCount)
  const [liking, setLiking] = useState(false)
  const [imageIndex, setImageIndex] = useState(0)
  const [imgError, setImgError] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [comments, setComments] = useState<Comment[]>([])
  const [commentsCount, setCommentsCount] = useState(post.commentsCount)
  const [commentText, setCommentText] = useState('')

  useEffect(() => {
    if (!user) return
    supabase.from('likes').select('user_id').eq('post_id', post.id).eq('user_id', user.id).maybeSingle()
      .then(async ({ data }) => {
        if (data && post.likesCount === 0) {
          // likes テーブルにレコードがあるが likes_count が 0 → 古いデータ。削除して未いいね状態に戻す
          await supabase.from('likes').delete().eq('post_id', post.id).eq('user_id', user.id)
          setLiked(false)
        } else {
          setLiked(!!data)
        }
      })
  }, [user, post.id, post.likesCount])

  useEffect(() => {
    if (!showComments) return
    supabase.from('comments')
      .select('*, profiles!comments_user_id_fkey(display_name, photo_url)')
      .eq('post_id', post.id)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (data) setComments(data.map((c) => ({
          id: c.id,
          postId: c.post_id,
          userId: c.user_id,
          userDisplayName: (c.profiles as { display_name: string })?.display_name ?? '名無し',
          userPhotoURL: (c.profiles as { photo_url: string | null })?.photo_url ?? null,
          text: c.text,
          createdAt: new Date(c.created_at),
        })))
      })
  }, [showComments, post.id])

  const toggleLike = async () => {
    if (!user || liking) return
    setLiking(true)

    // 楽観的更新
    const newLiked = !liked
    const delta = newLiked ? 1 : -1
    setLiked(newLiked)
    setLikesCount((c) => Math.max(0, c + delta))

    try {
      if (newLiked) {
        const { error } = await supabase.from('likes').upsert(
          { post_id: post.id, user_id: user.id },
          { onConflict: 'post_id,user_id', ignoreDuplicates: true }
        )
        if (error) throw error
      } else {
        const { error } = await supabase.from('likes').delete().eq('post_id', post.id).eq('user_id', user.id)
        if (error) throw error
      }
      // DB の likes_count をインクリメント/デクリメント（現在値を取得してから更新）
      const { data: fresh } = await supabase.from('posts').select('likes_count').eq('id', post.id).single()
      const freshCount = (fresh?.likes_count as number) ?? 0
      const newCount = Math.max(0, freshCount + delta)
      const { error: updateError } = await supabase.from('posts').update({ likes_count: newCount }).eq('id', post.id)
      if (updateError) throw updateError
      setLikesCount(newCount)
    } catch (err) {
      // ロールバック
      setLiked(!newLiked)
      setLikesCount((c) => Math.max(0, c - delta))
      console.error('いいねエラー:', err)
    } finally {
      setLiking(false)
    }
  }

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user || !commentText.trim()) return
    const { data } = await supabase.from('comments')
      .insert({ post_id: post.id, user_id: user.id, text: commentText })
      .select('*, profiles!comments_user_id_fkey(display_name, photo_url)')
      .single()
    if (data) {
      setComments((prev) => [...prev, {
        id: data.id,
        postId: data.post_id,
        userId: data.user_id,
        userDisplayName: (data.profiles as { display_name: string })?.display_name ?? '名無し',
        userPhotoURL: (data.profiles as { photo_url: string | null })?.photo_url ?? null,
        text: data.text,
        createdAt: new Date(data.created_at),
      }])
      await supabase.from('posts').update({ comments_count: commentsCount + 1 }).eq('id', post.id)
      setCommentsCount((c) => c + 1)
    }
    setCommentText('')
  }

  const highlightHashtags = (text: string) =>
    text.split(/(#[\w\u3040-\u9FFF]+)/g).map((part, i) =>
      part.startsWith('#') ? (
        <Link key={i} href={`/search?tag=${part.slice(1)}`} className="text-blue-500 hover:underline">{part}</Link>
      ) : part
    )

  const priceColor: Record<string, string> = {
    '〜¥1,000': 'text-green-600', '¥1,001〜¥3,000': 'text-yellow-600',
    '¥3,001〜¥5,000': 'text-orange-600', '¥5,001〜¥10,000': 'text-red-600', '¥10,001〜': 'text-purple-600',
  }

  return (
    <article className="bg-white border-b border-gray-100">
      <div className="flex items-center justify-between px-4 py-3">
        <Link href={`/profile/${post.userId}`} className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full overflow-hidden bg-gradient-to-br from-orange-300 to-rose-400 flex items-center justify-center">
            {post.userPhotoURL
              ? <img src={post.userPhotoURL} alt="" className="w-full h-full object-cover" />
              : <span className="text-white text-sm font-semibold">{(post.userDisplayName || 'U')[0]}</span>}
          </div>
          <div>
            <p className="font-semibold text-sm">{post.userDisplayName}</p>
            <div className="flex items-center gap-1">
              <MapPin className="w-3 h-3 text-gray-400" />
              <p className="text-xs text-gray-400">{post.location.name}</p>
            </div>
          </div>
        </Link>
        <div className="flex items-center gap-1.5">
          <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">{post.genre}</span>
          <span className={`text-xs font-medium ${priceColor[post.priceRange] ?? 'text-gray-600'}`}>{post.priceRange}</span>
        </div>
      </div>

      <div className="relative aspect-square bg-gray-100">
        {post.imageURLs.length === 0 || imgError ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-300">
            <span className="text-5xl">🍽️</span>
          </div>
        ) : (
          <img
            src={post.imageURLs[imageIndex]}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        )}
        {post.imageURLs.length > 1 && (
          <>
            {imageIndex > 0 && (
              <button onClick={() => { setImageIndex((i) => i - 1); setImgError(false) }} className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/30 rounded-full flex items-center justify-center">
                <ChevronLeft className="w-5 h-5 text-white" />
              </button>
            )}
            {imageIndex < post.imageURLs.length - 1 && (
              <button onClick={() => { setImageIndex((i) => i + 1); setImgError(false) }} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/30 rounded-full flex items-center justify-center">
                <ChevronRight className="w-5 h-5 text-white" />
              </button>
            )}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
              {post.imageURLs.map((_, i) => <div key={i} className={`w-1.5 h-1.5 rounded-full ${i === imageIndex ? 'bg-white' : 'bg-white/50'}`} />)}
            </div>
          </>
        )}
        <div className="absolute top-2 right-2 bg-black/50 backdrop-blur-sm rounded-full px-2 py-1 flex items-center gap-1">
          <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
          <span className="text-white text-xs font-semibold">{post.rating}.0</span>
        </div>
      </div>

      <div className="px-4 pt-3 pb-1">
        <div className="flex items-center gap-3">
          <button onClick={toggleLike} disabled={liking} className="flex items-center gap-1.5 group disabled:opacity-70">
            <Heart className={`w-6 h-6 transition-all ${liked ? 'fill-red-500 text-red-500 scale-110' : 'text-gray-700 group-hover:text-red-400'}`} />
            <span className="text-sm font-medium">{likesCount}</span>
          </button>
          <button onClick={() => setShowComments(!showComments)} className="flex items-center gap-1.5 group">
            <MessageCircle className="w-6 h-6 text-gray-700 group-hover:text-blue-400" />
            <span className="text-sm font-medium">{commentsCount}</span>
          </button>
        </div>
        {post.caption && (
          <p className="text-sm mt-2 leading-relaxed">
            <span className="font-semibold mr-1">{post.userDisplayName}</span>
            {highlightHashtags(post.caption)}
          </p>
        )}
        <p className="text-xs text-gray-400 mt-1">
          {formatDistanceToNow(post.createdAt, { addSuffix: true, locale: ja })}
        </p>
      </div>

      {showComments && (
        <div className="px-4 pb-3 border-t mt-2 pt-3">
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {comments.map((c) => (
              <div key={c.id} className="flex gap-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-orange-300 to-rose-400 flex items-center justify-center shrink-0 overflow-hidden">
                  {c.userPhotoURL ? <img src={c.userPhotoURL} alt="" className="w-full h-full object-cover" /> : <span className="text-white text-xs">{(c.userDisplayName || 'U')[0]}</span>}
                </div>
                <div className="bg-gray-50 rounded-xl px-3 py-1.5 flex-1">
                  <span className="font-semibold text-xs">{c.userDisplayName} </span>
                  <span className="text-xs text-gray-700">{c.text}</span>
                </div>
              </div>
            ))}
            {comments.length === 0 && <p className="text-xs text-gray-400 text-center py-2">最初のコメントを書いてみよう</p>}
          </div>
          <form onSubmit={submitComment} className="flex gap-2 mt-3">
            <input type="text" value={commentText} onChange={(e) => setCommentText(e.target.value)}
              placeholder="コメントを追加..." className="flex-1 text-sm px-3 py-2 bg-gray-50 rounded-full focus:outline-none focus:ring-2 focus:ring-orange-300" />
            <button type="submit" disabled={!commentText.trim()} className="text-orange-500 disabled:text-gray-300">
              <Send className="w-5 h-5" />
            </button>
          </form>
        </div>
      )}
    </article>
  )
}
