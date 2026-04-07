'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthContext } from '@/components/auth/AuthProvider'
import { MapPin, Grid, Star, UserPlus, UserCheck, MessageCircle, LogOut, Pencil, X, Camera } from 'lucide-react'
import type { Post } from '@/types'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'

const MapView = dynamic(() => import('@/components/map/MapView'), { ssr: false })

interface Profile { id: string; display_name: string; photo_url: string | null; bio: string; followers_count: number; following_count: number; posts_count: number }

interface UserProfileViewProps { uid: string; isOwnProfile: boolean }

export default function UserProfileView({ uid, isOwnProfile }: UserProfileViewProps) {
  const { user, logOut } = useAuthContext()
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [isFollowing, setIsFollowing] = useState(false)
  const [view, setView] = useState<'grid' | 'map'>('grid')
  const [loading, setLoading] = useState(true)
  const [showEditModal, setShowEditModal] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const [{ data: p }, { data: raw }] = await Promise.all([
          supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
          supabase.from('posts').select('*, profiles!posts_user_id_fkey(display_name, photo_url), post_images(url, position)').eq('user_id', uid).order('created_at', { ascending: false }),
        ])
        let resolvedProfile = p
        // プロフィールが存在しない場合、自分のプロフィールなら自動作成する
        if (!resolvedProfile && isOwnProfile && user) {
          const displayName = user.user_metadata?.display_name ?? user.email?.split('@')[0] ?? 'ユーザー'
          const { data: created } = await supabase.from('profiles').upsert({
            id: uid,
            display_name: displayName,
            bio: '',
            photo_url: user.user_metadata?.avatar_url ?? null,
            followers_count: 0,
            following_count: 0,
            posts_count: 0,
          }, { onConflict: 'id' }).select().single()
          resolvedProfile = created
        }
        if (resolvedProfile) setProfile(resolvedProfile)
        if (raw) setPosts(raw.map(toPost))
        if (user && !isOwnProfile) {
          const { data: f } = await supabase.from('follows').select('follower_id').eq('follower_id', user.id).eq('following_id', uid).maybeSingle()
          setIsFollowing(!!f)
        }
      } catch (e) {
        console.error('プロフィールデータの取得に失敗しました', e)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [uid, user?.id, isOwnProfile])

  const toggleFollow = async () => {
    if (!user || !profile) return
    if (isFollowing) {
      await supabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', uid)
      await supabase.from('profiles').update({ followers_count: profile.followers_count - 1 }).eq('id', uid)
      await supabase.from('profiles').update({ following_count: (await supabase.from('profiles').select('following_count').eq('id', user.id).single()).data?.following_count - 1 }).eq('id', user.id)
      setProfile((p) => p ? { ...p, followers_count: p.followers_count - 1 } : p)
    } else {
      await supabase.from('follows').insert({ follower_id: user.id, following_id: uid })
      await supabase.from('profiles').update({ followers_count: profile.followers_count + 1 }).eq('id', uid)
      await supabase.from('profiles').update({ following_count: (await supabase.from('profiles').select('following_count').eq('id', user.id).single()).data?.following_count + 1 }).eq('id', user.id)
      setProfile((p) => p ? { ...p, followers_count: p.followers_count + 1 } : p)
    }
    setIsFollowing(!isFollowing)
  }

  const startDM = async () => {
    if (!user || !profile) return
    const ids = [user.id, uid].sort()
    const { data: existing } = await supabase.from('chat_participants').select('chat_id').eq('user_id', ids[0])
    const chatIds = existing?.map((r) => r.chat_id) ?? []
    let chatId: string | null = null
    if (chatIds.length > 0) {
      const { data: match } = await supabase.from('chat_participants').select('chat_id').eq('user_id', ids[1]).in('chat_id', chatIds)
      chatId = match?.[0]?.chat_id ?? null
    }
    if (!chatId) {
      const { data: chat } = await supabase.from('chats').insert({ last_message: '' }).select().single()
      chatId = chat?.id ?? null
      if (chatId) {
        await supabase.from('chat_participants').insert([{ chat_id: chatId, user_id: user.id }, { chat_id: chatId, user_id: uid }])
      }
    }
    if (chatId) router.push(`/dm/${chatId}`)
  }

  if (loading) return (
    <div className="pt-14 animate-pulse px-4 py-5">
      <div className="flex gap-4">
        <div className="w-20 h-20 rounded-full bg-gray-200" />
        <div className="flex-1 space-y-2 pt-2">
          <div className="h-4 w-32 bg-gray-200 rounded" />
          <div className="h-3 w-48 bg-gray-200 rounded" />
        </div>
      </div>
    </div>
  )

  if (!profile) return <div className="flex items-center justify-center h-screen text-gray-500">ユーザーが見つかりません</div>

  return (
    <div className="flex flex-col h-screen">
      <div className="bg-gradient-to-br from-orange-400 to-rose-500 pt-14 pb-6 px-4 flex-shrink-0">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-20 h-20 rounded-full overflow-hidden border-4 border-white shadow-lg">
                {profile.photo_url
                  ? <img src={profile.photo_url} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full bg-white/20 flex items-center justify-center"><span className="text-white text-2xl font-bold">{profile.display_name[0]}</span></div>}
              </div>
            </div>
            <div className="text-white">
              <h1 className="text-xl font-bold">{profile.display_name}</h1>
              {profile.bio && <p className="text-sm text-white/80 mt-0.5 max-w-[200px]">{profile.bio}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isOwnProfile && (
              <button onClick={() => setShowEditModal(true)} className="text-white/80 p-1.5 hover:bg-white/20 rounded-full">
                <Pencil className="w-5 h-5" />
              </button>
            )}
            {isOwnProfile && (
              <button onClick={logOut} className="text-white/80 p-1.5 hover:bg-white/20 rounded-full">
                <LogOut className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
        <div className="flex gap-6 mt-4">
          {[{ label: '投稿', value: posts.length }, { label: 'フォロワー', value: profile.followers_count }, { label: 'フォロー中', value: profile.following_count }].map(({ label, value }) => (
            <div key={label} className="text-center">
              <p className="text-xl font-bold text-white">{value}</p>
              <p className="text-xs text-white/80">{label}</p>
            </div>
          ))}
        </div>
        {!isOwnProfile && (
          <div className="flex gap-2 mt-4">
            <button onClick={toggleFollow}
              className={`flex-1 py-2 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 ${isFollowing ? 'bg-white/20 text-white border border-white/30' : 'bg-white text-orange-500'}`}>
              {isFollowing ? <><UserCheck className="w-4 h-4" />フォロー中</> : <><UserPlus className="w-4 h-4" />フォローする</>}
            </button>
            <button onClick={startDM}
              className="flex-1 py-2 bg-white/20 border border-white/30 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5">
              <MessageCircle className="w-4 h-4" />メッセージ
            </button>
          </div>
        )}
      </div>

      <div className="flex border-b border-gray-200 bg-white flex-shrink-0">
        {[{ id: 'grid', label: 'グリッド', icon: Grid }, { id: 'map', label: '地図', icon: MapPin }].map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setView(id as 'grid' | 'map')}
            className={`flex-1 py-3 flex items-center justify-center gap-1.5 text-sm font-medium ${view === id ? 'text-orange-500 border-b-2 border-orange-500' : 'text-gray-600'}`}>
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto pb-24">
        {view === 'grid' && (
          posts.length === 0
            ? <div className="flex flex-col items-center justify-center py-16 text-center"><span className="text-5xl mb-3">📷</span><p className="text-gray-600 text-sm">{isOwnProfile ? '最初の投稿をしてみよう！' : 'まだ投稿がありません'}</p></div>
            : <div className="grid grid-cols-3 gap-0.5">
              {posts.map((post) => (
                <div key={post.id} className="relative aspect-square bg-gray-100 group cursor-pointer">
                  {post.imageURLs[0] && <img src={post.imageURLs[0]} alt="" className="w-full h-full object-cover" />}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                    <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
                      <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                      <span className="text-white text-sm font-bold">{post.rating}.0</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
        )}
        {view === 'map' && <div className="h-full"><MapView posts={posts} /></div>}
      </div>

      {showEditModal && profile && (
        <EditProfileModal
          profile={profile}
          onClose={() => setShowEditModal(false)}
          onSaved={(updated) => { setProfile(updated); setShowEditModal(false) }}
        />
      )}
    </div>
  )
}

// ─── プロフィール編集モーダル ───────────────────────────────
function EditProfileModal({ profile, onClose, onSaved }: {
  profile: Profile
  onClose: () => void
  onSaved: (p: Profile) => void
}) {
  const { user } = useAuthContext()
  const [displayName, setDisplayName] = useState(profile.display_name)
  const [bio, setBio] = useState(profile.bio ?? '')
  const [photoPreview, setPhotoPreview] = useState<string | null>(profile.photo_url)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  const handleSave = async () => {
    if (!user) return
    if (!displayName.trim()) { setError('ユーザー名を入力してください'); return }
    setSaving(true)
    setError('')
    try {
      let photoUrl = profile.photo_url
      if (photoFile) {
        const path = `${user.id}/avatar_${Date.now()}`
        const { data: uploaded, error: uploadErr } = await supabase.storage
          .from('avatars').upload(path, photoFile, { upsert: true })
        if (uploadErr) throw uploadErr
        photoUrl = supabase.storage.from('avatars').getPublicUrl(uploaded.path).data.publicUrl
      }
      const { error: updateErr } = await supabase.from('profiles').update({
        display_name: displayName.trim(),
        bio: bio.trim(),
        photo_url: photoUrl,
      }).eq('id', user.id)
      if (updateErr) throw updateErr
      onSaved({ ...profile, display_name: displayName.trim(), bio: bio.trim(), photo_url: photoUrl })
    } catch (err) {
      setError((err as { message?: string })?.message ?? '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-full">
          <X className="w-5 h-5 text-gray-600" />
        </button>
        <h2 className="font-semibold text-sm">プロフィールを編集</h2>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 bg-gradient-to-r from-orange-400 to-rose-500 text-white text-sm font-semibold rounded-full disabled:opacity-40"
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>

      {/* スクロール可能なコンテンツ */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto p-6 space-y-6">

          {/* アバター */}
          <div className="flex justify-center pt-2">
            <div className="relative">
              <div className="w-28 h-28 rounded-full overflow-hidden bg-gradient-to-br from-orange-300 to-rose-400 border-4 border-gray-100 shadow-lg">
                {photoPreview
                  ? <img src={photoPreview} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center">
                      <span className="text-white text-3xl font-bold">{displayName[0] ?? '?'}</span>
                    </div>}
              </div>
              <button
                onClick={() => fileRef.current?.click()}
                className="absolute bottom-1 right-1 w-9 h-9 bg-orange-500 rounded-full flex items-center justify-center shadow-lg border-2 border-white"
              >
                <Camera className="w-4 h-4 text-white" />
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
            </div>
          </div>
          <p className="text-center text-xs text-orange-500 -mt-2 cursor-pointer" onClick={() => fileRef.current?.click()}>
            写真を変更
          </p>

          {/* ユーザー名 */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">ユーザー名</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="ユーザー名を入力"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
            />
          </div>

          {/* 自己紹介 */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">自己紹介</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={4}
              placeholder="食の好みや行きつけのお店など..."
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 resize-none"
            />
            <p className="text-xs text-gray-500 mt-1 text-right">{bio.length} 文字</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3">
              <p className="text-red-600 text-sm text-center">{error}</p>
            </div>
          )}

          {/* 保存ボタン（下部にも配置） */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3.5 bg-gradient-to-r from-orange-400 to-rose-500 text-white font-semibold rounded-xl disabled:opacity-40 text-sm"
          >
            {saving ? '保存中...' : 'プロフィールを保存する'}
          </button>
        </div>
      </div>
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
