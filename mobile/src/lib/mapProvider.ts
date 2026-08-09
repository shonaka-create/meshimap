import Constants, { ExecutionEnvironment } from 'expo-constants'
import { PROVIDER_DEFAULT, PROVIDER_GOOGLE } from 'react-native-maps'

/**
 * 今 Expo Go の中で動いているか。
 *
 * Expo Go は Expo が配布している「共通の入れ物」アプリなので、
 * このプロジェクト用のネイティブ設定（app.config.ts の
 * ios.config.googleMapsApiKey など）は反映されない。
 */
export const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient

/**
 * 地図の提供元。
 *
 * iOS の Google Maps は Google Maps SDK をアプリに組み込む必要があり、
 * Expo Go にはそれが入っていない。そこで Expo Go のときだけ
 * OS標準の地図（iOS なら Apple 地図）に落とす。
 *
 * こうしておくと、Apple Developer Program に登録しなくても
 * Expo Go で画面や投稿の流れを確認できる。
 * 開発ビルド・本番ビルドでは従来どおり Google Maps が使われる。
 *
 * ※ Android の PROVIDER_DEFAULT はもともと Google Maps。
 */
export const MAP_PROVIDER = isExpoGo ? PROVIDER_DEFAULT : PROVIDER_GOOGLE
