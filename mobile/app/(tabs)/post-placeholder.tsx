import { Redirect } from 'expo-router'

/**
 * タブバー中央の投稿ボタン用のダミールート。
 * 実際の遷移は (tabs)/_layout.tsx の tabBarButton がモーダルを開くので
 * ここには到達しないが、Expo Router はタブに対応するファイルを要求する。
 */
export default function PostPlaceholder() {
  return <Redirect href="/(tabs)" />
}
