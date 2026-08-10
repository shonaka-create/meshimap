import type { Metadata } from 'next'
import Link from 'next/link'
import {
  REPORT_RESPONSE_HOURS,
  SUPPORT_EMAIL,
} from '../../mobile/src/legal/content'

/**
 * App Store Connect の「サポートURL」に登録するページ。
 *
 * 審査でここを開かれる。連絡先が載っているだけでは足りず、
 * 「通報したい」「アカウントを消したい」に対する答えが
 * その場で読めることが要る（Guideline 1.2 / 5.1.1(v)）。
 *
 * アプリを入れていない人・消してしまった人からも
 * 通報と削除依頼を受けられるようにしてある。
 * アプリ内にしか窓口が無いと、その二者が行き止まりになる。
 */
export const metadata: Metadata = {
  title: 'サポート | MeshiMap',
  description: 'MeshiMap のお問い合わせ、通報、アカウント削除について。',
}

const mailto = (subject: string) =>
  `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
      <nav className="mb-10 text-sm">
        <Link href="/" className="text-gray-500 underline-offset-4 hover:underline">
          MeshiMap
        </Link>
      </nav>

      <h1 className="text-3xl font-bold tracking-tight text-gray-900">サポート</h1>
      <p className="mt-6 leading-relaxed text-gray-700">
        MeshiMap は、食べたお店の記録を地図に残して共有するアプリです。
        ご不明な点やご要望は、下記までお気軽にご連絡ください。
      </p>

      <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6">
        <p className="text-sm text-gray-500">お問い合わせ先</p>
        <a
          href={mailto('MeshiMap お問い合わせ')}
          className="mt-1 block text-xl font-semibold text-gray-900 underline underline-offset-4"
        >
          {SUPPORT_EMAIL}
        </a>
        <p className="mt-3 text-sm leading-relaxed text-gray-600">
          返信は原則3営業日以内に差し上げます。
          通報については受領から{REPORT_RESPONSE_HOURS}時間以内に確認します。
        </p>
      </div>

      <section className="mt-12">
        <h2 className="text-lg font-semibold text-gray-900">不適切な投稿・利用者を報告する</h2>
        <p className="mt-3 leading-relaxed text-gray-700">
          アプリ内では、投稿およびプロフィールの画面から「通報」できます。
          あわせて「ブロック」を使うと、相手との投稿とプロフィールが相互に見えなくなります。
        </p>
        <p className="mt-3 leading-relaxed text-gray-700">
          アプリをお使いでない方も、メールで報告いただけます。
          対象のアカウント名（@から始まるユーザーID）またはお店の名前と、
          問題だと思われた理由をお知らせください。
        </p>
        <p className="mt-4">
          <a
            href={mailto('【通報】MeshiMap の投稿について')}
            className="inline-block rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white"
          >
            メールで通報する
          </a>
        </p>
        <p className="mt-3 text-sm leading-relaxed text-gray-600">
          受領から{REPORT_RESPONSE_HOURS}時間以内に内容を確認し、
          規約違反が認められた場合は当該投稿の削除、
          または投稿者のアカウント停止を行います。
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-semibold text-gray-900">アカウントを削除したい</h2>
        <p className="mt-3 leading-relaxed text-gray-700">
          アプリ内の「設定 &gt; アカウントを削除」から、いつでもご自身で削除できます。
          アカウント、投稿、写真、フォロー関係がすべて削除され、復元はできません。
        </p>
        <p className="mt-3 leading-relaxed text-gray-700">
          端末を紛失したなど、アプリから操作できない事情がある場合は、
          ご登録のメールアドレスから下記へご連絡ください。
        </p>
        <p className="mt-4">
          <a
            href={mailto('【削除依頼】MeshiMap のアカウント削除について')}
            className="inline-block rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-900"
          >
            メールで削除を依頼する
          </a>
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-semibold text-gray-900">よくあるご質問</h2>
        <dl className="mt-4 space-y-6">
          <div>
            <dt className="font-medium text-gray-900">投稿はすぐに他の人に見えますか？</dt>
            <dd className="mt-2 leading-relaxed text-gray-700">
              いいえ。投稿は作成した時点では必ず非公開です。
              あなたが公開に切り替えたものだけが、アカウントの公開設定に従って表示されます。
            </dd>
          </div>
          <div>
            <dt className="font-medium text-gray-900">現在地は他の人に知られますか？</dt>
            <dd className="mt-2 leading-relaxed text-gray-700">
              いいえ。地図に表示されるのは「最後に公開した投稿のお店の場所」で、
              あなたの現在地ではありません。現在地は地図を自分の位置へ戻すときに
              端末内で使うだけで、サーバーに保存していません。
            </dd>
          </div>
          <div>
            <dt className="font-medium text-gray-900">位置情報の許可を断っても使えますか？</dt>
            <dd className="mt-2 leading-relaxed text-gray-700">
              使えます。「現在地に戻る」が働かなくなるだけで、
              地図の閲覧も投稿もそのまま行えます。
            </dd>
          </div>
          <div>
            <dt className="font-medium text-gray-900">お店の情報が間違っています</dt>
            <dd className="mt-2 leading-relaxed text-gray-700">
              投稿は利用者が記録したもので、運営が店舗情報を提供しているわけではありません。
              店舗の関係者の方で掲載についてご要望がある場合は、上記のメールアドレスへご連絡ください。
            </dd>
          </div>
        </dl>
      </section>

      <footer className="mt-16 border-t border-gray-200 pt-6 text-sm text-gray-500">
        <p className="flex gap-4">
          <Link href="/legal/terms" className="underline-offset-4 hover:underline">
            利用規約
          </Link>
          <Link href="/legal/privacy" className="underline-offset-4 hover:underline">
            プライバシーポリシー
          </Link>
        </p>
      </footer>
    </main>
  )
}
