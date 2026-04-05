'use client'

export const dynamic = 'force-dynamic'

import { useAuthContext } from '@/components/auth/AuthProvider'
import UserProfileView from '@/components/profile/UserProfileView'
import BottomNav from '@/components/layout/BottomNav'
import { useParams } from 'next/navigation'

export default function UserProfilePage() {
  const { user } = useAuthContext()
  const params = useParams()
  const uid = params.uid as string

  return (
    <div className="min-h-screen bg-gray-50">
      <UserProfileView uid={uid} isOwnProfile={user?.id === uid} />
      <BottomNav />
    </div>
  )
}
