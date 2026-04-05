'use client'

import Link from 'next/link'
import { MessageCircle } from 'lucide-react'

interface TopBarProps {
  title?: string
  showDM?: boolean
  back?: boolean
}

export default function TopBar({ title, showDM = false, back = false }: TopBarProps) {
  return (
    <header className="fixed top-0 left-0 right-0 bg-white/80 backdrop-blur-sm border-b border-gray-100 z-40">
      <div className="flex items-center justify-between max-w-lg mx-auto px-4 h-14">
        <div className="flex items-center gap-2">
          {title ? (
            <h1 className="font-bold text-lg">{title}</h1>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="text-xl">🍜</span>
              <span className="font-bold text-xl bg-gradient-to-r from-orange-500 to-rose-500 bg-clip-text text-transparent">
                MeshiMap
              </span>
            </div>
          )}
        </div>
        {showDM && (
          <Link href="/dm" className="relative p-2 hover:bg-gray-100 rounded-full">
            <MessageCircle className="w-6 h-6 text-gray-700" />
          </Link>
        )}
      </div>
    </header>
  )
}
