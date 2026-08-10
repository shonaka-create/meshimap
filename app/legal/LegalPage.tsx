import Link from 'next/link'
import type { LegalDocument } from '../../mobile/src/legal/content'
import { LEGAL_UPDATED, SUPPORT_EMAIL } from '../../mobile/src/legal/content'

/**
 * 規約・ポリシーの表示部（Web）。
 *
 * 本文は mobile/src/legal/content.ts が原本で、アプリと共有している。
 * ここは並べ方だけを担当する。
 *
 * 読み手は「自分の写真と位置情報がどう扱われるか」を確かめに来る。
 * 装飾より、目当ての節に辿り着けることを優先している。
 */
export function LegalPage({ doc }: { doc: LegalDocument }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
      <nav className="mb-10 text-sm">
        <Link href="/" className="text-gray-500 underline-offset-4 hover:underline">
          MeshiMap
        </Link>
      </nav>

      <h1 className="text-3xl font-bold tracking-tight text-gray-900">{doc.title}</h1>
      <p className="mt-2 text-sm text-gray-500">最終更新: {LEGAL_UPDATED}</p>
      <p className="mt-6 leading-relaxed text-gray-700">{doc.intro}</p>

      {/* 節が多いので目次を置く。位置情報や削除の項だけ読みたい人が多い。 */}
      <ol className="mt-10 space-y-1 border-l-2 border-gray-200 pl-5 text-sm">
        {doc.clauses.map((c, i) => (
          <li key={c.heading}>
            <a
              href={`#s${i + 1}`}
              className="text-gray-600 underline-offset-4 hover:text-gray-900 hover:underline"
            >
              {i + 1}. {c.heading}
            </a>
          </li>
        ))}
      </ol>

      <div className="mt-12 space-y-10">
        {doc.clauses.map((c, i) => (
          <section key={c.heading} id={`s${i + 1}`} className="scroll-mt-8">
            <h2 className="text-lg font-semibold text-gray-900">
              {i + 1}. {c.heading}
            </h2>
            {c.body.map((p, j) => (
              // 本文には改行で箇条書きが入っている。whitespace-pre-line で
              // そのまま活かす。<br> を埋め込むと原本がHTMLに汚れる。
              <p key={j} className="mt-3 whitespace-pre-line leading-relaxed text-gray-700">
                {p}
              </p>
            ))}
          </section>
        ))}
      </div>

      <footer className="mt-16 border-t border-gray-200 pt-6 text-sm text-gray-500">
        <p>
          お問い合わせ:{' '}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-gray-700 underline underline-offset-4"
          >
            {SUPPORT_EMAIL}
          </a>
        </p>
        <p className="mt-2 flex gap-4">
          <Link href="/legal/terms" className="underline-offset-4 hover:underline">
            利用規約
          </Link>
          <Link href="/legal/privacy" className="underline-offset-4 hover:underline">
            プライバシーポリシー
          </Link>
          <Link href="/support" className="underline-offset-4 hover:underline">
            サポート
          </Link>
        </p>
      </footer>
    </main>
  )
}
