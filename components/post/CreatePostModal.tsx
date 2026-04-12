'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { X, ImagePlus, MapPin, Star } from 'lucide-react'
import type { FoodGenre, PriceRange } from '@/types'
import dynamic from 'next/dynamic'
import { GENRE_META } from '@/lib/genreMeta'
import { supabase } from '@/lib/supabase'
import { useAuthContext } from '@/components/auth/AuthProvider'

const LocationPicker = dynamic(() => import('./LocationPicker'), { ssr: false })

const GENRES: FoodGenre[] = ['和食', '洋食', 'イタリアン', 'フレンチ', '中華', '韓国料理', 'アジア料理', 'カフェ', 'ラーメン', '寿司', '焼肉', 'スイーツ', 'その他']
const PRICE_RANGES: PriceRange[] = ['〜¥1,000', '¥1,001〜¥3,000', '¥3,001〜¥5,000', '¥5,001〜¥10,000', '¥10,001〜']

interface CreatePostModalProps {
  onClose: () => void
  onSuccess?: () => void
}

type Step = 'images' | 'details' | 'location'

export default function CreatePostModal({ onClose, onSuccess }: CreatePostModalProps) {
  const { user } = useAuthContext()
  const router = useRouter()
  const [step, setStep] = useState<Step>('images')
  const [images, setImages] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [caption, setCaption] = useState('')
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [genre, setGenre] = useState<FoodGenre>('その他')
  const [priceRange, setPriceRange] = useState<PriceRange>('¥1,001〜¥3,000')
  const [locationName, setLocationName] = useState('')
  const [locationCoords, setLocationCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadStep, setUploadStep] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, 5)
    setImages(files)
    setPreviews(files.map((f) => URL.createObjectURL(f)))
  }

  const extractHashtags = (text: string) =>
    (text.match(/#[\w\u3040-\u9FFF]+/g) ?? []).map((t) => t.slice(1))

  const withTimeout = <T,>(promise: PromiseLike<T>, ms: number): Promise<T> => {
    return Promise.race([
      Promise.resolve(promise),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`タイムアウト (${ms / 1000}秒)`)), ms)),
    ])
  }

  const handleSubmit = useCallback(async () => {
    if (!user) { setError('ログインが必要です'); return }
    if (!locationCoords) { setError('場所を地図で指定してください'); return }
    if (images.length === 0) { setError('写真を選択してください'); return }
    setUploading(true)
    setError('')
    setUploadStep('投稿を作成中...')
    try {
      // 1. 投稿レコードを作成
      const { data: post, error: postError } = await withTimeout(
        supabase.from('posts').insert({
          user_id: user.id,
          caption,
          rating,
          genre,
          price_range: priceRange,
          location_name: locationName,
          location_lat: locationCoords.lat,
          location_lng: locationCoords.lng,
          hashtags: extractHashtags(caption),
        }).select().single(),
        15000
      )

      if (postError || !post) throw postError ?? new Error('投稿レコードの作成に失敗しました')

      // 2. 画像を Storage にアップロードして post_images に保存
      for (let i = 0; i < images.length; i++) {
        setUploadStep(`画像をアップロード中... (${i + 1}/${images.length})`)
        const file = images[i]
        const path = `${user.id}/${post.id}/${i}_${Date.now()}`
        const { data: uploaded, error: uploadError } = await withTimeout(
          supabase.storage.from('post-images').upload(path, file, { upsert: true }),
          30000
        )
        if (uploadError) throw uploadError
        const { data: { publicUrl } } = supabase.storage.from('post-images').getPublicUrl(uploaded.path)
        await withTimeout(
          supabase.from('post_images').insert({ post_id: post.id, url: publicUrl, position: i }),
          10000
        )
      }

      // 3. プロフィールの投稿数を更新
      setUploadStep('仕上げ中...')
      const { data: profile } = await supabase.from('profiles').select('posts_count').eq('id', user.id).single()
      await supabase.from('profiles').update({ posts_count: (profile?.posts_count ?? 0) + 1 }).eq('id', user.id)

      setDone(true)
      setTimeout(() => {
        onClose()
        onSuccess?.()
        router.refresh()
      }, 1200)
    } catch (err) {
      const raw = err as { message?: string; details?: string; hint?: string } | null
      const msg = raw?.message ?? raw?.details ?? JSON.stringify(err)
      setError(msg || '投稿に失敗しました。もう一度お試しください。')
    } finally {
      setUploading(false)
      setUploadStep('')
    }
  }, [user, locationCoords, images, caption, rating, genre, priceRange, locationName, onSuccess, onClose])

  const steps: Step[] = ['images', 'details', 'location']

  if (done) {
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl p-8 text-center">
          <div className="text-5xl mb-3">🎉</div>
          <p className="font-bold text-lg">投稿しました！</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <button onClick={onClose} disabled={uploading} className="p-1 hover:bg-gray-100 rounded-full disabled:opacity-30"><X className="w-5 h-5" /></button>
          <h2 className="font-semibold text-sm">
            {step === 'images' ? '写真を選択' : step === 'details' ? '詳細を入力' : '場所を設定'}
          </h2>
          <div className="flex gap-1">
            {steps.map((s, i) => (
              <div key={s} className={`w-2 h-2 rounded-full transition-colors ${step === s ? 'bg-orange-500' : i < steps.indexOf(step) ? 'bg-orange-300' : 'bg-gray-200'}`} />
            ))}
          </div>
        </div>

        <div className="overflow-y-auto flex-1">
          {step === 'images' && (
            <div className="p-4">
              <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImages} className="hidden" />
              {previews.length === 0 ? (
                <button onClick={() => fileInputRef.current?.click()}
                  className="w-full aspect-square rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center gap-3 hover:border-orange-300 hover:bg-orange-50 transition-colors">
                  <ImagePlus className="w-12 h-12 text-gray-300" />
                  <p className="text-sm text-gray-500">タップして写真を選択</p>
                  <p className="text-xs text-gray-500">最大5枚まで</p>
                </button>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {previews.map((p, i) => (
                    <div key={i} className="relative aspect-square">
                      <img src={p} alt="" className="w-full h-full object-cover rounded-xl" />
                      <button onClick={() => { setImages(images.filter((_, j) => j !== i)); setPreviews(previews.filter((_, j) => j !== i)) }}
                        className="absolute top-1 right-1 w-5 h-5 bg-black/50 rounded-full flex items-center justify-center">
                        <X className="w-3 h-3 text-white" />
                      </button>
                    </div>
                  ))}
                  {previews.length < 5 && (
                    <button onClick={() => fileInputRef.current?.click()} className="aspect-square rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center hover:border-orange-300">
                      <ImagePlus className="w-6 h-6 text-gray-300" />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 'details' && (
            <div className="p-4 space-y-4">
              {previews[0] && <img src={previews[0]} alt="" className="w-full aspect-video object-cover rounded-xl" />}

              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">評価</label>
                <div className="flex gap-1 mt-2 items-center">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <button key={s} onMouseEnter={() => setHoverRating(s)} onMouseLeave={() => setHoverRating(0)} onClick={() => setRating(s)} className="transition-transform hover:scale-110">
                      <Star className={`w-7 h-7 ${s <= (hoverRating || rating) ? 'fill-orange-400 text-orange-400' : 'text-gray-200'}`} />
                    </button>
                  ))}
                  <span className="ml-2 text-sm text-gray-500">{rating > 0 ? `${rating}.0` : '未評価'}</span>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">ジャンル</label>
                <div className="grid grid-cols-4 gap-2 mt-2">
                  {GENRES.map((g) => {
                    const meta = GENRE_META[g]
                    const isSelected = genre === g
                    return (
                      <button key={g} type="button" onClick={() => setGenre(g)}
                        className="flex flex-col items-center gap-1 py-2.5 rounded-xl border-2 transition-all"
                        style={isSelected ? { background: meta.bg, borderColor: meta.border } : { background: '#f9fafb', borderColor: '#e5e7eb' }}>
                        <span className="text-2xl">{meta.emoji}</span>
                        <span className="text-xs font-medium" style={{ color: isSelected ? meta.border : '#6b7280' }}>{g}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">値段帯</label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {PRICE_RANGES.map((p) => (
                    <button key={p} onClick={() => setPriceRange(p)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${priceRange === p ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">キャプション</label>
                <textarea value={caption} onChange={(e) => setCaption(e.target.value)}
                  placeholder="お店の感想や思い出を書いてみよう... #ランチ #東京" rows={4}
                  className="w-full mt-2 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 resize-none" />
              </div>
            </div>
          )}

          {step === 'location' && (
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2 bg-orange-50 rounded-xl px-3 py-2.5">
                <MapPin className="w-5 h-5 text-orange-500 shrink-0" />
                <input type="text" placeholder="お店の名前を入力" value={locationName} onChange={(e) => setLocationName(e.target.value)} className="flex-1 bg-transparent text-sm focus:outline-none" />
              </div>
              <p className="text-xs text-gray-500 text-center">地図をクリックして場所をピンで指定</p>
              <div className="h-72 rounded-2xl overflow-hidden border border-gray-200">
                <LocationPicker value={locationCoords} onChange={setLocationCoords} />
              </div>
              {locationCoords && <p className="text-xs text-center text-green-600">✓ 位置が設定されました</p>}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t">
          {error && (
            <div className="mb-3 bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
              <span className="text-red-500 text-sm shrink-0">⚠️</span>
              <div className="flex-1">
                <p className="text-red-600 text-xs leading-relaxed">{error}</p>
              </div>
              <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 shrink-0 text-xs underline">閉じる</button>
            </div>
          )}
          {step === 'images' && (
            <button onClick={() => setStep('details')} disabled={images.length === 0}
              className="w-full py-3 bg-gradient-to-r from-orange-400 to-rose-500 text-white font-semibold rounded-xl disabled:opacity-40 hover:opacity-90">次へ</button>
          )}
          {step === 'details' && (
            <div className="flex gap-2">
              <button onClick={() => setStep('images')} className="flex-1 py-3 border border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50">戻る</button>
              <button onClick={() => setStep('location')} disabled={rating === 0}
                className="flex-1 py-3 bg-gradient-to-r from-orange-400 to-rose-500 text-white font-semibold rounded-xl disabled:opacity-40 hover:opacity-90">次へ</button>
            </div>
          )}
          {step === 'location' && (
            <div className="flex gap-2">
              <button onClick={() => setStep('details')} className="flex-1 py-3 border border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50">戻る</button>
              <button onClick={handleSubmit} disabled={!locationCoords || !locationName.trim() || uploading}
                className="flex-1 py-3 bg-gradient-to-r from-orange-400 to-rose-500 text-white font-semibold rounded-xl disabled:opacity-40 hover:opacity-90 flex flex-col items-center justify-center gap-0.5 min-h-[48px]">
                {uploading ? (
                  <>
                    <span className="text-sm">投稿中...</span>
                    {uploadStep && <span className="text-[10px] opacity-80">{uploadStep}</span>}
                  </>
                ) : '投稿する'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
