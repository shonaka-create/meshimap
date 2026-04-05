'use client'

export const dynamic = 'force-dynamic'

import { useAuthContext } from '@/components/auth/AuthProvider'
import { redirect } from 'next/navigation'
import { useEffect } from 'react'
import UserProfileView from '@/components/profile/UserProfileView'
import BottomNav from '@/components/layout/BottomNav'

export default function ProfilePage() {
  const { user, loading } = useAuthContext()

  if (!loading && !user) redirect('/')

  return (
    <div className="min-h-screen bg-gray-50">
      {user && <UserProfileView uid={user.id} isOwnProfile />}
      <BottomNav />
    </div>
  )
}
