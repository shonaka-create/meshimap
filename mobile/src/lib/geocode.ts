import Constants from 'expo-constants'

const KEY =
  process.env.EXPO_PUBLIC_GOOGLE_GEOCODING_KEY ??
  (Constants.expoConfig?.extra?.googleGeocodingKey as string | undefined)

export interface RegionInfo {
  prefecture: string | null
  city: string | null
}

interface AddressComponent {
  long_name: string
  short_name: string
  types: string[]
}

function pick(components: AddressComponent[], type: string): string | null {
  return components.find((c) => c.types.includes(type))?.long_name ?? null
}

/**
 * 緯度経度 → 都道府県 / 市区町村
 *
 * 日本の住所は自治体の種類で構成要素が変わるので素直に取れない:
 *   東京都新宿区   → administrative_area_level_1=東京都, locality=新宿区
 *   大阪府大阪市北区 → administrative_area_level_1=大阪府, locality=大阪市,
 *                     sublocality_level_1=北区
 * 政令指定都市は「市＋区」を繋げないと集計単位として粗すぎるため、
 * locality が「市」で終わり sublocality_level_1 がある場合だけ連結する。
 *
 * ※ 最寄り駅の判定はしない。
 *   Places Nearby Search は Geocoding の6倍以上の単価（約$32/1,000）で
 *   無料枠も半分しかないため、地図の階層は 県 → 市区町村 の2段に絞っている。
 *   駅で絞りたくなったら、駅座標のオープンデータを DB に持って
 *   SQL で最近傍を出す方が安く・速く・正確。
 */
export async function reverseGeocode(lat: number, lng: number): Promise<RegionInfo> {
  if (!KEY) return { prefecture: null, city: null }

  try {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?latlng=${lat},${lng}&language=ja&result_type=street_address|premise|political&key=${KEY}`
    const res = await fetch(url)
    const json = await res.json()

    if (json.status !== 'OK' || !json.results?.length) {
      // ZERO_RESULTS は海上などで普通に起きるので警告に留める
      if (json.status !== 'ZERO_RESULTS') {
        console.warn('[geocode] reverseGeocode:', json.status, json.error_message ?? '')
      }
      return { prefecture: null, city: null }
    }

    // 最も詳細な結果（先頭）の構成要素を使う
    const components: AddressComponent[] = json.results[0].address_components ?? []

    const prefecture = pick(components, 'administrative_area_level_1')
    const locality = pick(components, 'locality')
    const ward = pick(components, 'sublocality_level_1')
    const level2 = pick(components, 'administrative_area_level_2')

    let city: string | null = locality ?? level2 ?? ward
    if (locality && ward && locality.endsWith('市')) {
      city = `${locality}${ward}` // 例: 大阪市北区
    }

    return { prefecture, city }
  } catch (e) {
    console.warn('[geocode] reverseGeocode failed', e)
    return { prefecture: null, city: null }
  }
}

/** 投稿時に地域を解決する。失敗しても投稿自体は成立させる。 */
export async function resolveRegion(lat: number, lng: number): Promise<RegionInfo> {
  return reverseGeocode(lat, lng)
}
