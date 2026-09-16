import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * 選ばれた店の座標だけを取る（Google Places API (New) の Place Details）
 *
 * ★ フィールドマスクを増やさないこと。
 *   location と formattedAddress は Essentials（無料枠 10,000/月・
 *   超過 $5/1,000）だが、displayName を足した瞬間に Pro
 *   （無料枠 5,000/月・超過 $17/1,000）の扱いになる。
 *   店名は /api/places/search が返した文字列を使えばよい。
 *
 * ★ 呼ぶのは「選ばれた1件」だけにすること。
 *   候補を出すたびに全件ぶん呼ぶと、使わない候補の分まで課金される。
 *
 * 回数は移行0021の consume_place_search() が数える。
 * 上限を超えたときは capped: true を返し、アプリは
 * 「地図で位置を指定してください」に切り替える（投稿は止めない）。
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

/**
 * 日本の範囲。おおよそで、南は波照間、北は択捉、東は南鳥島まで。
 * ★ ここから外れた座標は返さないこと。
 *   このアプリは47都道府県のデータしか持っていないので、
 *   国外にピンを置かれると、投稿時の地域判定が必ず外れる
 *   （mobile/src/lib/placeSearch.ts の JAPAN_BOUNDS と同じ意図）。
 */
const JAPAN_BOUNDS = { minLat: 20.2, maxLat: 45.8, minLng: 122.8, maxLng: 154.0 } as const

/** Place ID は英数字と - _ だけ。変な文字を外部へ素通ししない */
const PLACE_ID_RE = /^[A-Za-z0-9_-]{1,255}$/

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

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })
  }

  // ---- 入力 ----
  let placeId: unknown
  try {
    const body = await request.json()
    placeId = body?.placeId
  } catch {
    return NextResponse.json({ error: '不正なリクエストです' }, { status: 400 })
  }

  if (typeof placeId !== 'string' || !PLACE_ID_RE.test(placeId)) {
    return NextResponse.json({ error: '場所の指定が不正です' }, { status: 400 })
  }

  const key = process.env.GOOGLE_PLACES_KEY
  if (!key) {
    return NextResponse.json({ location: null, capped: false, disabled: true })
  }

  // ---- 上限 ----
  const { data: quota, error: quotaError } = await supabase.rpc('consume_place_search')
  if (quotaError) {
    console.warn('[places] 上限の確認に失敗', quotaError.message)
    return NextResponse.json({ location: null, capped: true })
  }

  const row = Array.isArray(quota) ? quota[0] : quota
  if (!row?.allowed) {
    return NextResponse.json({ location: null, capped: true })
  }

  // ---- Google Place Details ----
  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        headers: {
          'X-Goog-Api-Key': key,
          // ★ ここに displayName を足さないこと（上のコメント参照）
          'X-Goog-FieldMask': 'location,formattedAddress',
        },
        signal: AbortSignal.timeout(8000),
      }
    )

    if (!res.ok) {
      const detail = await res.text()
      console.warn('[places] details が', res.status, detail.slice(0, 300))
      return NextResponse.json({ location: null, capped: false })
    }

    const json = (await res.json()) as {
      location?: { latitude?: number; longitude?: number }
      formattedAddress?: string
    }

    const lat = json.location?.latitude
    const lng = json.location?.longitude
    if (typeof lat !== 'number' || typeof lng !== 'number' ||
        !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ location: null, capped: false })
    }

    if (
      lat < JAPAN_BOUNDS.minLat || lat > JAPAN_BOUNDS.maxLat ||
      lng < JAPAN_BOUNDS.minLng || lng > JAPAN_BOUNDS.maxLng
    ) {
      return NextResponse.json({ location: null, capped: false, outsideJapan: true })
    }

    return NextResponse.json({
      location: { latitude: lat, longitude: lng },
      address: json.formattedAddress ?? '',
      capped: false,
    })
  } catch (e) {
    console.warn('[places] details の呼び出しに失敗', e)
    return NextResponse.json({ location: null, capped: false })
  }
}
