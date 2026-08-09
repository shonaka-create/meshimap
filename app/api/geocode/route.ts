import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * 緯度経度 → 都道府県 / 市区町村（Google Geocoding API）
 *
 * ★ なぜサーバー経由なのか
 *   Geocoding は「ウェブサービス API」で、HTTP リファラ制限が効かない。
 *   NEXT_PUBLIC_GOOGLE_MAPS_API_KEY（Maps JavaScript API 用・ブラウザに露出する）を
 *   そのまま呼び出しに使うと、鍵を抜いた第三者に請求が発生する。
 *   そのため、ブラウザに出ない GOOGLE_GEOCODING_KEY を使い、
 *   呼び出しはこのサーバー側ルートに限定する。
 *
 * ★ 呼べる人を絞る理由
 *   1リクエストごとに課金されるため、誰でも叩ける口にしない。
 *   Web クライアントは localStorage セッション運用（cookie ではない）なので、
 *   アクセストークンを Authorization ヘッダで受け取って検証する。
 *
 * GOOGLE_GEOCODING_KEY が未設定でも 200 と null を返す。
 * 呼び出し側は内蔵データだけで判定を続けられる（lib/geocode.ts 参照）ので、
 * 鍵を用意していない環境で投稿が止まることはない。
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

interface AddressComponent {
  long_name: string
  short_name: string
  types: string[]
}

function pick(components: AddressComponent[], type: string): string | null {
  return components.find((c) => c.types.includes(type))?.long_name ?? null
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

  const supabase = createClient(supabaseUrl, supabaseAnonKey)
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })
  }

  // ---- 入力 ----
  let lat: unknown, lng: unknown
  try {
    const body = await request.json()
    lat = body?.lat
    lng = body?.lng
  } catch {
    return NextResponse.json({ error: '不正なリクエストです' }, { status: 400 })
  }

  if (
    typeof lat !== 'number' || typeof lng !== 'number' ||
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    lat < -90 || lat > 90 || lng < -180 || lng > 180
  ) {
    return NextResponse.json({ error: '座標が不正です' }, { status: 400 })
  }

  // ---- 鍵がなければ内蔵データだけで続けてもらう ----
  const key = process.env.GOOGLE_GEOCODING_KEY
  if (!key) {
    return NextResponse.json({ prefecture: null, city: null })
  }

  // ---- Google Geocoding ----
  // 日本の住所は自治体の種類で構成要素が変わるので素直に取れない:
  //   東京都新宿区    → administrative_area_level_1=東京都, locality=新宿区
  //   大阪府大阪市北区 → administrative_area_level_1=大阪府, locality=大阪市,
  //                      sublocality_level_1=北区
  // 政令指定都市は「市＋区」を繋げないと集計単位として粗すぎるため、
  // locality が「市」で終わり sublocality_level_1 がある場合だけ連結する。
  // （mobile/src/lib/geocode.ts の geocodeViaApi と同じ規則）
  try {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?latlng=${lat},${lng}&language=ja&result_type=street_address|premise|political` +
      `&key=${encodeURIComponent(key)}`

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    const json = await res.json()

    if (json.status !== 'OK' || !json.results?.length) {
      // ZERO_RESULTS は海上などで普通に起きるので警告に留める
      if (json.status !== 'ZERO_RESULTS') {
        console.warn('[geocode] API:', json.status, json.error_message ?? '')
      }
      return NextResponse.json({ prefecture: null, city: null })
    }

    const components: AddressComponent[] = json.results[0].address_components ?? []

    const prefecture = pick(components, 'administrative_area_level_1')
    const locality = pick(components, 'locality')
    const ward = pick(components, 'sublocality_level_1')
    const level2 = pick(components, 'administrative_area_level_2')

    let city: string | null = locality ?? level2 ?? ward
    if (locality && ward && locality.endsWith('市')) {
      city = `${locality}${ward}` // 例: 大阪市北区
    }

    return NextResponse.json({ prefecture, city })
  } catch (e) {
    console.warn('[geocode] API 呼び出しに失敗', e)
    return NextResponse.json({ prefecture: null, city: null })
  }
}
