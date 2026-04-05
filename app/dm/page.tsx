'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useAuthContext } from '@/components/auth/AuthProvider'
import TopBar from '@/components/layout/TopBar'
import BottomNav from '@/components/layout/BottomNav'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { ja } from 'date-fns/locale'
import { MessageCircle } from 'lucide-react'

interface ChatRow {
  id: string
  last_message: string
  last_message_at: string
  other: { uid: string; display_name: string; photo_url: string | null }
}

export default function DMListPage() {
  const { user } = useAuthContext()
  const [chats, setChats] = useState<ChatRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    const fetchChats = async () => {
      // 自分が参加しているチャットID一覧
      const { data: myChats } = await supabase
        .from('chat_participants').select('chat_id').eq('user_id', user.id)
      const chatIds = myChats?.map((r) => r.chat_id) ?? []
      if (chatIds.length === 0) { setLoading(false); return }

      const { data: chatRows } = await supabase
        .from('chats').select('*').in('id', chatIds).order('last_message_at', { ascending: false })

      if (!chatRows) { setLoading(false); return }

      // 各チャットの相手ユーザー情報を取得
      const result: ChatRow[] = []
      for (const chat of chatRows) {
        const { data: others } = await supabase
          .from('chat_participants')
          .select('user_id, profiles!chat_participants_user_id_fkey(display_name, photo_url)')
          .eq('chat_id', chat.id)
          .neq('user_id', user.id)
        const other = others?.[0]
        if (other) {
          const p = (Array.isArray(other.profiles) ? other.profiles[0] : other.profiles) as { display_name: string; photo_url: string | null } | null
          result.push({ id: chat.id, last_message: chat.last_message, last_message_at: chat.last_message_at, other: { uid: other.user_id, display_name: p?.display_name ?? '名無し', photo_url: p?.photo_url ?? null } })
        }
      }
      setChats(result)
      setLoading(false)
    }
    fetchChats()
  }, [user])

  return (
    <div className="min-h-screen bg-gray-50">
      <TopBar title="メッセージ" />
      <main className="pt-14 pb-24 max-w-lg mx-auto">
        {loading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 bg-white rounded-2xl p-4 animate-pulse">
                <div className="w-12 h-12 rounded-full bg-gray-200" />
                <div className="flex-1 space-y-2"><div className="h-3 w-24 bg-gray-200 rounded" /><div className="h-2.5 w-40 bg-gray-200 rounded" /></div>
              </div>
            ))}
          </div>
        ) : chats.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-8">
            <MessageCircle className="w-16 h-16 text-gray-200 mb-4" />
            <h2 className="text-lg font-bold text-gray-700">メッセージはまだありません</h2>
            <p className="text-gray-400 text-sm mt-2">フォロワーのプロフィールから<br />メッセージを送ってみよう</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 bg-white">
            {chats.map((chat) => (
              <Link key={chat.id} href={`/dm/${chat.id}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors">
                <div className="w-12 h-12 rounded-full overflow-hidden bg-gradient-to-br from-orange-300 to-rose-400 shrink-0">
                  {chat.other.photo_url
                    ? <img src={chat.other.photo_url} alt="" className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center"><span className="text-white font-semibold">{chat.other.display_name[0]}</span></div>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-sm">{chat.other.display_name}</p>
                    <p className="text-xs text-gray-400">
                      {chat.last_message_at ? formatDistanceToNow(new Date(chat.last_message_at), { addSuffix: true, locale: ja }) : ''}
                    </p>
                  </div>
                  <p className="text-sm text-gray-500 truncate">{chat.last_message || 'メッセージを開始しましょう'}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
      <BottomNav />
    </div>
  )
}
