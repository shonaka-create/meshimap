'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useRef } from 'react'
import { useAuthContext } from '@/components/auth/AuthProvider'
import { supabase } from '@/lib/supabase'
import { ArrowLeft, Send } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { ja } from 'date-fns/locale'

interface Msg { id: string; sender_id: string; text: string; created_at: string; display_name: string; photo_url: string | null }
interface OtherUser { uid: string; display_name: string; photo_url: string | null }

export default function ChatPage() {
  const { user } = useAuthContext()
  const params = useParams()
  const router = useRouter()
  const chatId = params.chatId as string
  const [messages, setMessages] = useState<Msg[]>([])
  const [other, setOther] = useState<OtherUser | null>(null)
  const [text, setText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!user) return
    // 相手ユーザー情報
    supabase.from('chat_participants')
      .select('user_id, profiles!chat_participants_user_id_fkey(display_name, photo_url)')
      .eq('chat_id', chatId).neq('user_id', user.id).single()
      .then(({ data }) => {
        if (data) {
          const p = (Array.isArray(data.profiles) ? data.profiles[0] : data.profiles) as { display_name: string; photo_url: string | null } | null
          setOther({ uid: data.user_id, display_name: p?.display_name ?? '名無し', photo_url: p?.photo_url ?? null })
        }
      })

    // メッセージ取得
    const fetchMessages = async () => {
      const { data } = await supabase.from('messages')
        .select('*, profiles!messages_sender_id_fkey(display_name, photo_url)')
        .eq('chat_id', chatId).order('created_at', { ascending: true })
      if (data) setMessages(data.map((m) => ({
        id: m.id, sender_id: m.sender_id, text: m.text, created_at: m.created_at,
        display_name: (m.profiles as { display_name: string })?.display_name ?? '名無し',
        photo_url: (m.profiles as { photo_url: string | null })?.photo_url ?? null,
      })))
      setTimeout(() => bottomRef.current?.scrollIntoView(), 100)
    }
    fetchMessages()

    // リアルタイム購読
    const channel = supabase.channel(`chat-${chatId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
        async (payload) => {
          const { data } = await supabase.from('profiles').select('display_name, photo_url').eq('id', payload.new.sender_id).single()
          setMessages((prev) => [...prev, {
            id: payload.new.id, sender_id: payload.new.sender_id, text: payload.new.text, created_at: payload.new.created_at,
            display_name: data?.display_name ?? '名無し', photo_url: data?.photo_url ?? null,
          }])
          setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
        })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user, chatId])

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user || !text.trim()) return
    const msg = text.trim()
    setText('')
    await supabase.from('messages').insert({ chat_id: chatId, sender_id: user.id, text: msg })
    await supabase.from('chats').update({ last_message: msg, last_message_at: new Date().toISOString() }).eq('id', chatId)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="fixed top-0 left-0 right-0 bg-white border-b border-gray-100 z-40">
        <div className="flex items-center gap-3 px-4 h-14 max-w-lg mx-auto">
          <button onClick={() => router.back()} className="p-1 hover:bg-gray-100 rounded-full"><ArrowLeft className="w-5 h-5" /></button>
          {other && (
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full overflow-hidden bg-gradient-to-br from-orange-300 to-rose-400">
                {other.photo_url ? <img src={other.photo_url} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center"><span className="text-white text-sm font-semibold">{other.display_name[0]}</span></div>}
              </div>
              <p className="font-semibold text-sm">{other.display_name}</p>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 pt-14 pb-20 overflow-y-auto max-w-lg mx-auto w-full">
        <div className="p-4 space-y-3">
          {messages.map((msg) => {
            const isMe = msg.sender_id === user?.id
            return (
              <div key={msg.id} className={`flex gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                {!isMe && (
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-gradient-to-br from-orange-300 to-rose-400 shrink-0 self-end">
                    {msg.photo_url ? <img src={msg.photo_url} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center"><span className="text-white text-xs">{msg.display_name[0]}</span></div>}
                  </div>
                )}
                <div className={`max-w-[70%] flex flex-col gap-1 ${isMe ? 'items-end' : 'items-start'}`}>
                  <div className={`px-4 py-2.5 rounded-2xl text-sm ${isMe ? 'bg-gradient-to-r from-orange-400 to-rose-500 text-white rounded-br-sm' : 'bg-white text-gray-800 rounded-bl-sm shadow-sm'}`}>
                    {msg.text}
                  </div>
                  <p className="text-xs text-gray-400 px-1">
                    {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true, locale: ja })}
                  </p>
                </div>
              </div>
            )
          })}
          {messages.length === 0 && <p className="text-center text-gray-400 text-sm py-8">メッセージを送ってみよう 👋</p>}
          <div ref={bottomRef} />
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-4 py-3 max-w-lg mx-auto w-full">
        <form onSubmit={sendMessage} className="flex gap-2 items-center">
          <input type="text" value={text} onChange={(e) => setText(e.target.value)}
            placeholder="メッセージを入力..." className="flex-1 px-4 py-2.5 bg-gray-50 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-orange-300" />
          <button type="submit" disabled={!text.trim()} className="w-10 h-10 bg-gradient-to-r from-orange-400 to-rose-500 rounded-full flex items-center justify-center disabled:opacity-40">
            <Send className="w-4 h-4 text-white" />
          </button>
        </form>
      </div>
    </div>
  )
}
