'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Map, PlusSquare, Search, User } from 'lucide-react'
import { useState } from 'react'
import dynamic from 'next/dynamic'

const CreatePostModal = dynamic(() => import('@/components/post/CreatePostModal'), { ssr: false })

export default function BottomNav() {
  const pathname = usePathname()
  const [showCreate, setShowCreate] = useState(false)

  const links = [
    { href: '/', icon: Home, label: 'ホーム' },
    { href: '/map', icon: Map, label: '地図' },
    { href: '/search', icon: Search, label: '検索' },
    { href: '/profile', icon: User, label: 'プロフィール' },
  ]

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-40 safe-area-bottom">
        <div className="flex items-center justify-around max-w-lg mx-auto">
          {links.slice(0, 2).map(({ href, icon: Icon, label }) => (
            <Link key={href} href={href} className={`flex flex-col items-center py-3 px-4 ${pathname === href ? 'text-orange-500' : 'text-gray-600'}`}>
              <Icon className="w-6 h-6" strokeWidth={pathname === href ? 2.5 : 1.8} />
              <span className="text-xs mt-0.5 font-medium">{label}</span>
            </Link>
          ))}

          {/* Post button */}
          <button
            onClick={() => setShowCreate(true)}
            className="flex flex-col items-center py-2 px-4"
          >
            <div className="w-12 h-12 bg-gradient-to-br from-orange-400 to-rose-500 rounded-2xl flex items-center justify-center shadow-lg shadow-orange-200">
              <PlusSquare className="w-6 h-6 text-white" strokeWidth={2} />
            </div>
          </button>

          {links.slice(2).map(({ href, icon: Icon, label }) => (
            <Link key={href} href={href} className={`flex flex-col items-center py-3 px-4 ${pathname === href ? 'text-orange-500' : 'text-gray-600'}`}>
              <Icon className="w-6 h-6" strokeWidth={pathname === href ? 2.5 : 1.8} />
              <span className="text-xs mt-0.5 font-medium">{label}</span>
            </Link>
          ))}
        </div>
      </nav>

      {showCreate && <CreatePostModal onClose={() => setShowCreate(false)} />}
    </>
  )
}
