import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * 店名から場所の候補を出す（Google Places API (New) の Autocomplete）
 *
 * ★ なぜサーバー経由なのか
 *   Places は「ウェブサービス API」で、HTTP リファラ制限もバンドルID制限も効かない。
 *   鍵をアプリに入れると、抜かれたあとに請求を止める手段が無い。
 *   /api/geocode と同じく、鍵はサーバーにだけ置き、
 *   アプリはログイン済みトークンを添えてここへ問い合わせる。
 *
 * ★ なぜ座標を返さないのか
 *   Autocomplete が返すのは placeId と表示用の文字列だけで、座標は含まれない。
 *   座標は「選ばれた1件」についてだけ /api/places/detail で取りに行く。
 *   候補を出すたびに全件の座標を引くと、使う気のない候補の分まで課金される。
 *
 * ★ 店名は Autocomplete の文字列を使うこと。
 *   Place Details から displayName を取ると Pro の SKU になり、
 *   無料枠が 5,000/月・超過 $17/1,000 と一段高い。
 *   候補の時点で店名は手に入っているので、取り直す必要がない。
 *
 * 呼び出し回数は移行0021の consume_place_search() が数えていて、
 * 上限を超えると capped: true を返す（そのときアプリは過去データだけで候補を出す）。
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

/** 飲食店だけに絞る。Autocomplete の primary type は5つまで */
const FOOD_TYPES = ['restaurant', 'cafe', 'bar', 'bakery', 'meal_takeaway']

/** 現在地を渡されたときに、その周りを優先する半径(m) */
const BIAS_RADIUS_M = 30_000

interface Suggestion {
  placePrediction?: {
    placeId?: string
    structuredFormat?: {
      mainText?: { text?: string }
      secondaryText?: { text?: string }
    }
  }
}

export async function POST(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: 'サーバーの設定が不足しています' }, { status: 500 })
  }

  // ---- 認証 ----
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })
  }

  // ★ トークンを毎回の呼び出しに載せること。
  //   下の consume_place_search() は auth.uid() で本人を見るので、
  //   anon のままだと「ログインが必要です」で落ちる。
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })
  }

  // ---- 入力 ----
  let input: unknown, lat: unknown, lng: unknown
  try {
    const body = await request.json()
    input = body?.input
    lat = body?.lat
    lng = body?.lng
  } catch {
    return NextResponse.json({ error: '不正なリクエストです' }, { status: 400 })
  }

  if (typeof input !== 'string') {
    return NextResponse.json({ error: '検索語が不正です' }, { status: 400 })
  }
  const query = input.trim()
  // 1文字では候補が絞れず、API だけ消費する。長すぎる入力も投げない。
  if (query.length < 2 || query.length > 100) {
    return NextResponse.json({ results: [], capped: false })
  }

  // ---- 鍵が無ければ、外部を呼ばずに空で返す ----
  // 鍵を用意していない環境（開発中など）でも、アプリは過去データと
  // 内蔵エリアで候補を出せる。検索そのものは止めない。
  const key = process.env.GOOGLE_PLACES_KEY
  if (!key) {
    return NextResponse.json({ results: [], capped: false, disabled: true })
  }

  // ---- 上限 ----
  // ★ 外部を呼ぶ前に数えること。呼んでから数えると、
  //   失敗した呼び出しの分だけ上限が甘くなる。
  const { data: quota, error: quotaError } = await supabase.rpc('consume_place_search')
  if (quotaError) {
    console.warn('[places] 上限の確認に失敗', quotaError.message)
    // 数えられないときは呼ばない。請求の柵を外すより、候補が減るほうがまし。
    return NextResponse.json({ results: [], capped: true })
  }

  const row = Array.isArray(quota) ? quota[0] : quota
  if (!row?.allowed) {
    return NextResponse.json({ results: [], capped: true })
  }

  // ---- Google Places Autocomplete ----
  const hasCoords =
    typeof lat === 'number' && typeof lng === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lng)

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        // 要らない項目を貰わない。返す項目が増えるほど上位の SKU になる。
        'X-Goog-FieldMask':
          'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat',
      },
      body: JSON.stringify({
        input: query,
        languageCode: 'ja',
        regionCode: 'jp',
        // ★ regionCode だけでは国外の店が候補に出る。
        //   あれは並び順と住所の書式に効くだけで、絞り込みではない。
        //   出しても /api/places/detail が国外の座標を拒むので、
        //   選べない店を見せたうえに有料の詳細取得まで走ってしまう。
        //   絞り込むのはこちら（最大15の地域コード）。
        includedRegionCodes: ['jp'],
        includedPrimaryTypes: FOOD_TYPES,
        ...(hasCoords
          ? {
              locationBias: {
                circle: {
                  center: { latitude: lat, longitude: lng },
                  radius: BIAS_RADIUS_M,
                },
              },
            }
          : {}),
      }),
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      const detail = await res.text()
      console.warn('[places] autocomplete が', res.status, detail.slice(0, 300))
      return NextResponse.json({ results: [], capped: false })
    }

    const json = (await res.json()) as { suggestions?: Suggestion[] }

    const results = (json.suggestions ?? [])
      .map((s) => {
        const p = s.placePrediction
        const name = p?.structuredFormat?.mainText?.text?.trim()
        if (!p?.placeId || !name) return null
        return {
          placeId: p.placeId,
          name,
          // 「千代田区神田神保町」のような住所寄りの文字列。同名店の取り違えを防ぐ
          detail: p.structuredFormat?.secondaryText?.text?.trim() ?? '',
        }
      })
      .filter((r): r is { placeId: string; name: string; detail: string } => r !== null)

    return NextResponse.json({ results, capped: false })
  } catch (e) {
    console.warn('[places] autocomplete の呼び出しに失敗', e)
    return NextResponse.json({ results: [], capped: false })
  }
}
