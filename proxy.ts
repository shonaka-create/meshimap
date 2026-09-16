import { NextResponse, type NextRequest } from 'next/server'

/**
 * 公開範囲の制限。
 *
 * なぜ要るか:
 *   iOS アプリを App Store に出すために Web が必要なのは、
 *   プライバシーポリシーとサポートの「URL」だけ。
 *   Web 版アプリ（地図・検索・プロフィール・DM）は審査に要らない。
 *
 *   必要でないものを公開したままにすると、
 *   直していない画面や未完成の導線まで世に出る。
 *   出す理由が無いものは出さない。
 *
 * 効かせ方:
 *   環境変数 PUBLIC_SITE_ONLY=1 のときだけ制限する。
 *   本番にだけ設定し、ローカルとプレビューでは今まで通り全部動く。
 *   コードを分岐で汚さずに、公開する場所だけ絞れる。
 *
 * ★ 「隠す」ではなく「閉じる」であること。
 *   404 を返すので、URL を知っていても入れない。
 *   リンクを消すだけでは、直接叩かれたら開いてしまう。
 */

/** 誰でも見てよいページ。App Store Connect に出す URL はここに含める。 */
const PUBLIC_PAGES = new Set([
  '/legal/privacy',
  '/legal/terms',
  '/support',
])

/**
 * ページではないが通す必要があるもの。
 *
 * /api/geocode … iOS アプリが逆ジオコーディングを頼む先。
 *   Google の鍵をアプリに持たせないためにサーバー側へ移したので、
 *   ここを閉じるとアプリの都道府県判定が内蔵データだけになる。
 *   未ログインには 401 を返すので、開けておいて危険はない。
 */
const PUBLIC_PREFIXES = [
  '/api/geocode',
  /**
   * 投稿するときの店名検索（/api/places/search・/api/places/detail）。
   *
   * ★ ここに足し忘れないこと。
   *   本番は PUBLIC_SITE_ONLY=1 なので、足さないと 404 で閉じられ、
   *   鍵も移行も正しいのに「店名を打っても候補が出ない」状態になる。
   *   原因がアプリ側に見えるので、いちばん見つけにくい壊れ方をする。
   *
   *   未ログインには 401 を返し、呼び出し回数にはサーバー側の上限
   *   （移行0021 の consume_place_search）が掛かっているので、
   *   開けておいて請求が膨らむことはない。
   */
  '/api/places',
]

function isAllowed(pathname: string): boolean {
  if (PUBLIC_PAGES.has(pathname)) return true
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

export function proxy(request: NextRequest) {
  if (process.env.PUBLIC_SITE_ONLY !== '1') {
    return NextResponse.next({ request })
  }

  const { pathname } = request.nextUrl

  if (isAllowed(pathname)) return NextResponse.next({ request })

  // 入口だけは行き先を示す。審査員がドメイン直打ちで来ることがあり、
  // そこが 404 だと「無いサイト」に見えてしまう。
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/support', request.url))
  }

  // それ以外は閉じる。存在を伏せたいのではなく、開かせないため。
  return new NextResponse(null, { status: 404 })
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
