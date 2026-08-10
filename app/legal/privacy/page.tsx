import type { Metadata } from 'next'
import { LegalPage } from '../LegalPage'
import { PRIVACY } from '../../../mobile/src/legal/content'

/**
 * App Store Connect の「プライバシーポリシーURL」に登録するページ。
 * ここが 404 だと審査に出せない。
 */
export const metadata: Metadata = {
  title: 'プライバシーポリシー | MeshiMap',
  description: 'MeshiMap が取得する情報と、その使い方について説明します。',
}

export default function Page() {
  return <LegalPage doc={PRIVACY} />
}
