'use client'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Suspense } from 'react'

function AuthErrorContent() {
  const searchParams = useSearchParams()
  const message = searchParams.get('message') ?? '認証中にエラーが発生しました'

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <div className="max-w-md w-full rounded-lg border border-red-200 bg-red-50 p-6 text-center">
        <h1 className="mb-2 text-xl font-semibold text-red-700">認証エラー</h1>
        <p className="text-sm text-red-600">{message}</p>
      </div>
      <Link href="/" className="text-sm text-blue-600 underline hover:text-blue-800">
        トップページに戻る
      </Link>
    </div>
  )
}

export default function AuthErrorPage() {
  return (
    <Suspense>
      <AuthErrorContent />
    </Suspense>
  )
}
