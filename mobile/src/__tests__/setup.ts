// ============================================================
// 描画テストの下ごしらえ
//
// 見たいのは「画面が組み立てられるか」であって、アイコンの見た目や
// 画像の読み込みではない。ここでは、それらを素通りする軽い部品に
// 置き換える。置き換えないと expo-font が expo-asset を探しに行って
// 解決できずに止まる（実機では Metro が解決するが、jest は解決しない）。
//
// ★ jest.mock の中では外の変数を使えないので、中で require すること。
// ============================================================

// @expo/vector-icons は Ionicons / MaterialIcons など多数を出す。
// どれを取り出されても空の View を返せばよいので Proxy でまとめて受ける。
jest.mock('@expo/vector-icons', () => {
  const React = require('react')
  const { View } = require('react-native')
  const Icon = () => React.createElement(View)
  return new Proxy({}, { get: () => Icon })
})

jest.mock('expo-image', () => {
  const React = require('react')
  const { View } = require('react-native')
  return { Image: () => React.createElement(View) }
})

// 画像を選ぶ・位置を取るといった端末機能は、開けるかどうかとは無関係。
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  MediaTypeOptions: { Images: 'Images' },
}))

// 動かない部分への警告で、本当のエラーが流れていくのを防ぐ
jest.spyOn(console, 'warn').mockImplementation(() => {})

// AsyncStorage は公式のテスト用ダミーが同梱されている（見た目の設定の保存で使う）
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
)
