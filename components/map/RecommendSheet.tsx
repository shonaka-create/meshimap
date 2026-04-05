'use client'

import { useMemo, useState } from 'react'
import { Star, X, Sparkles } from 'lucide-react'
import type { Post } from '@/types'
import { GENRE_META } from '@/lib/genreMeta'

interface RecommendSheetProps {
  posts: Post[]          // フォロー中全投稿（自分含む）
  myUserId: string
  likedPostIds: string[]
  onClose: () => void
  onSelectSpot: (post: Post) => void
}

export default function RecommendSheet({
  posts,
  myUserId,
  likedPostIds,
  onClose,
  onSelectSpot,
}: RecommendSheetProps) {
  const [unvisitedOnly, setUnvisitedOnly] = useState(true)

  const { recommendations, tasteLabel } = useMemo(() => {
    const myPosts = posts.filter((p) => p.userId === myUserId)
    const followingPosts = posts.filter((p) => p.userId !== myUserId)
    const visitedNames = new Set(myPosts.map((p) => p.location.name))
    const likedPosts = posts.filter((p) => likedPostIds.includes(p.id))

    // 好みプロファイル：自分の投稿 × 2、いいね × 1 で重み付け
    const genreCount: Record<string, number> = {}
    const priceCount: Record<string, number> = {}

    for (const p of myPosts) {
      genreCount[p.genre] = (genreCount[p.genre] ?? 0) + 2
      priceCount[p.priceRange] = (priceCount[p.priceRange] ?? 0) + 2
    }
    for (const p of likedPosts) {
      genreCount[p.genre] = (genreCount[p.genre] ?? 0) + 1
      priceCount[p.priceRange] = (priceCount[p.priceRange] ?? 0) + 1
    }

    const topGenres = Object.entries(genreCount).sort((a, b) => b[1] - a[1]).map((e) => e[0])
    const topPrices = Object.entries(priceCount).sort((a, b) => b[1] - a[1]).map((e) => e[0])

    // ロケーション単位でスコアリング・重複排除
    const locationMap = new Map<string, { post: Post; score: number; visitors: string[] }>()

    for (const p of followingPosts) {
      const key = p.location.name
      let score = p.rating

      const genreRank = topGenres.indexOf(p.genre)
      if (genreRank === 0) score += 3
      else if (genreRank === 1) score += 2
      else if (genreRank >= 0) score += 1

      const priceRank = topPrices.indexOf(p.priceRange)
      if (priceRank === 0) score += 2
      else if (priceRank === 1) score += 1

      if (!locationMap.has(key)) {
        locationMap.set(key, { post: p, score, visitors: [p.userDisplayName] })
      } else {
        const existing = locationMap.get(key)!
        // 複数人が訪問している店はボーナス
        existing.score = Math.max(existing.score, score) + 0.5
        if (!existing.visitors.includes(p.userDisplayName)) {
          existing.visitors.push(p.userDisplayName)
        }
      }
    }

    let results = Array.from(locationMap.values()).sort((a, b) => b.score - a.score)

    if (unvisitedOnly) {
      results = results.filter((r) => !visitedNames.has(r.post.location.name))
    }

    const tasteLabel =
      topGenres[0]
        ? `${GENRE_META[topGenres[0]]?.emoji ?? ''} ${topGenres[0]}${
            topGenres[1] ? ` · ${GENRE_META[topGenres[1]]?.emoji ?? ''} ${topGenres[1]}` : ''
          } 好き`
        : null

    return { recommendations: results.slice(0, 20), tasteLabel }
  }, [posts, myUserId, likedPostIds, unvisitedOnly])

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl shadow-2xl max-h-[75vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="px-4 pt-4 pb-3 border-b border-gray-100">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-orange-400" />
              <h2 className="font-bold text-base">今日のおすすめ</h2>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-full bg-gray-100">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>

          {tasteLabel ? (
            <p className="text-xs text-gray-500">
              あなたの好み:{' '}
              <span className="text-orange-600 font-medium">{tasteLabel}</span> をもとにピックアップ
            </p>
          ) : (
            <p className="text-xs text-gray-400">投稿やいいねをもとにおすすめをピックアップします</p>
          )}

          <button
            onClick={() => setUnvisitedOnly((v) => !v)}
            className={`mt-2 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-all ${
              unvisitedOnly
                ? 'bg-orange-50 border-orange-300 text-orange-600 font-medium'
                : 'bg-gray-100 border-gray-200 text-gray-500'
            }`}
          >
            {unvisitedOnly && <span>✓</span>}
            まだ行ったことない店のみ
          </button>
        </div>

        {/* リスト */}
        <div className="overflow-y-auto flex-1 divide-y divide-gray-50">
          {recommendations.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p className="text-4xl mb-2">🍽️</p>
              <p className="text-sm">おすすめが見つかりませんでした</p>
              <p className="text-xs mt-1">フォローを増やすと精度が上がります</p>
            </div>
          ) : (
            recommendations.map(({ post, visitors }, i) => {
              const meta = GENRE_META[post.genre] ?? GENRE_META['その他']
              return (
                <button
                  key={`${post.id}-${i}`}
                  onClick={() => onSelectSpot(post)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-orange-50 active:bg-orange-100 transition-colors text-left"
                >
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-xl shrink-0"
                    style={{ background: meta.bg }}
                  >
                    {meta.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{post.location.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span
                        className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                        style={{ background: meta.bg, color: meta.border }}
                      >
                        {post.genre}
                      </span>
                      <span className="text-xs text-gray-400">{post.priceRange}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">
                      {visitors.slice(0, 2).join('・')}
                      {visitors.length > 2 ? ` ほか${visitors.length - 2}人` : ''}
                      {' が訪問'}
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
                    <span className="text-xs font-semibold">{post.rating}.0</span>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
