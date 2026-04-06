'use client'

export const dynamic = 'force-dynamic'

import { useAuthContext } from '@/components/auth/AuthProvider'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import UserProfileView from '@/components/profile/UserProfileView'
import BottomNav from '@/components/layout/BottomNav'

export default function ProfilePage() {
  const { user, loading } = useAuthContext()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) router.push('/')
  }, [loading, user, router])

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-rose-50">
        <div className="text-center">
          <span className="text-5xl">🍜</span>
          <p className="text-gray-500 mt-3 text-sm">読み込み中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <UserProfileView uid={user.id} isOwnProfile />
      <BottomNav />
    </div>
  )
}
