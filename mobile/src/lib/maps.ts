import { Alert, Linking, Platform } from 'react-native'

/**
 * 外部の地図アプリを開く。
 *
 * ★ ここは Google Maps API ではない。
 *   URL を開いているだけなので、呼び出し回数の課金は一切発生しない。
 *   （課金されるのは Maps SDK の地図読み込みと Geocoding/Places のAPI）
 *
 * Google マップアプリが入っていれば自動でアプリが開き、
 * 無ければブラウザの Google マップが開く。こちらで分岐する必要はない。
 * URL の仕様: https://developers.google.com/maps/documentation/urls
 */

const GOOGLE_SEARCH = 'https://www.google.com/maps/search/?api=1'
const GOOGLE_DIR = 'https://www.google.com/maps/dir/?api=1'

async function open(url: string) {
  try {
    await Linking.openURL(url)
  } catch {
    Alert.alert('地図を開けませんでした', 'しばらくしてからもう一度お試しください。')
  }
}

/**
 * 店名で検索して開く。
 * 店名だけだと同名店に飛ぶことがあるので、街の名前を添えて絞る。
 */
export function openInMaps(locationName: string, area?: string | null) {
  const q = [locationName, area].filter(Boolean).join(' ')
  return open(`${GOOGLE_SEARCH}&query=${encodeURIComponent(q)}`)
}

/**
 * 投稿された座標そのものへの経路を開く。
 * 店名検索と違って場所がずれないので、「行き方が知りたい」ときはこちら。
 */
export function openDirections(lat: number, lng: number, label?: string) {
  const dest = `${lat},${lng}`
  const url =
    `${GOOGLE_DIR}&destination=${encodeURIComponent(dest)}` +
    (label ? `&destination_place_id=` : '')
  return open(url)
}

/** iOS で Apple 地図を使いたい人向け（設定などから呼ぶ想定） */
export function openInAppleMaps(lat: number, lng: number, label: string) {
  if (Platform.OS !== 'ios') return openDirections(lat, lng)
  return open(`http://maps.apple.com/?ll=${lat},${lng}&q=${encodeURIComponent(label)}`)
}
