import type { Metadata } from 'next'
import { LegalPage } from '../LegalPage'
import { TERMS } from '../../../mobile/src/legal/content'

/**
 * 利用規約（EULA）。
 * Guideline 1.2 の「規約への同意」を審査で示すときに、
 * この URL を審査ノートに書けるようにしておく。
 */
export const metadata: Metadata = {
  title: '利用規約 | MeshiMap',
  description: 'MeshiMap の利用条件を定める規約です。',
}

export default function Page() {
  return <LegalPage doc={TERMS} />
}
